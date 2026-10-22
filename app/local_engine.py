"""Standalone localhost adapter for the ReupAI Local Engine.

This process keeps the existing pipeline in place and exposes a small,
authenticated API for a future web frontend. It intentionally binds to
127.0.0.1 only.
"""

import secrets
import shutil
import sys
import html
import os
import time
import hashlib
import json
from pathlib import Path
from urllib.parse import quote, urlsplit, parse_qs, unquote
from types import SimpleNamespace
from typing import Annotated

APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

# Importing the compatibility handlers from web.server must not bootstrap the
# legacy dashboard account database. Local Engine access is protected by its
# own origin-scoped browser authorization flow.
os.environ.setdefault("REUP_LOCAL_ENGINE", "1")

import uvicorn
from fastapi import Depends, FastAPI, Form, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse

from runtime_paths import (
    get_downloads_dir,
    get_local_token_path,
    get_output_dir,
    get_runtime_root,
    get_config_dir,
    ensure_runtime_dirs,
)
from services.job_db import ensure_job_schema, list_active_jobs, recover_interrupted_jobs
from services.engine_runtime import (
    acquire_instance_lock,
    release_instance_lock,
    runtime_diagnostics,
)
from web.server import (
    DownloadRequest,
    PageRequest,
    ProcessRequest,
    RenderEditRequest,
    SourceRequest,
    api_download,
    api_process,
    api_output_edit,
    api_output_rerender,
    api_process_status,
    api_process_stop,
    api_videos,
    api_videos_page,
    load_job_history,
    scan_downloaded_library,
    scan_outputs_library,
    invalidate_library_scan_cache,
    dashboard_data,
    api_cover,
    api_result,
    api_stream,
    preview_source_video,
    library_source,
)
from services.library_api import (
    CollectionCreateBody,
    CollectionVideoBody,
    CollectionVideosBody,
    DirectVideoBody,
    FavoriteBody,
    SavedSourceBody,
    SavedSourcePatchBody,
    UiStateBody,
    api_add_collection_video,
    api_add_collection_videos,
    api_collections,
    api_create_collection,
    api_delete_collection,
    api_delete_source,
    api_direct_video,
    api_get_ui_state,
    api_library_videos,
    api_meta,
    api_patch_source,
    api_put_ui_state,
    api_remove_collection_video,
    api_save_source,
    api_saved_sources,
    api_series,
    api_toggle_favorite,
)


ENGINE_VERSION = "0.2.11"
ENGINE_CAPABILITIES = {
    "direct_authorization": True,
    "media_tickets": True,
    "runtime_readiness": True,
    "gemini_google_oauth": True,
    "gemini_api_enablement": True,
}
LOCAL_TOKEN_PATH = get_local_token_path()
ensure_runtime_dirs()


def load_or_create_token() -> str:
    if LOCAL_TOKEN_PATH.exists():
        value = LOCAL_TOKEN_PATH.read_text(encoding="utf-8").strip()
        if value:
            return value
    value = secrets.token_urlsafe(48)
    LOCAL_TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOCAL_TOKEN_PATH.write_text(value, encoding="utf-8")
    return value


LOCAL_TOKEN = load_or_create_token()
AUTH_GRANTS_PATH = get_config_dir() / "authorization_grants.json"


