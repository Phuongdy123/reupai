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
import threading
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, urlsplit, parse_qs, unquote
from types import SimpleNamespace
from typing import Annotated, Any, Literal

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
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from starlette.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

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
    local_source_for_process,
    job_dir_for,
    find_result_file,
    validate_channel,
    validate_video_id,
    library_source,
    active_download_count,
)
from services.library_api import (
    CollectionCreateBody,
    CollectionVideoBody,
    CollectionVideosBody,
    DirectVideoBody,
    FavoriteBody,
    SavedSeriesBody,
    SavedSourceBody,
    SavedSourcePatchBody,
    UiStateBody,
    api_add_collection_video,
    api_add_collection_videos,
    api_collections,
    api_create_collection,
    api_delete_collection,
    api_delete_saved_series,
    api_delete_source,
    api_direct_video,
    api_get_ui_state,
    api_library_videos,
    api_list_saved_series,
    api_meta,
    api_patch_source,
    api_put_ui_state,
    api_remove_collection_video,
    api_save_series,
    api_save_source,
    api_saved_sources,
    api_series,
    api_toggle_favorite,
)


from services.windows_distribution import distribution_info


ENGINE_VERSION = "0.2.56"
ENGINE_CAPABILITIES = {
    "verified_updates": not distribution_info()["managedUpdates"],
    "store_updates": distribution_info()["channel"] == "msix",
    "google_oauth_browser_fallback": True,
    "gemini_project_discovery": True,
    "gemini_project_creation": True,
    "direct_authorization": True,
    "media_tickets": True,
    "runtime_readiness": True,
    "gemini_google_oauth": True,
    "gemini_api_enablement": True,
    "gemini_auto_repair": True,
    "google_gemini_login": True,
    "workspace_assistant": True,
    "billing_ledger": True,
    "source_language": True,
    "subtitle_ocr": True,
    "manual_subtitle_translation": True,
    "reviewed_translations": True,
    "output_subtitle_edit": True,
    "subtitle_srt_export": True,
    "youtube_publishing": True,
    "gemini_thumbnail_artwork": True,
    "translation_model_selection": True,
    "social_publish": True,
    "subtitle_styles": True,
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
        "http://localhost:3010",
        "http://127.0.0.1:3010",
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

    # Keep every unexpired browser session for this origin alive.  A user may
    # open ReupAI in several tabs (or sign in with another web account) while
    # all pages control the same Local Engine on this machine.  Older builds
    # revoked the first page as soon as a second page connected.

    return {
        "session_token": _mint_browser_session(origin),
        "grant": grant,
        "expires_in": SESSION_TTL_SECONDS,
        "engine": "ReupAI",
    }


_update_manager = None
_update_init_lock = threading.Lock()


def get_update_manager():
    global _update_manager
    with _update_init_lock:
        if _update_manager is None:
            from services.engine_updates import UpdateManager
            from services.engine_runtime import bundled_resource
            _update_manager = UpdateManager(
                ENGINE_VERSION, get_runtime_root() / "updates",
                lambda: bool(list_active_jobs(limit=1) or active_download_count()),
                install_dir=Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else None,
                helper=bundled_resource("app", "assets", "update-installer.ps1"),
            )
    return _update_manager


app = FastAPI(title="ReupAI Local Engine", version=ENGINE_VERSION)

@app.middleware("http")
async def update_work_gate(request: Request, call_next):
    path = request.url.path
    is_work = path.startswith("/api/") and not (
        path in {"/api/health", "/api/status"} or path.startswith("/api/updates")
    )
    if not is_work:
        return await call_next(request)
    updater = get_update_manager()
    if not updater.enter_work():
        return JSONResponse({"detail": "ReupAI đang cài bản cập nhật. Hãy chờ kết nối lại."}, status_code=503)
    try:
        return await call_next(request)
    finally:
        updater.leave_work()


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Range", "X-ReupAI-Account"],
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
    threading.Thread(target=get_update_manager().check, daemon=True, name="reupai-release-check").start()
    interrupted = recover_interrupted_jobs()
    if interrupted:
        print(f"[Local Engine] marked interrupted jobs: {interrupted}")


@app.on_event("shutdown")
def local_engine_shutdown():
    if _update_manager is not None:
        _update_manager.cancelled.set()
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
        "distribution": get_update_manager().distribution,
    }


@app.get("/api/status")
def status(_: bool = Depends(require_token)):
    usage = shutil.disk_usage(get_runtime_root())
    return {
        "engine_running": True,
        "pid": os.getpid(),
        "version": ENGINE_VERSION,
        "capabilities": ENGINE_CAPABILITIES,
        "active_jobs": len(list_active_jobs(limit=20)),
        "distribution": get_update_manager().distribution,
        "active_downloads": active_download_count(),
        "storage": {
            "root": str(get_runtime_root()),
            "downloads": str(get_downloads_dir()),
            "output": str(get_output_dir()),
            "free_space": usage.free,
        },
    }


@app.get("/api/updates")
def update_status(_: bool = Depends(require_token)):
    return get_update_manager().snapshot()