def _allowed_origins() -> list[str]:
    configured = os.getenv("REUP_ENGINE_ALLOWED_ORIGINS")
    if configured:
        return [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
    # Development defaults.  Production only needs this environment variable
    # changed to the deployed web origin.
    return [
        "https://www.reupai.cloud",
        "https://reupai.cloud",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]


ALLOWED_ORIGINS = _allowed_origins()
AUTH_CODE_TTL_SECONDS = 120
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
_authorization_codes: dict[str, dict[str, object]] = {}
_browser_sessions: dict[str, dict[str, object]] = {}
_media_tickets: dict[str, dict[str, object]] = {}
MEDIA_TICKET_TTL_SECONDS = 15 * 60


def _grant_fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _installation_fingerprint() -> str:
    # The master token never leaves the engine.  Its fingerprint binds grants
    # to this local installation without persisting another raw secret.
    return _grant_fingerprint(LOCAL_TOKEN)


def _load_authorization_grants() -> dict[str, dict[str, str]]:
    try:
        data = json.loads(AUTH_GRANTS_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, ValueError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        str(origin): record
        for origin, record in data.items()
        if isinstance(record, dict) and isinstance(record.get("fingerprint"), str)
    }


def _save_authorization_grants(grants: dict[str, dict[str, str]]) -> None:
    AUTH_GRANTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = AUTH_GRANTS_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(grants, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(AUTH_GRANTS_PATH)


def _mint_browser_session(origin: str) -> str:
    session_token = secrets.token_urlsafe(48)
    _browser_sessions[session_token] = {
        "expires_at": time.time() + SESSION_TTL_SECONDS,
        "client_origin": origin,
    }
    return session_token


def _issue_browser_authorization(origin: str) -> dict[str, object]:
    """Persist one origin grant and issue a session without exposing LOCAL_TOKEN."""
    grant = secrets.token_urlsafe(48)
    grants = _load_authorization_grants()
    grants[origin] = {
        "fingerprint": _grant_fingerprint(grant),
        "installation": _installation_fingerprint(),
        "created_at": str(int(time.time())),
    }
    _save_authorization_grants(grants)

    # A fresh user-initiated connection replaces only sessions for this site.
    for token, session in list(_browser_sessions.items()):
        if session.get("client_origin") == origin:
            _browser_sessions.pop(token, None)

    return {
        "session_token": _mint_browser_session(origin),
        "grant": grant,
        "expires_in": SESSION_TTL_SECONDS,
        "engine": "ReupAI",
    }


app = FastAPI(title="ReupAI Local Engine", version=ENGINE_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Range"],
    expose_headers=["Content-Disposition", "Content-Range", "Accept-Ranges", "Content-Length"],
    # HTTPS frontends (Vercel/custom domain) trigger the browser's Private
    # Network Access preflight when they call the loopback engine. This stays
    # restricted to ALLOWED_ORIGINS; it does not make the engine public.
    allow_private_network=True,
)


@app.on_event("startup")
def local_engine_startup():
    # Importing web.server reuses its pipeline functions, but FastAPI does not
    # run startup handlers registered on that other app. Recovery therefore
    # has to be registered on the Local Engine app itself.
    acquire_instance_lock()
    ensure_job_schema()
    interrupted = recover_interrupted_jobs()
    if interrupted:
        print(f"[Local Engine] marked interrupted jobs: {interrupted}")


@app.on_event("shutdown")
def local_engine_shutdown():
    release_instance_lock()


@app.get("/", response_class=HTMLResponse)
def engine_root():
    return HTMLResponse(
        "<html><head><title>ReupAI Local Engine</title></head>"
        "<body><h1>ReupAI Local Engine</h1>"
        f"<p>status: running</p><p>version: {ENGINE_VERSION}</p><p>port: 17888</p>"
        "</body></html>"
    )


def require_token(
    authorization: Annotated[str | None, Header()] = None,
    origin: Annotated[str | None, Header()] = None,
):
    if origin and origin.rstrip("/") not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail="Origin chưa được cho phép.")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Local Engine token không hợp lệ.")
    token = authorization.removeprefix("Bearer ").strip()
    if secrets.compare_digest(token, LOCAL_TOKEN):
        return True
    session = _browser_sessions.get(token)
    if session is not None and float(session.get("expires_at", 0)) > time.time():
        # A browser session is bound to the origin that received its grant.
        # Requests carrying an untrusted Origin are rejected even if a token
        # was copied from another local page.
        session_origin = str(session.get("client_origin", ""))
        if origin and origin.rstrip("/") != session_origin:
            raise HTTPException(status_code=401, detail="Browser session không thuộc origin này.")
        return True
    if session is not None:
        _browser_sessions.pop(token, None)
    raise HTTPException(status_code=401, detail="Local Engine token không hợp lệ.")


def _validate_origin(origin: str) -> str:
    normalized = origin.strip().rstrip("/")
    if normalized not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=400, detail="Origin chưa được cho phép trong Local Engine.")
    return normalized


def _cleanup_auth_state() -> None:
    now = time.time()
    for code, record in list(_authorization_codes.items()):
        if float(record["expires_at"]) <= now:
            _authorization_codes.pop(code, None)
    for token, session in list(_browser_sessions.items()):
        if float(session.get("expires_at", 0)) <= now:
            _browser_sessions.pop(token, None)
    for ticket, record in list(_media_tickets.items()):
        if float(record.get("expires_at", 0)) <= now or record.get("session") not in _browser_sessions:
            _media_tickets.pop(ticket, None)