@app.post("/api/updates/check")
def update_check(_: bool = Depends(require_token)):
    threading.Thread(target=get_update_manager().check, daemon=True).start()
    return get_update_manager().snapshot()


@app.post("/api/updates/start")
def update_start(_: bool = Depends(require_token)):
    try:
        return get_update_manager().start()
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/api/updates/cancel")
def update_cancel(_: bool = Depends(require_token)):
    try:
        return get_update_manager().cancel()
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.get("/api/diagnostics")
def diagnostics(_: bool = Depends(require_token)):
    details = runtime_diagnostics()
    details.update({
        "engine": "ReupAI",
        "version": ENGINE_VERSION,
        "active_jobs": list_active_jobs(limit=50),
        "active_downloads": active_download_count(),
        "allowed_origins": ALLOWED_ORIGINS,
    })
    return details


@app.post("/api/diagnostics/whisper")
def diagnostics_whisper(_: bool = Depends(require_token)):
    """Probe the native speech stack in a child so a bad DLL cannot kill Engine."""
    from services.transcriber import _ensure_native_runtime

    try:
        _ensure_native_runtime()
    except Exception as error:
        return {"ready": False, "message": str(error)[:600]}
    return {"ready": True, "message": "Whisper và CTranslate2 đã nạp thành công."}


@app.get("/api/gemini/oauth")
def gemini_oauth_status(_: bool = Depends(require_token)):
    from services.gemini_oauth import status as oauth_status
    return oauth_status()


def youtube_owner(x_reupai_account: Annotated[str | None, Header()] = None, _: bool = Depends(require_token)):
    from services.social_identity import account_for_token
    try:
        return account_for_token(x_reupai_account or "")
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