@app.get("/authorize", response_class=HTMLResponse)
def authorize_page(client_origin: str, redirect_uri: str, state: str = ""):
    """Render the local one-click consent page without exposing local_token."""
    origin = _validate_origin(client_origin)
    if not redirect_uri.startswith(origin + "/"):
        raise HTTPException(status_code=400, detail="Callback phải thuộc client origin.")
    safe_origin = html.escape(origin, quote=True)
    safe_redirect = html.escape(redirect_uri, quote=True)
    safe_state = html.escape(state, quote=True)
    return f"""<!doctype html>
<html lang='vi'><head><meta charset='utf-8'><title>Kết nối ReupAI</title>
<style>body{{font-family:system-ui;background:#0b1120;color:#e5e7eb;display:grid;place-items:center;min-height:100vh;margin:0}}main{{max-width:460px;background:#111827;border:1px solid #334155;border-radius:16px;padding:32px;box-shadow:0 20px 60px #0006}}h1{{margin-top:0}}p{{color:#a5b4fc;line-height:1.5}}button{{width:100%;border:0;border-radius:10px;padding:13px;background:#7c5cff;color:white;font-weight:700;cursor:pointer}}small{{display:block;margin-top:18px;color:#94a3b8}}</style></head>
<body><main><h1>Cho phép kết nối ReupAI?</h1><p>Trang web <strong>{safe_origin}</strong> sẽ được phép điều khiển Local Engine trên máy này.</p>
<form method='post' action='/api/authorize/approve'><input type='hidden' name='client_origin' value='{safe_origin}'><input type='hidden' name='redirect_uri' value='{safe_redirect}'><input type='hidden' name='state' value='{safe_state}'><button type='submit'>Cho phép</button></form>
<small>local_token chỉ được giữ trong Local Engine và không được gửi cho trình duyệt.</small></main></body></html>"""


@app.post("/api/authorize/approve")
def approve_authorization(
    client_origin: str = Form(...),
    redirect_uri: str = Form(...),
    state: str = Form(""),
):
    _cleanup_auth_state()
    origin = _validate_origin(client_origin)
    if not redirect_uri.startswith(origin + "/"):
        raise HTTPException(status_code=400, detail="Callback phải thuộc client origin.")
    authorization = _issue_browser_authorization(origin)
    code = secrets.token_urlsafe(32)
    _authorization_codes[code] = {
        "client_origin": origin,
        "redirect_uri": redirect_uri,
        "expires_at": time.time() + AUTH_CODE_TTL_SECONDS,
        "grant": authorization["grant"],
    }
    separator = "&" if "?" in redirect_uri else "?"
    location = f"{redirect_uri}{separator}code={code}"
    if state:
        location += f"&state={state}"
    return RedirectResponse(url=location, status_code=303)


@app.post("/api/authorize/connect")
def connect_authorization(
    payload: dict[str, str],
    origin: Annotated[str | None, Header()] = None,
):
    """Authorize a user-initiated one-click connection from an allowed web origin."""
    _cleanup_auth_state()
    client_origin = _validate_origin(str(payload.get("client_origin", "")))
    if not origin or origin.rstrip("/") != client_origin:
        raise HTTPException(status_code=403, detail="Yêu cầu cấp quyền không thuộc trang ReupAI hợp lệ.")
    return _issue_browser_authorization(client_origin)


@app.post("/api/authorize/token")
def exchange_authorization_code(payload: dict[str, str], origin: Annotated[str | None, Header()] = None):
    _cleanup_auth_state()
    code = str(payload.get("code", ""))
    client_origin = _validate_origin(str(payload.get("client_origin", "")))
    if origin and origin.rstrip("/") != client_origin:
        raise HTTPException(status_code=403, detail="Authorization code không thuộc origin này.")
    origin = client_origin
    record = _authorization_codes.pop(code, None)
    if not record or record["client_origin"] != origin:
        raise HTTPException(status_code=400, detail="Authorization code không hợp lệ hoặc đã hết hạn.")
    grant = str(record.get("grant", ""))
    grants = _load_authorization_grants()
    saved = grants.get(origin)
    if not grant or not saved or saved.get("fingerprint") != _grant_fingerprint(grant):
        raise HTTPException(status_code=403, detail="Authorization grant không hợp lệ.")
    session_token = _mint_browser_session(origin)
    return {
        "session_token": session_token,
        "grant": grant,
        "expires_in": SESSION_TTL_SECONDS,
        "engine": "ReupAI",
    }


@app.post("/api/authorize/session")
def refresh_browser_session(payload: dict[str, str], origin: Annotated[str | None, Header()] = None):
    _cleanup_auth_state()
    client_origin = _validate_origin(str(payload.get("client_origin", "")))
    if origin and origin.rstrip("/") != client_origin:
        raise HTTPException(status_code=403, detail="Authorization grant không thuộc origin này.")
    origin = client_origin
    grant = str(payload.get("grant", ""))
    saved = _load_authorization_grants().get(origin)
    if (
        not grant
        or not saved
        or saved.get("fingerprint") != _grant_fingerprint(grant)
        or saved.get("installation") != _installation_fingerprint()
    ):
        raise HTTPException(status_code=401, detail="Authorization grant không hợp lệ hoặc đã bị thu hồi.")
    session_token = _mint_browser_session(origin)
    return {"session_token": session_token, "expires_in": SESSION_TTL_SECONDS, "engine": "ReupAI"}


@app.post("/api/authorize/revoke")
def revoke_session(
    payload: dict[str, str] | None = None,
    _: bool = Depends(require_token),
    authorization: Annotated[str | None, Header()] = None,
    origin: Annotated[str | None, Header()] = None,
):
    token = (authorization or "").removeprefix("Bearer ").strip()
    session = _browser_sessions.get(token)
    client_origin = _validate_origin(str(payload.get("client_origin", ""))) if payload else str((session or {}).get("client_origin", ""))
    if session and client_origin != session.get("client_origin"):
        raise HTTPException(status_code=403, detail="Chỉ có thể thu hồi quyền của origin hiện tại.")
    if origin and client_origin and origin.rstrip("/") != client_origin:
        raise HTTPException(status_code=403, detail="Không thể thu hồi quyền của origin khác.")
    _browser_sessions.pop(token, None)
    if client_origin:
        grants = _load_authorization_grants()
        if grants.pop(client_origin, None) is not None:
            _save_authorization_grants(grants)
        for token, session in list(_browser_sessions.items()):
            if session.get("client_origin") == client_origin:
                _browser_sessions.pop(token, None)
    return {"revoked": True}


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "engine": "ReupAI",
        "version": ENGINE_VERSION,
        "status": "ready",
        "capabilities": ENGINE_CAPABILITIES,
    }


@app.get("/api/status")
def status(_: bool = Depends(require_token)):
    usage = shutil.disk_usage(get_runtime_root())
    return {
        "engine_running": True,
        "version": ENGINE_VERSION,
        "capabilities": ENGINE_CAPABILITIES,
        "active_jobs": len(list_active_jobs(limit=20)),
        "storage": {
            "root": str(get_runtime_root()),
            "downloads": str(get_downloads_dir()),
            "output": str(get_output_dir()),
            "free_space": usage.free,
        },
    }


@app.get("/api/diagnostics")
def diagnostics(_: bool = Depends(require_token)):
    details = runtime_diagnostics()
    details.update({
        "engine": "ReupAI",
        "version": ENGINE_VERSION,
        "active_jobs": list_active_jobs(limit=50),
        "allowed_origins": ALLOWED_ORIGINS,
    })
    return details


@app.get("/api/gemini/oauth")
def gemini_oauth_status(_: bool = Depends(require_token)):
    from services.gemini_oauth import status as oauth_status
    return oauth_status()


@app.post("/api/gemini/oauth/start")
def gemini_oauth_start(_: bool = Depends(require_token)):
    from services.gemini_oauth import start_authorization
    try:
        return start_authorization()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/gemini/oauth/verify")
def gemini_oauth_verify(_: bool = Depends(require_token)):
    from services.gemini_oauth import verify_gemini_access
    return verify_gemini_access()


@app.post("/api/gemini/oauth/enable")
def gemini_oauth_enable(_: bool = Depends(require_token)):
    from services.gemini_oauth import enable_gemini_api
    return enable_gemini_api()