def _youtube_call(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except PermissionError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        # Do not send Google credentials, response bodies or local paths to the browser.
        raise HTTPException(status_code=503, detail="YouTube chưa hoàn tất yêu cầu. Kiểm tra kết nối và thử lại.") from error


@app.get("/api/youtube/connection")
def youtube_connection(owner: str = Depends(youtube_owner)):
    from services.youtube_publishing import connection_status
    return _youtube_call(connection_status, owner)


@app.post("/api/youtube/connect")
def youtube_connect(owner: str = Depends(youtube_owner)):
    from services.youtube_publishing import start_connection
    return _youtube_call(start_connection, owner)


@app.delete("/api/youtube/connection")
def youtube_disconnect(owner: str = Depends(youtube_owner)):
    from services.youtube_publishing import disconnect
    _youtube_call(disconnect, owner)
    return {"ok": True}


def _youtube_video(payload, owner):
    if payload.get("account_id") != owner:
        raise HTTPException(status_code=403, detail="Tài khoản đã thay đổi. Hãy mở lại cửa sổ đăng YouTube.")
    video_id = validate_video_id(str(payload.get("video_id", "")))
    channel = validate_channel(str(payload.get("channel", "default")))
    mode = payload.get("mode", "subtitle")
    if mode not in {"subtitle", "voiceover"}:
        raise HTTPException(status_code=400, detail="Chỉ đăng video thành phẩm, không đăng file SRT.")
    video = find_result_file(channel, video_id, mode)
    if not video:
        raise HTTPException(status_code=404, detail="Không tìm thấy video thành phẩm. Làm mới thư viện rồi thử lại.")
    return video


@app.post("/api/youtube/thumbnails")
def youtube_thumbnails(payload: dict, owner: str = Depends(youtube_owner)):
    from services.youtube_publishing import thumbnail_choices
    return {"images": _youtube_call(thumbnail_choices, _youtube_video(payload, owner))}


@app.post("/api/youtube/thumbnail-artwork")
def youtube_thumbnail_artwork(payload: dict, owner: str = Depends(youtube_owner)):
    from services.youtube_publishing import generate_thumbnail_artwork
    _youtube_video(payload, owner)
    return _youtube_call(generate_thumbnail_artwork, payload.get("reference"), payload.get("prompt"))


@app.post("/api/youtube/suggest")
def youtube_suggest(payload: dict, owner: str = Depends(youtube_owner)):
    from services.youtube_publishing import suggest_metadata
    images = payload.get("images", [])
    if not isinstance(images, list) or len(images) > 3:
        raise HTTPException(status_code=400, detail="Chỉ chọn tối đa 3 ảnh để gợi ý nội dung.")
    return _youtube_call(suggest_metadata, _youtube_video(payload, owner), str(payload.get("title", "")),
                         str(payload.get("instructions", "")), images)


@app.post("/api/youtube/social/{provider}/destination")
def social_destination(provider: str, payload: dict, owner: str = Depends(youtube_owner)):
    from services.social_publishing import destination
    return _youtube_call(destination, provider, payload.get("token"))


@app.post("/api/youtube/social/{provider}/publish")
def social_publish(provider: str, payload: dict, owner: str = Depends(youtube_owner)):
    from services.social_publishing import start
    video = _youtube_video(payload, owner) if provider == "tiktok" or payload.get("include_video") is True else None
    return _youtube_call(start, owner, provider, payload, video)


@app.get("/api/youtube/social/{provider}/publish/{request_id}")
def social_publish_status(provider: str, request_id: str, owner: str = Depends(youtube_owner)):
    from services.social_publishing import status
    return _youtube_call(status, owner, provider, request_id)


@app.post("/api/youtube/uploads")
def youtube_upload(payload: dict, owner: str = Depends(youtube_owner)):
    from services.youtube_publishing import start_upload
    return _youtube_call(start_upload, owner, _youtube_video(payload, owner), payload)


@app.get("/api/youtube/uploads/{job_id}")
def youtube_upload_status(job_id: str, owner: str = Depends(youtube_owner)):
    from services.youtube_publishing import upload_status
    return _youtube_call(upload_status, owner, job_id)


@app.get("/api/youtube/videos/{youtube_video_id}/status")
def youtube_video_copyright_status(youtube_video_id: str, owner: str = Depends(youtube_owner)):
    from services.youtube_publishing import check_video_copyright_status
    return _youtube_call(check_video_copyright_status, owner, youtube_video_id)


@app.post("/api/assistant")
def workspace_assistant(payload: dict, _: bool = Depends(require_token)):
    from services.assistant_service import ask_assistant

    try:
        return ask_assistant(
            message=payload.get("message") if isinstance(payload.get("message"), str) else "",
            kind=payload.get("kind") if isinstance(payload.get("kind"), str) else "question",
            mode=payload.get("mode") if isinstance(payload.get("mode"), str) else "subtitle",
            image_data=payload.get("image_data") if isinstance(payload.get("image_data"), str) else None,
            video_context=payload.get("video_context") if isinstance(payload.get("video_context"), dict) else None,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/api/copyright/check")
def copyright_check(payload: dict, _: bool = Depends(require_token)):
    from services.copyright_checker import check_video_copyright

    raw_video_id = str(payload.get("video_id") or "").strip()
    raw_channel = str(payload.get("channel") or "default").strip() or "default"
    mode = str(payload.get("mode") or "voiceover").strip() or "voiceover"
    video_path = None
    if raw_video_id:
        try:
            vid = validate_video_id(raw_video_id)
            ch = validate_channel(raw_channel)
            video_path = find_result_file(ch, vid, mode) or local_source_for_process(vid, ch)
        except Exception:
            video_path = None

    orig_vol = payload.get("original_volume")
    try:
        orig_vol_float = float(orig_vol) if orig_vol is not None else (1.0 if mode == "subtitle" else 0.15)
    except (TypeError, ValueError):
        orig_vol_float = 0.15

    return check_video_copyright(
        video_path=video_path,
        title=str(payload.get("title") or ""),
        description=str(payload.get("description") or ""),
        url=str(payload.get("url") or ""),
        mode=mode,
        original_volume=orig_vol_float,
        music_url=str(payload.get("music_url") or ""),
        auto_brand_blur=bool(payload.get("auto_brand_blur")),
        has_blur_region=bool(payload.get("has_blur_region")),
        use_ai=bool(payload.get("use_ai", True)),
        audd_api_token=str(payload.get("audd_api_token") or ""),
        acrcloud_host=str(payload.get("acrcloud_host") or ""),
        acrcloud_access_key=str(payload.get("acrcloud_access_key") or ""),
        acrcloud_access_secret=str(payload.get("acrcloud_access_secret") or ""),
    )


@app.post("/api/shorts/highlights")
def shorts_highlights(payload: dict, _: bool = Depends(require_token)):
    from services.shorts_highlighter import cut_short_highlight_clip, suggest_viral_highlights

    raw_video_id = str(payload.get("video_id") or "").strip()
    raw_channel = str(payload.get("channel") or "default").strip() or "default"
    mode = str(payload.get("mode") or "voiceover").strip() or "voiceover"
    title = str(payload.get("title") or "")
    duration_seconds = float(payload.get("duration_seconds") or 0.0)
    cut = bool(payload.get("cut"))
    clip_index = payload.get("clip_index")

    if not raw_video_id:
        raise HTTPException(status_code=400, detail="Thiếu video_id.")
    vid = validate_video_id(raw_video_id)
    ch = validate_channel(raw_channel)
    jdir = job_dir_for(ch, vid)
    srt_path = next(
        (p for p in (jdir / "vietnamese.srt", jdir / "chinese.srt") if p.is_file()),
        None,
    )
    clips = payload.get("clips") if isinstance(payload.get("clips"), list) else None
    if not clips:
        clips = suggest_viral_highlights(
            srt_path=srt_path,
            title=title,
            duration_seconds=duration_seconds,
            max_clips=int(payload.get("max_clips") or 4),
        )

    if cut:
        source_video = find_result_file(ch, vid, mode) or local_source_for_process(vid, ch)
        if not source_video or not Path(source_video).is_file():
            raise HTTPException(status_code=404, detail="Không tìm thấy file video nguồn hoặc thành phẩm để cắt Shorts.")
        shorts_dir = jdir / "shorts"
        shorts_dir.mkdir(parents=True, exist_ok=True)
        for idx, clip in enumerate(clips):
            if clip_index is not None and idx != int(clip_index):
                continue
            out_name = f"{vid}_short_{idx + 1}.mp4"
            out_path = shorts_dir / out_name
            cut_short_highlight_clip(
                source_video=Path(source_video),
                output_path=out_path,
                start=float(clip.get("start") or 0.0),
                end=float(clip.get("end") or 30.0),
            )
            clip["file_path"] = str(out_path)
            clip["download_url"] = f"/api/shorts/file/{ch}/{vid}/{out_name}"

    return {"ok": True, "video_id": vid, "channel": ch, "clips": clips}


@app.get("/api/shorts/file/{channel}/{video_id}/{filename}")
def shorts_download(channel: str, video_id: str, filename: str, _: bool = Depends(require_token)):
    ch = validate_channel(channel)
    vid = validate_video_id(video_id)
    safe_name = Path(filename).name
    target = job_dir_for(ch, vid) / "shorts" / safe_name
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file Short.")
    return FileResponse(str(target), filename=safe_name, media_type="video/mp4")


@app.post("/api/series/merge")
def series_merge(payload: dict, _: bool = Depends(require_token)):
    from services.series_merger import merge_series_videos

    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    mode = str(payload.get("mode") or "voiceover").strip() or "voiceover"
    series_name = str(payload.get("series_name") or "full_bo").strip() or "full_bo"
    video_paths: list[Path] = []
    titles: list[str] = []
    first_ch = "default"
    for idx, item in enumerate(items, start=1):
        if not isinstance(item, dict) or not item.get("video_id"):
            continue
        vid = validate_video_id(str(item["video_id"]))
        ch = validate_channel(str(item.get("channel") or "default"))
        if idx == 1:
            first_ch = ch
        found = find_result_file(ch, vid, mode)
        if found and Path(found).is_file():
            video_paths.append(Path(found))
            titles.append(str(item.get("title") or f"Tập {idx}"))

    if len(video_paths) < 2:
        raise HTTPException(status_code=400, detail="Cần ít nhất 2 tập đã render thành phẩm để gộp Full Bộ.")

    safe_slug = "".join(c if c.isalnum() or c in "-_" else "_" for c in series_name)[:48].strip("_") or "full_bo"
    out_name = f"{safe_slug}_{mode}_full.mp4"
    first_vid = validate_video_id(str(items[0]["video_id"]))
    out_dir = job_dir_for(first_ch, first_vid).parent / "_series_merged"
    out_path = out_dir / out_name
    result = merge_series_videos(video_paths, titles, out_path)
    result["download_url"] = f"/api/series/file/{first_ch}/{out_name}"
    return {"ok": True, **result}


@app.get("/api/series/file/{channel}/{filename}")
def series_merged_download(channel: str, filename: str, _: bool = Depends(require_token)):
    ch = validate_channel(channel)
    safe_name = Path(filename).name
    target = job_dir_for(ch, "placeholder").parent / "_series_merged" / safe_name
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file Full Bộ đã gộp.")
    return FileResponse(str(target), filename=safe_name, media_type="video/mp4")


@app.post("/api/thumbnails/auto-hook")
def thumbnails_auto_hook(payload: dict, _: bool = Depends(require_token)):
    from services.thumbnail_generator import generate_hook_thumbnail

    raw_video_id = str(payload.get("video_id") or "").strip()
    raw_channel = str(payload.get("channel") or "default").strip() or "default"
    mode = str(payload.get("mode") or "voiceover").strip() or "voiceover"
    hook_text = str(payload.get("hook_text") or payload.get("title") or "")
    ts = float(payload.get("timestamp_seconds") or 12.0)
    if not raw_video_id:
        raise HTTPException(status_code=400, detail="Thiếu video_id.")
    vid = validate_video_id(raw_video_id)
    ch = validate_channel(raw_channel)
    source = find_result_file(ch, vid, mode) or local_source_for_process(vid, ch)
    if not source or not Path(source).is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file video để tạo thumbnail.")
    data_url = generate_hook_thumbnail(Path(source), hook_text, timestamp_seconds=ts)
    return {"ok": True, "thumbnail": data_url}


@app.post("/api/music/pixabay")
def music_pixabay_search(payload: dict, _: bool = Depends(require_token)):
    import urllib.parse
    import urllib.request

    api_key = str(payload.get("api_key") or "").strip()
    query = str(payload.get("query") or "epic cinematic").strip() or "epic cinematic"
    if not api_key:
        raise HTTPException(status_code=400, detail="Chưa cấu hình Pixabay API Key.")
    url = f"https://pixabay.com/api/videos/?key={urllib.parse.quote(api_key)}&q={urllib.parse.quote(query)}&per_page=5"
    # Note: Pixabay audio/music uses official partner endpoint or freesound; fallback cleanly
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ReupAI/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return {"ok": True, "hits": data.get("hits", [])[:5]}
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Lỗi kết nối Pixabay: {err}") from err


@app.post("/api/gemini/oauth/start")
def gemini_oauth_start(payload: dict[str, str] | None = None, _: bool = Depends(require_token)):
    from services.gemini_oauth import start_authorization
    try:
        values = payload or {}
        return start_authorization(nonce_hash=values.get("nonce_hash"), open_browser=values.get("browser") != "web", return_to=values.get("return_to"))
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/gemini/oauth/login-result")
def gemini_oauth_login_result(payload: dict[str, str], _: bool = Depends(require_token)):
    from services.gemini_oauth import take_login_identity
    return take_login_identity(str(payload.get("login_request", "")))


@app.put("/api/gemini/project")
def gemini_project_set(payload: dict[str, str], _: bool = Depends(require_token)):
    from services.gemini_oauth import set_project_id
    try:
        return {"project_id": set_project_id(str(payload.get("project_id", "")))}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/gemini/projects/detect")
def gemini_projects_detect(payload: dict | None = None, _: bool = Depends(require_token)):
    from services.google_projects import detect_projects
    return detect_projects(force=(payload or {}).get("force") is True)


@app.get("/api/gemini/projects/setup")
def gemini_project_setup_status(_: bool = Depends(require_token)):
    from services.google_project_setup import project_setup
    return project_setup()


@app.post("/api/gemini/projects/setup")
def gemini_project_setup_create(payload: dict | None = None, _: bool = Depends(require_token)):
    if (payload or {}).get("confirmed") is not True:
        raise HTTPException(status_code=400, detail="Bấm Tự tạo project và kết nối để xác nhận tạo project trong tài khoản Google của bạn.")
    from services.google_project_setup import project_setup
    replacement = (payload or {}).get("replace_project")
    if replacement is not None and (not isinstance(replacement, str) or not replacement):
        raise HTTPException(status_code=400, detail="Project cần thay thế không hợp lệ.")
    return project_setup(create=True, replace_project=replacement)


@app.get("/api/gemini/oauth/verify")
def gemini_oauth_verify(_: bool = Depends(require_token)):
    from services.gemini_oauth import verify_gemini_access
    return verify_gemini_access()


@app.post("/api/gemini/oauth/enable")
def gemini_oauth_enable(_: bool = Depends(require_token)):
    from services.gemini_oauth import enable_gemini_api
    return enable_gemini_api()


@app.post("/api/gemini/oauth/repair")
def gemini_oauth_repair(_: bool = Depends(require_token)):
    from services.gemini_oauth import repair_gemini_access
    return repair_gemini_access()


@app.delete("/api/gemini/oauth")
def gemini_oauth_disconnect(_: bool = Depends(require_token)):
    from services.gemini_oauth import disconnect
    disconnect()
    return {"ok": True}


class DouyinCookiesBody(BaseModel):
    cookies: Any = ""
    browser: str = ""


class DouyinLoginBody(BaseModel):
    url: str = "https://www.douyin.com/"


@app.post("/api/videos")
def videos(body: SourceRequest, _: bool = Depends(require_token)):
    return api_videos(body)


@app.post("/api/videos/page")
def videos_page(body: PageRequest, _: bool = Depends(require_token)):
    return api_videos_page(body)


@app.get("/api/douyin/status")
def douyin_status(_: bool = Depends(require_token)):
    from services.sources.douyin import douyin_session_status
    return douyin_session_status()


@app.post("/api/douyin/cookies")
def douyin_cookies(body: DouyinCookiesBody, _: bool = Depends(require_token)):
    from services.sources.douyin import save_douyin_cookies, try_import_browser_cookies
    if body.cookies:
        try:
            return save_douyin_cookies(body.cookies, source="user-paste")
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
    return try_import_browser_cookies()


@app.post("/api/douyin/login")
def douyin_login(body: DouyinLoginBody | None = None, _: bool = Depends(require_token)):
    from services.sources.douyin import DouyinUnavailable, open_login_session
    target = body.url if body else "https://www.douyin.com/"
    try:
        return open_login_session(target)
    except DouyinUnavailable as err:
        raise HTTPException(status_code=503, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


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


def _saved_series_file() -> Path:
    return get_config_dir() / "saved_series.json"


def _migrate_legacy_saved_series_once() -> None:
    path = _saved_series_file()
    if not path.is_file():
        return
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(items, list):
            req = local_library_request()
            for entry in reversed(items):
                if not isinstance(entry, dict) or not str(entry.get("series_key") or "").strip():
                    continue
                body = SavedSeriesBody(
                    series_key=str(entry.get("series_key") or "").strip(),
                    name=str(entry.get("name") or entry.get("series_key") or "").strip(),
                    source_key=str(entry.get("source_key") or ""),
                    source_label=str(entry.get("source_label") or ""),
                    sort_mode=str(entry.get("sort_mode") or "episode_asc"),
                    config=entry.get("config") if isinstance(entry.get("config"), dict) else {},
                    video_ids=[str(v) for v in (entry.get("video_ids") or []) if v],
                )
                api_save_series(body, req)
        path.replace(path.with_name("saved_series.json.migrated"))
    except Exception:
        pass


@app.get("/api/library/series/saved")
def list_saved_series(_: bool = Depends(require_token)):
    _migrate_legacy_saved_series_once()
    return api_list_saved_series(local_library_request())


@app.post("/api/library/series/saved")
def upsert_saved_series(body: SavedSeriesBody, _: bool = Depends(require_token)):
    return api_save_series(body, local_library_request())


@app.delete("/api/library/series/saved/{series_key}")
def remove_saved_series(series_key: str, _: bool = Depends(require_token)):
    return api_delete_saved_series(series_key, local_library_request())


_TTS_PREVIEW_LOCK = threading.Lock()


@app.post("/api/tts/preview")
def preview_tts_voice(payload: dict[str, Any], _: bool = Depends(require_token)):
    from services import tts

    voice = str(payload.get("voice") or "Trúc Ly").strip() or "Trúc Ly"
    text = str(payload.get("text") or "1 2 3, xin chào! Tôi là bình luận viên AI của bạn.").strip()[:240]
    if not text:
        raise HTTPException(status_code=400, detail="Thiếu nội dung đọc thử.")

    digest = hashlib.sha256(f"{voice}|{text}".encode("utf-8")).hexdigest()[:16]
    preview_dir = get_config_dir() / "voice_previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    out_wav = preview_dir / f"{digest}.wav"

    if not out_wav.is_file() or out_wav.stat().st_size == 0:
        with _TTS_PREVIEW_LOCK:
            if not out_wav.is_file() or out_wav.stat().st_size == 0:
                previous_voice = tts.VOICE
                try:
                    tts.set_voice(voice)
                    tts.generate_tts(text, str(out_wav))
                except Exception as error:
                    out_wav.unlink(missing_ok=True)
                    raise HTTPException(status_code=500, detail=f"Không tạo được giọng đọc thử: {error}") from error
                finally:
                    tts.set_voice(previous_voice)

    return Response(content=out_wav.read_bytes(), media_type="audio/wav")


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
    subtitle_path = str(item.get("subtitle_path", "") or "")
    if subtitle_path:
        try:
            result["srt_file_path"] = Path(subtitle_path).resolve().relative_to(
                get_runtime_root().resolve()
            ).as_posix()
        except ValueError:
            result["srt_file_path"] = ""
    else:
        result["srt_file_path"] = ""
    result.pop("subtitle_path", None)
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
def source_preview(video_id: str, channel: str = "default", _: bool = Depends(require_token)):
    return preview_source_video(video_id=video_id, channel=channel)


_subtitle_preview_lock = threading.Lock()


@lru_cache(maxsize=16)
def _detect_preview_subtitle_region(path: str, size: int, mtime_ns: int) -> dict:
    from services.subtitle_detector import SubtitleRegionNotFound, detect_subtitle_region

    with _subtitle_preview_lock:
        try:
            region, _ = detect_subtitle_region(path)
        except SubtitleRegionNotFound as error:
            raise HTTPException(
                status_code=422,
                detail="AI chưa xác định được phụ đề gốc. Hãy chọn vùng mờ thủ công trên video.",
            ) from error
    return {
        "blur": region["blur"],
        "video": region["video"],
        "preview_time_seconds": region.get("detected", {}).get("preview_time_seconds", 0),
        "confidence": region.get("detected", {}).get("confidence", 0),
    }


@app.get("/api/preview/subtitle-region/{video_id}")
async def subtitle_region_preview(
    video_id: str,
    channel: str = "default",
    _: bool = Depends(require_token),
):
    path = local_source_for_process(validate_channel(channel), validate_video_id(video_id))
    if not path:
        raise HTTPException(status_code=404, detail="Hãy tải video về máy trước khi xem thử vùng mờ.")
    source = Path(path)
    stat = source.stat()
    return await run_in_threadpool(
        _detect_preview_subtitle_region,
        str(source),
        stat.st_size,
        stat.st_mtime_ns,
    )


class SubtitleOcrPreviewRequest(BaseModel):
    channel: str = "default"
    region: dict = Field(default_factory=dict)
    language: str = "auto"
    fps: float = 2.0
    min_confidence: float = 0.45
    parallelism: int = 2
    use_gpu: bool = False


class AudioTranscriptPreviewRequest(BaseModel):
    channel: str = "default"
    source_language: str = "auto"


_transcript_preview_jobs: dict[str, dict] = {}
_transcript_preview_jobs_lock = threading.Lock()
_TRANSCRIPT_PREVIEW_TTL_SECONDS = 30 * 60


class ManualSubtitleTranslationLine(BaseModel):
    id: int
    text: str = Field(min_length=1, max_length=1000)


class ManualSubtitleTranslationRequest(BaseModel):
    lines: list[ManualSubtitleTranslationLine] = Field(min_length=1, max_length=20)
    source_language: str = "auto"
    target_language: Literal["vi", "en", "zh", "ja", "ko", "th", "id", "es", "pt", "fr", "de", "ru"] = "vi"
    translation_model: Literal["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.8-flash"] = "gemini-3.1-flash-lite"


@app.post("/api/preview/subtitles/{video_id}")
async def subtitle_lines_preview(video_id: str, body: SubtitleOcrPreviewRequest, _: str = Depends(require_token)):
    path = local_source_for_process(validate_channel(body.channel), validate_video_id(video_id))
    if not path:
        raise HTTPException(status_code=404, detail="Hãy tải video về máy trước khi quét phụ đề.")
    if not 0.5 <= body.fps <= 10:
        raise HTTPException(status_code=422, detail="FPS OCR phải nằm trong khoảng 0,5–10.")
    try:
        from services.subtitle_ocr import preview_subtitle_lines
        return await run_in_threadpool(
            preview_subtitle_lines, Path(path), region=body.region, language=body.language,
            fps=body.fps, min_confidence=body.min_confidence,
            parallelism=body.parallelism, use_gpu=body.use_gpu,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def _transcribe_audio_preview(source_path: Path, audio_path: Path, language: str, task_id: str):
    from core.pipeline import extract_audio
    from services.transcriber import transcribe
    seen_segments: set[tuple] = set()

    def update(**values):
        with _transcript_preview_jobs_lock:
            task = _transcript_preview_jobs.get(task_id)
            if task:
                task.update(values)

    def on_progress(processed: float, total: float):
        total = max(0.0, float(total or 0))
        processed = max(0.0, min(float(processed or 0), total)) if total else 0.0
        update(progress=round(processed / total * 100) if total else 0,
               processed_seconds=round(processed, 2), total_seconds=round(total, 2))

    def on_segment(line: dict):
        text = str(line.get("text", "")).strip()
        start, end = float(line.get("start", 0)), float(line.get("end", 0))
        if not text or end <= start:
            return
        key = (round(start, 2), round(end, 2), text)
        with _transcript_preview_jobs_lock:
            task = _transcript_preview_jobs.get(task_id)
            if task and key not in seen_segments:
                seen_segments.add(key)
                task["lines"].append({"id": len(task["lines"]) + 1, "start": start, "end": end, "text": text})
                task["line_count"] = len(task["lines"])

    try:
        audio_path.parent.mkdir(parents=True, exist_ok=True)
        update(phase="extracting_audio", message="Đang tách âm thanh từ video…")
        extract_audio(source_path, audio_path, force=True)
        update(phase="recognizing", progress=0, message="Đang nhận diện lời thoại bằng Whisper…")
        lines = transcribe(str(audio_path), language=None if language == "auto" else language,
                           on_progress=on_progress, on_segment=on_segment)
        # Older/custom transcriber paths may not report segments incrementally.
        if not _transcript_preview_jobs.get(task_id, {}).get("lines"):
            for line in lines:
                on_segment(line)
        update(status="complete", phase="complete", progress=100,
               message="Đã nhận diện xong lời thoại.", line_count=len(_transcript_preview_jobs.get(task_id, {}).get("lines", [])))
    finally:
        audio_path.unlink(missing_ok=True)


def _prune_transcript_preview_jobs():
    cutoff = time.time() - _TRANSCRIPT_PREVIEW_TTL_SECONDS
    with _transcript_preview_jobs_lock:
        expired = [key for key, value in _transcript_preview_jobs.items() if value.get("updated_at", 0) < cutoff]
        for key in expired:
            _transcript_preview_jobs.pop(key, None)


@app.post("/api/preview/transcript/{video_id}")
async def audio_transcript_preview(video_id: str, body: AudioTranscriptPreviewRequest, _: str = Depends(require_token)):
    """Start Whisper recognition; transcript segments and audio progress are polled live."""
    channel = validate_channel(body.channel)
    video_id = validate_video_id(video_id)
    if body.source_language not in {"auto", "zh", "en", "ja", "ko", "th", "id", "es", "pt", "fr", "de", "ru", "it", "hi", "ar", "tr", "ms", "vi"}:
        raise HTTPException(status_code=422, detail="Ngôn ngữ nguồn chưa được hỗ trợ.")
    source = local_source_for_process(channel, video_id)
    if not source or not Path(source).is_file():
        raise HTTPException(status_code=404, detail="Hãy tải video về máy trước khi quét lời thoại.")
    _prune_transcript_preview_jobs()
    task_id = secrets.token_urlsafe(24)
    with _transcript_preview_jobs_lock:
        _transcript_preview_jobs[task_id] = {
            "task_id": task_id, "video_id": video_id, "status": "processing", "phase": "queued",
            "progress": 0, "processed_seconds": 0, "total_seconds": 0,
            "lines": [], "line_count": 0, "message": "Đang chuẩn bị nhận diện…", "updated_at": time.time(),
        }
    audio_path = job_dir_for(channel, video_id) / f".transcript-preview-{secrets.token_hex(8)}.wav"
    def worker():
        try:
            _transcribe_audio_preview(Path(source), audio_path, body.source_language, task_id)
            with _transcript_preview_jobs_lock:
                task = _transcript_preview_jobs.get(task_id)
                if task and not task["lines"]:
                    task.update(status="error", phase="error", error="Whisper không tìm thấy lời thoại. Thử chọn ngôn ngữ nguồn cụ thể hoặc dùng OCR nếu video có phụ đề sẵn.")
        except Exception as error:
            with _transcript_preview_jobs_lock:
                task = _transcript_preview_jobs.get(task_id)
                if task:
                    task.update(status="error", phase="error", error=str(error) or "Không nhận diện được lời thoại.")
        finally:
            with _transcript_preview_jobs_lock:
                task = _transcript_preview_jobs.get(task_id)
                if task:
                    task["updated_at"] = time.time()

    threading.Thread(target=worker, name="reupai-transcript-preview", daemon=True).start()
    return {"task_id": task_id, "video_id": video_id, "status": "processing", "phase": "queued", "progress": 0, "lines": []}


@app.get("/api/preview/transcript/{video_id}/{task_id}")
async def audio_transcript_preview_status(video_id: str, task_id: str, _: str = Depends(require_token)):
    _prune_transcript_preview_jobs()
    with _transcript_preview_jobs_lock:
        task = _transcript_preview_jobs.get(task_id)
        if not task or task.get("video_id") != validate_video_id(video_id):
            raise HTTPException(status_code=404, detail="Phiên nhận diện đã hết hạn. Hãy quét lại lời thoại.")
        task["updated_at"] = time.time()
        return {key: value for key, value in task.items() if key != "updated_at"}


@app.post("/api/preview/subtitle-translation")
async def translate_manual_subtitle_lines(body: ManualSubtitleTranslationRequest, _: str = Depends(require_token)):
    """Translate one small editable OCR batch, keeping the local Gemini session private."""
    if body.source_language not in {"auto", "zh", "en", "ja", "ko", "th", "vi", "id", "es", "pt", "fr", "de", "ru", "it", "hi", "ar", "tr", "ms"}:
        raise HTTPException(status_code=422, detail="Ngôn ngữ nguồn chưa được hỗ trợ.")
    try:
        from services.translator import translate_batch
        batch = [{"id": line.id, "text": line.text.strip()} for line in body.lines]
        if any(not line["text"] for line in batch):
            raise HTTPException(status_code=422, detail="Có câu phụ đề đang để trống.")
        translations = await run_in_threadpool(
            translate_batch, batch, "", source_language=body.source_language, translation_model=body.translation_model, target_language=body.target_language,
        )
        translated_by_id = {int(item["id"]): str(item["text"]).strip() for item in translations}
        return {"translations": [{"id": line.id, "text": translated_by_id[line.id]} for line in body.lines]}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error) or "Không dịch được phụ đề.") from error


@app.get("/library/source/{video_id}")
def source_file(video_id: str, _: bool = Depends(require_token)):
    return library_source(video_id=video_id)


@app.get("/api/result/{video_id}")
def result_file(video_id: str, channel: str = "default", mode: str = "subtitle", output_format: str = "video", _: bool = Depends(require_token)):
    return api_result(video_id=video_id, channel=channel, mode=mode, output_format=output_format)


@app.get("/api/stream/{video_id}")
def result_stream(video_id: str, channel: str = "default", mode: str = "subtitle", _: bool = Depends(require_token)):
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
    from services.billing import BillingUnavailable, billing_enabled, claim, finish

    try:
        enabled = billing_enabled()
        if enabled:
            claim(body.billing_token or "", body.video_id, body.mode)
    except BillingUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    try:
        return api_process(body, local_request())
    except Exception:
        if enabled:
            finish(body.billing_token or "", "failed")
        raise


@app.get("/api/outputs/{video_id}/edit")
def output_edit(video_id: str, channel: str = "default", mode: str = "subtitle", _: bool = Depends(require_token)):
    return api_output_edit(video_id=video_id, channel=channel, mode=mode)


@app.post("/api/outputs/{video_id}/rerender")
def output_rerender(video_id: str, body: RenderEditRequest, _: bool = Depends(require_token)):
    return api_output_rerender(video_id=video_id, body=body, request=local_request())


@app.get("/api/jobs")
def jobs(_: bool = Depends(require_token)):
    return {"jobs": list_active_jobs(limit=50)}


@app.get("/api/jobs/{video_id}")
def job_status(video_id: str, channel: str = "default", mode: str = "subtitle", _: bool = Depends(require_token)):
    return api_process_status(video_id=video_id, channel=channel, mode=mode)


@app.post("/api/jobs/{video_id}/stop")
def stop_job(video_id: str, channel: str = "default", mode: str = "subtitle", _: bool = Depends(require_token)):
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
            channel=query.get("channel", ["default"])[0],
        )
    elif path.startswith("/library/source/"):
        response = library_source(video_id=path.rsplit("/", 1)[-1])
    elif path.startswith(("/api/stream/", "/api/result/")):
        handler = api_stream if path.startswith("/api/stream/") else api_result
        options = {"output_format": query.get("output_format", ["video"])[0]} if handler is api_result else {}
        response = handler(video_id=path.rsplit("/", 1)[-1], channel=query.get("channel", ["default"])[0], mode=query.get("mode", ["subtitle"])[0], **options)
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