@app.delete("/api/gemini/oauth")
def gemini_oauth_disconnect(_: bool = Depends(require_token)):
    from services.gemini_oauth import disconnect
    disconnect()
    return {"ok": True}


@app.post("/api/videos")
def videos(body: SourceRequest, _: bool = Depends(require_token)):
    return api_videos(body)


@app.post("/api/videos/page")
def videos_page(body: PageRequest, _: bool = Depends(require_token)):
    return api_videos_page(body)


@app.post("/api/library/direct/inspect")
def direct_video(body: DirectVideoBody, _: bool = Depends(require_token)):
    return api_direct_video(body)


@app.get("/api/library/sources")
def saved_sources(_: bool = Depends(require_token)):
    return api_saved_sources()


@app.post("/api/library/sources")
def save_source(body: SavedSourceBody, _: bool = Depends(require_token)):
    return api_save_source(body)


@app.patch("/api/library/sources/{source_id}")
def patch_source(source_id: int, body: SavedSourcePatchBody, _: bool = Depends(require_token)):
    return api_patch_source(source_id, body)


@app.delete("/api/library/sources/{source_id}")
def delete_source(source_id: int, _: bool = Depends(require_token)):
    return api_delete_source(source_id)


LOCAL_USER_ID = 0


def local_library_request() -> Request:
    request = SimpleNamespace()
    request.state = SimpleNamespace(user={"id": LOCAL_USER_ID, "role": "local"})
    return request  # type: ignore[return-value]


@app.get("/api/library/collections")
def collections(_: bool = Depends(require_token)):
    return api_collections(local_library_request())


@app.post("/api/library/collections")
def create_collection(body: CollectionCreateBody, _: bool = Depends(require_token)):
    return api_create_collection(body, local_library_request())


@app.delete("/api/library/collections/{collection_id}")
def delete_collection(collection_id: int, _: bool = Depends(require_token)):
    return api_delete_collection(collection_id, local_library_request())


@app.post("/api/library/collections/{collection_id}/videos")
def add_collection_video(collection_id: int, body: CollectionVideoBody, _: bool = Depends(require_token)):
    return api_add_collection_video(collection_id, body, local_library_request())


@app.post("/api/library/collections/{collection_id}/videos/batch")
def add_collection_videos(collection_id: int, body: CollectionVideosBody, _: bool = Depends(require_token)):
    return api_add_collection_videos(collection_id, body, local_library_request())


@app.delete("/api/library/collections/{collection_id}/videos/{video_id}")
def remove_collection_video(collection_id: int, video_id: str, _: bool = Depends(require_token)):
    return api_remove_collection_video(collection_id, video_id, local_library_request())


@app.post("/api/library/favorites/toggle")
def toggle_favorite(body: FavoriteBody, _: bool = Depends(require_token)):
    return api_toggle_favorite(body, local_library_request())


@app.get("/api/library/favorites")
def favorites(limit: int = 500, _: bool = Depends(require_token)):
    return api_library_videos(local_library_request(), favorite=True, limit=limit)


@app.get("/api/library/videos")
def library_videos(
    favorite: bool = False,
    collection_id: int | None = None,
    source_id: int | None = None,
    series: str | None = None,
    q: str | None = None,
    limit: int = 500,
    _: bool = Depends(require_token),
):
    return api_library_videos(
        local_library_request(),
        favorite=favorite,
        collection_id=collection_id,
        source_id=source_id,
        series=series,
        q=q,
        limit=limit,
    )


@app.get("/api/library/series")
def library_series(_: bool = Depends(require_token)):
    return api_series(local_library_request())


@app.get("/api/library/meta")
def library_meta(ids: str = "", _: bool = Depends(require_token)):
    return api_meta(local_library_request(), ids=ids)


@app.get("/api/library/ui-state/{state_key}")
def get_ui_state(state_key: str, _: bool = Depends(require_token)):
    return api_get_ui_state(state_key, local_library_request())


@app.put("/api/library/ui-state/{state_key}")
def put_ui_state(state_key: str, body: UiStateBody, _: bool = Depends(require_token)):
    return api_put_ui_state(state_key, body, local_library_request())


@app.get("/api/library/history")
def library_history(limit: int = 100, _: bool = Depends(require_token)):
    return {"history": load_job_history(limit=max(1, min(int(limit), 1000)))}


@app.get("/api/library/downloads")
def library_downloads(refresh: bool = False, _: bool = Depends(require_token)):
    if refresh:
        invalidate_library_scan_cache("downloads")
    return {"videos": [_with_file_path(item) for item in scan_downloaded_library()]}


@app.get("/api/library/outputs")
def library_outputs(refresh: bool = False, _: bool = Depends(require_token)):
    if refresh:
        invalidate_library_scan_cache("outputs")
    return {"outputs": [_with_file_path(item) for item in scan_outputs_library()]}


def _with_file_path(item: dict) -> dict:
    result = dict(item)
    path = Path(str(item.get("path", ""))).resolve()
    try:
        result["file_path"] = path.relative_to(get_runtime_root().resolve()).as_posix()
    except ValueError:
        result["file_path"] = ""
    # Browser receives only the safe runtime-relative identifier used by the
    # authenticated file/ticket endpoints, never the machine's absolute path.
    result.pop("path", None)
    return result


@app.get("/api/library/dashboard")
def library_dashboard(_: bool = Depends(require_token)):
    return {"stats": dashboard_data(), "recent_jobs": load_job_history(limit=12)}


@app.get("/api/me")
def local_identity(_: bool = Depends(require_token)):
    # Engine consent grants access to this workspace, not web account/admin rights.
    return {"id": LOCAL_USER_ID, "username": "Máy của bạn", "role": "local", "enabled": True}


@app.get("/api/cover")
def cover(url: str, _: bool = Depends(require_token)):
    return api_cover(url=url)


@app.get("/api/preview/source/{video_id}")
def source_preview(video_id: str, channel: str = "2d_animation", _: bool = Depends(require_token)):
    return preview_source_video(video_id=video_id, channel=channel)


@app.get("/library/source/{video_id}")
def source_file(video_id: str, _: bool = Depends(require_token)):
    return library_source(video_id=video_id)


@app.get("/api/result/{video_id}")
def result_file(video_id: str, channel: str = "2d_animation", mode: str = "subtitle", _: bool = Depends(require_token)):
    return api_result(video_id=video_id, channel=channel, mode=mode)


@app.get("/api/stream/{video_id}")
def result_stream(video_id: str, channel: str = "2d_animation", mode: str = "subtitle", _: bool = Depends(require_token)):
    return api_stream(video_id=video_id, channel=channel, mode=mode)


@app.post("/api/download")
def download(body: DownloadRequest, local_only: bool = False, _: bool = Depends(require_token)):
    return api_download(body, local_only=local_only)


def local_request() -> Request:
    request = SimpleNamespace()
    # A Local Engine consent session is not a cloud/local dashboard account.
    # Keep created_by NULL instead of assuming that users.id=1 exists on a
    # fresh installation (foreign key checks are enabled for data integrity).
    request.state = SimpleNamespace(user={"id": None, "role": "local"})
    return request  # type: ignore[return-value]


@app.post("/api/process")
def process(body: ProcessRequest, _: bool = Depends(require_token)):
    return api_process(body, local_request())


@app.get("/api/outputs/{video_id}/edit")
def output_edit(video_id: str, channel: str = "2d_animation", mode: str = "subtitle", _: bool = Depends(require_token)):
    return api_output_edit(video_id=video_id, channel=channel, mode=mode)


@app.post("/api/outputs/{video_id}/rerender")
def output_rerender(video_id: str, body: RenderEditRequest, _: bool = Depends(require_token)):
    return api_output_rerender(video_id=video_id, body=body, request=local_request())


@app.get("/api/jobs")
def jobs(_: bool = Depends(require_token)):
    return {"jobs": list_active_jobs(limit=50)}


@app.get("/api/jobs/{video_id}")
def job_status(video_id: str, channel: str = "2d_animation", mode: str = "subtitle", _: bool = Depends(require_token)):
    return api_process_status(video_id=video_id, channel=channel, mode=mode)


@app.post("/api/jobs/{video_id}/stop")
def stop_job(video_id: str, channel: str = "2d_animation", mode: str = "subtitle", _: bool = Depends(require_token)):
    return api_process_stop(video_id=video_id, channel=channel, mode=mode)


@app.get("/api/files/{file_path:path}")
def file_download(file_path: str, _: bool = Depends(require_token)):
    return _serve_local_file(file_path)


def _serve_local_file(file_path: str):
    requested = (get_runtime_root() / file_path).resolve()
    root = get_runtime_root().resolve()
    allowed_dirs = {"downloads", "channels", "jobs", "output", "projects"}
    allowed_suffixes = {".mp4", ".webm", ".mkv", ".mov", ".avi", ".wav", ".mp3", ".aac", ".m4a", ".ogg", ".flac", ".srt", ".vtt", ".ass", ".png", ".jpg", ".jpeg", ".webp", ".gif"}
    try:
        relative = requested.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=404, detail="Không tìm thấy file local.")
    if not relative.parts or relative.parts[0] not in allowed_dirs or requested.suffix.lower() not in allowed_suffixes or not requested.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file local.")
    return FileResponse(str(requested), headers={"Cache-Control": "private, no-store"})


@app.post("/api/media/tickets")
def create_media_ticket(payload: dict[str, str], authorization: Annotated[str | None, Header()] = None, origin: Annotated[str | None, Header()] = None, _: bool = Depends(require_token)):
    _cleanup_auth_state()
    token = (authorization or "").removeprefix("Bearer ").strip()
    session = _browser_sessions.get(token)
    if not session or not origin or session.get("client_origin") != origin.rstrip("/"):
        raise HTTPException(status_code=403, detail="Media yêu cầu browser session đúng origin.")
    path = str(payload.get("path", ""))
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc or not path.startswith(("/api/files/", "/api/cover?", "/api/preview/source/", "/api/stream/", "/api/result/", "/library/source/")):
        raise HTTPException(status_code=400, detail="Media path không hợp lệ.")
    download = str(payload.get("download", "")).lower() in {"1", "true", "yes"}
    requested_name = str(payload.get("filename", "")).replace("\\", "/").rsplit("/", 1)[-1].replace("\r", "").replace("\n", "").strip()
    filename = requested_name or "reupai-media"
    ticket = secrets.token_urlsafe(32)
    _media_tickets[ticket] = {"session": token, "origin": origin.rstrip("/"), "path": path, "download": download, "filename": filename, "expires_at": time.time() + MEDIA_TICKET_TTL_SECONDS}
    return {"url": f"/api/media/{ticket}", "expires_in": MEDIA_TICKET_TTL_SECONDS, "download": download}


@app.get("/api/media/{ticket}")
def ticket_media(ticket: str, origin: Annotated[str | None, Header()] = None):
    _cleanup_auth_state()
    record = _media_tickets.get(ticket)
    origin_is_valid = bool(origin and origin.rstrip("/") == record.get("origin") and origin.rstrip("/") in ALLOWED_ORIGINS) if record else False
    # Downloads are browser navigations, which do not always include Origin.
    # The opaque, short-lived ticket was already created through an authorized
    # session, so permit this one navigation while retaining origin checks for
    # previews and all other embedded media.
    if not record or (not origin_is_valid and not record.get("download")):
        raise HTTPException(status_code=401, detail="Media ticket không hợp lệ hoặc đã hết hạn.")
    if record.get("download"):
        _media_tickets.pop(ticket, None)
    parsed = urlsplit(str(record["path"]))
    path = unquote(parsed.path)
    query = parse_qs(parsed.query)
    if path.startswith("/api/files/"):
        response = _serve_local_file(path[len("/api/files/"):])
    elif path == "/api/cover":
        response = api_cover(url=query.get("url", [""])[0])
    elif path.startswith("/api/preview/source/"):
        response = preview_source_video(
            video_id=path.rsplit("/", 1)[-1],
            channel=query.get("channel", ["2d_animation"])[0],
        )
    elif path.startswith("/library/source/"):
        response = library_source(video_id=path.rsplit("/", 1)[-1])
    elif path.startswith(("/api/stream/", "/api/result/")):
        handler = api_stream if path.startswith("/api/stream/") else api_result
        response = handler(video_id=path.rsplit("/", 1)[-1], channel=query.get("channel", ["2d_animation"])[0], mode=query.get("mode", ["subtitle"])[0])
    else:
        raise HTTPException(status_code=400, detail="Media path không hợp lệ.")
    response.headers["Cache-Control"] = "private, no-store"
    if record.get("download"):
        response.headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(str(record.get("filename") or "reupai-media"), safe="")
    return response


def main():
    uvicorn.run(app, host="127.0.0.1", port=17888, log_level="info")


if __name__ == "__main__":
    main()


