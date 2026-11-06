"""Local Google OAuth credentials for Gemini.

The Local Engine is a desktop application. Google API tokens belong to the
signed-in Windows user and are protected with Windows DPAPI. The login flow
returns a short-lived identity token once; it never returns Gemini API tokens.
"""

from __future__ import annotations

import base64
import ctypes
from datetime import datetime, timedelta, timezone
import json
import os
import re
import secrets
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server
from wsgiref.util import request_uri

import requests
from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError, TransportError
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

from runtime_paths import get_config_dir, is_production


# ``cloud-platform`` is required only for the one-click "Bật Gemini API"
# action. The Gemini scope continues to authorize calls to the Developer API.
# Keep both scopes in the consent request so a newly installed Engine has a
# complete setup flow and never asks a customer to paste an API key.
SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/generative-language.retriever",
]
OAUTH_SCOPE_VERSION = 3
TOKEN_PATH = get_config_dir() / "gemini-oauth.dat"
PROJECT_PATH = get_config_dir() / "gemini-project.json"
PROJECT_ID_PATTERN = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]\Z")
_lock = threading.RLock()
_scope_exchange_lock = threading.Lock()
_REFRESH_SKEW = timedelta(minutes=5)
OAUTH_WAIT_SECONDS = 300


def _google_authorization_url(value: str) -> str:
    """Expose only Google's live consent URL, never arbitrary external links."""
    url = urlsplit(value)
    callback = urlsplit(parse_qs(url.query).get("redirect_uri", [""])[0])
    if (url.scheme != "https" or url.hostname != "accounts.google.com" or url.username or url.password
            or url.port not in {None, 443} or url.path not in {"/o/oauth2/auth", "/o/oauth2/v2/auth"}
            or callback.scheme != "http" or callback.hostname not in {"localhost", "127.0.0.1"}
            or not callback.port):
        raise RuntimeError("Đường đăng nhập Google không hợp lệ. Hãy cập nhật Local Engine rồi thử lại.")
    return value


def _google_return_url(value: str | None) -> str | None:
    if value is None:
        return None
    url = urlsplit(value)
    allowed = {"https://www.reupai.cloud", "https://reupai.cloud"}
    allowed.update(f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (3000, 3001, 3010, 3022))
    configured = os.getenv("REUP_ENGINE_ALLOWED_ORIGINS", "")
    if configured:
        allowed.update(origin.strip().rstrip("/") for origin in configured.split(","))
    if (f"{url.scheme}://{url.netloc}" not in allowed or url.username or url.password
            or url.path != "/settings" or url.query or url.fragment not in {"", "diagnostics"}):
        raise ValueError("Trang quay lại sau Google không hợp lệ.")
    return value


def _run_browser_flow(flow, options: dict[str, str], return_to: str, attempt: int):
    """Use the browser already showing ReupAI, then return to Settings locally.

    Only the authorization code reaches this loopback listener. Its state and
    PKCE exchange are verified before credentials are saved by the caller.
    """
    callback = {"uri": None, "state": None}

    def response(environ, start_response):
        query = parse_qs(environ.get("QUERY_STRING", ""))
        supplied = query.get("state", [""])[0]
        expected = callback["state"] or ""
        valid = (environ.get("PATH_INFO") == "/" and (query.get("code") or query.get("error"))
                 and supplied and expected and secrets.compare_digest(supplied, expected))
        if not valid:
            start_response("400 Bad Request", [("Content-Type", "text/plain"), ("Cache-Control", "no-store")])
            return [b"Invalid OAuth callback"]
        callback["uri"] = request_uri(environ)
        start_response("303 See Other", [("Location", return_to), ("Cache-Control", "no-store"),
                                          ("Referrer-Policy", "no-referrer"), ("Content-Length", "0")])
        return [b""]

    class QuietHandler(WSGIRequestHandler):
        def log_message(self, *_args):
            pass  # Never log authorization codes or consent URLs.

    class LoopbackServer(WSGIServer):
        allow_reuse_address = False

        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(5)
            return connection, address

    with make_server("127.0.0.1", 0, response, server_class=LoopbackServer, handler_class=QuietHandler) as server:
        flow.redirect_uri = f"http://127.0.0.1:{server.server_port}/"
        _url, callback["state"] = flow.authorization_url(prompt="consent", **options)
        deadline = time.monotonic() + OAUTH_WAIT_SECONDS
        server.timeout = 1
        while callback["uri"] is None:
            with _lock:
                if int(_state["attempt"]) != attempt:
                    raise InterruptedError("Đã dừng chờ Google.")
            if time.monotonic() >= deadline:
                raise TimeoutError("Đã quá 5 phút chờ Google. Hãy kết nối lại.")
            server.handle_request()
        flow.fetch_token(authorization_response=callback["uri"].replace("http://", "https://", 1))
        return flow.credentials


class _GoogleInstalledAppFlow(InstalledAppFlow):
    """Accept Google's equivalent identity scopes, then validate API grants.

    oauthlib otherwise raises ``Warning: Scope has changed`` when Google adds
    ``userinfo.email``/``userinfo.profile`` to an OpenID token response. Keep
    its relaxation limited to the token exchange rather than the whole browser
    consent flow. The caller checks the actual granted API scopes afterwards.
    """

    def authorization_url(self, **kwargs: Any):
        result = super().authorization_url(**kwargs)
        callback = getattr(self, "_reupai_authorization_ready", None)
        if callback:
            callback(result[0])
        return result

    def fetch_token(self, **kwargs: Any):
        callback = getattr(self, "_reupai_exchanging", None)
        if callback:
            callback()
        kwargs.setdefault("timeout", 20)
        with _scope_exchange_lock:
            previous = os.environ.get("OAUTHLIB_RELAX_TOKEN_SCOPE")
            os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
            try:
                return super().fetch_token(**kwargs)
            finally:
                if previous is None:
                    os.environ.pop("OAUTHLIB_RELAX_TOKEN_SCOPE", None)
                else:
                    os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = previous


def _require_gemini_scopes(credentials: Credentials) -> None:
    # A token response may omit ``scope`` when it is unchanged (RFC 6749).
    # If Google does return granted scopes, never persist a partial consent.
    granted = credentials.granted_scopes
    if granted is None:
        return
    if isinstance(granted, str):
        granted = granted.split()
    required = {
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/generative-language.retriever",
    }
    if required - set(granted):
        raise RuntimeError("Google chưa cấp đủ quyền Gemini và Google Cloud. Hãy kết nối lại và chấp thuận cả hai quyền.")


class _TokenRefreshRequest(Request):
    def __call__(self, *args: Any, **kwargs: Any):
        kwargs.setdefault("timeout", 15)
        return super().__call__(*args, **kwargs)


_state: dict[str, object] = {
    "status": "disconnected",
    "error": "",
    # Every authorization attempt gets an id. Disconnecting invalidates the
    # current id, so a stale browser callback can never sign the user back in.
    "attempt": 0,
    "started_at": 0.0,
    "api_setup": None,
    "login_request": None,
    "login_id_token": None,
    "login_completed_at": 0.0,
    "authorization_url": None,
    "phase": None,
    "browser_opened": False,
    "project_discovery": None,
}


def _expire_authorization_locked() -> None:
    if (_state["status"] == "connecting" and _state.get("phase") == "awaiting_google"
            and time.time() - float(_state["started_at"] or 0) > OAUTH_WAIT_SECONDS + 5):
        _state.update(status="error", attempt=int(_state["attempt"]) + 1, started_at=0.0,
                      error="Đã quá 5 phút chờ Google. Bấm Kết nối Google để tạo liên kết mới.",
                      authorization_url=None, phase=None, browser_opened=False)


def _status_from_state(
    *,
    credentials: Credentials | None = None,
    needs_reauthorization: bool = False,
    temporary_error: bool = False,
) -> dict[str, object]:
    """Build a status response without re-entering the state lock."""
    with _lock:
        _expire_authorization_locked()
        running = _state["status"] == "connecting"
        error = str(_state["error"] or "")
        started_at = float(_state["started_at"] or 0.0)
        api_setup = _state["api_setup"]
        authorization_url = _state.get("authorization_url") if running and _state.get("phase") == "awaiting_google" else None
        phase = _state.get("phase") if running else None
        browser_opened = bool(_state.get("browser_opened"))
        project_discovery = _state.get("project_discovery")
    token_data = _load_token_data() or {}
    return {
        "configured": _client_config() is not None,
        "connected": credentials is not None,
        "needs_reauthorization": needs_reauthorization,
        "temporary_error": temporary_error,
        "connecting": running,
        "error": error if error else None,
        "started_at": int(started_at) if running and started_at else None,
        "authorization_url": authorization_url,
        "phase": phase,
        "browser_opened": browser_opened if running else False,
        "expires_at": int(started_at + OAUTH_WAIT_SECONDS) if authorization_url and started_at else None,
        "project_discovery": project_discovery,
        "api_setup": api_setup,
        "project_id": get_project_id(),
        "google_email": str(token_data.get("_reupai_google_email") or "") or None,
        "google_subject": str(token_data.get("_reupai_google_subject") or "") or None,
        "storage": "windows_dpapi" if os.name == "nt" else "local_user_file",
    }


def _client_config() -> dict[str, Any] | None:
    """Load the release-only desktop client before checking development env vars.

    The JSON is intentionally ignored by Git.  It is included in the Windows
    installer via ``app/assets`` so customers only approve Google access; they
    never receive a setup step or an API key field.
    """
    source_root = Path(__file__).resolve().parents[1]
    bundle_root = Path(getattr(sys, "_MEIPASS", source_root.parent))
    for path in (bundle_root / "app" / "assets" / "google_oauth_client.json", source_root / "assets" / "google_oauth_client.json"):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            installed = value.get("installed") if isinstance(value, dict) else None
            if isinstance(installed, dict) and installed.get("client_id"):
                return {"installed": installed}
        except (OSError, ValueError, TypeError):
            continue
    client_id = os.getenv("REUP_GOOGLE_OAUTH_CLIENT_ID", "").strip()
    if not client_id:
        return None
    return {
        "installed": {
            "client_id": client_id,
            # Desktop OAuth clients are public clients. Google still emits a
            # secret in its downloaded JSON, so allow the owner to supply it.
            "client_secret": os.getenv("REUP_GOOGLE_OAUTH_CLIENT_SECRET", "").strip(),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }


def get_project_id() -> str | None:
    """Return this customer's quota project, never the app owner's in release."""
    managed = os.getenv("REUP_GEMINI_PROJECT_ID", "").strip()
    if PROJECT_ID_PATTERN.fullmatch(managed):
        return managed
    try:
        saved = json.loads(PROJECT_PATH.read_text(encoding="utf-8"))
        selected = str(saved.get("project_id") or "") if isinstance(saved, dict) else ""
        if PROJECT_ID_PATTERN.fullmatch(selected):
            token = _load_token_data() or {}
            owner = str(saved.get("google_subject") or saved.get("google_email") or "").lower()
            actual = str(token.get("_reupai_google_subject") if saved.get("google_subject") else token.get("_reupai_google_email") or "").lower()
            if owner and owner != actual:
                return None
            return selected
    except (OSError, ValueError, TypeError):
        pass
    if is_production() or os.getenv("REUP_DATA_DIR", "").strip():
        return None
    # A developer checkout can still use its own OAuth client project.
    client_config = _client_config() or {}
    installed = client_config.get("installed")
    if isinstance(installed, dict):
        project_id = str(installed.get("project_id") or "").strip()
        if project_id:
            return project_id
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    return project_id or None


def set_project_id(project_id: str) -> str:
    value = project_id.strip()
    if not PROJECT_ID_PATTERN.fullmatch(value):
        raise ValueError("Project ID phải dài 6–30 ký tự, bắt đầu bằng chữ thường và chỉ gồm chữ thường, số hoặc dấu gạch ngang.")
    with _lock:
        token = _load_token_data() or {}
        data = {"project_id": value, "google_subject": token.get("_reupai_google_subject"), "google_email": token.get("_reupai_google_email")}
        PROJECT_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = PROJECT_PATH.with_suffix(".tmp")
        temporary.write_text(json.dumps(data), encoding="utf-8")
        temporary.replace(PROJECT_PATH)
        _state["api_setup"] = None
    return value


def _bind_legacy_project_owner() -> None:
    """Keep an old manual selection with its Google account across reconnects."""
    with _lock:
        try:
            saved = json.loads(PROJECT_PATH.read_text(encoding="utf-8"))
            token = _load_token_data() or {}
            if (isinstance(saved, dict) and not (saved.get("google_subject") or saved.get("google_email"))
                    and (token.get("_reupai_google_subject") or token.get("_reupai_google_email"))
                    and PROJECT_ID_PATTERN.fullmatch(str(saved.get("project_id") or ""))):
                set_project_id(saved["project_id"])
        except (OSError, ValueError, TypeError):
            pass


def _dpapi_encrypt(value: bytes) -> bytes:
    if os.name != "nt":
        return value
    class Blob(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_byte))]
    source = (ctypes.c_byte * len(value)).from_buffer_copy(value)
    source_blob = Blob(len(value), source)
    target_blob = Blob()
    if not ctypes.windll.crypt32.CryptProtectData(ctypes.byref(source_blob), "ReupAI Gemini OAuth", None, None, None, 0, ctypes.byref(target_blob)):
        raise OSError("Không thể mã hóa thông tin đăng nhập Google trên Windows.")
    try:
        return ctypes.string_at(target_blob.pbData, target_blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(target_blob.pbData)


def _dpapi_decrypt(value: bytes) -> bytes:
    if os.name != "nt":
        return value
    class Blob(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_byte))]
    source = (ctypes.c_byte * len(value)).from_buffer_copy(value)
    source_blob = Blob(len(value), source)
    target_blob = Blob()
    if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(source_blob), None, None, None, None, 0, ctypes.byref(target_blob)):
        raise OSError("Không thể đọc thông tin đăng nhập Google trên Windows.")
    try:
        return ctypes.string_at(target_blob.pbData, target_blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(target_blob.pbData)


def _load_token_data() -> dict[str, Any] | None:
    try:
        payload = TOKEN_PATH.read_bytes()
        if payload.startswith(b"DPAPI:"):
            payload = _dpapi_decrypt(base64.b64decode(payload[6:]))
        data = json.loads(payload.decode("utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError, TypeError, UnicodeError):
        return None


def _credentials_from_data(data: dict[str, Any]) -> Credentials | None:
    try:
        scopes = data.get("scopes") if data.get("_reupai_scope_version") == 2 else SCOPES
        return Credentials.from_authorized_user_info(data, scopes or SCOPES)
    except (ValueError, TypeError):
        return None


def _requires_scope_upgrade(data: dict[str, Any] | None) -> bool:
    """Version 2 still runs Gemini; the added identity scopes apply on new login."""
    return bool(data) and data.get("_reupai_scope_version") not in {2, OAUTH_SCOPE_VERSION}


def _identity_from_id_token(identity_token: object) -> dict[str, str]:
    """Read display-only identity hints from Google's signed ID token."""
    if not isinstance(identity_token, str):
        return {}
    try:
        payload = identity_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload).decode("utf-8"))
    except (IndexError, ValueError, TypeError, UnicodeError):
        return {}
    if not isinstance(claims, dict):
        return {}
    return {
        "_reupai_google_email": str(claims.get("email") or "")[:254],
        "_reupai_google_subject": str(claims.get("sub") or "")[:128],
    }


def _save_credentials(
    credentials: Credentials,
    scope_version: int = OAUTH_SCOPE_VERSION,
    metadata: dict[str, Any] | None = None,
) -> None:
    data = json.loads(credentials.to_json())
    data["_reupai_scope_version"] = scope_version
    for key in ("_reupai_google_email", "_reupai_google_subject"):
        if metadata and metadata.get(key):
            data[key] = str(metadata[key])
    payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        payload = b"DPAPI:" + base64.b64encode(_dpapi_encrypt(payload))
    temporary = TOKEN_PATH.with_suffix(".tmp")
    temporary.write_bytes(payload)
    temporary.replace(TOKEN_PATH)


def _credential_snapshot(*, force_refresh: bool = False) -> tuple[Credentials | None, bool, bool]:
    # Loading, refreshing and replacing the credential file must be one
    # operation: diagnostics and a pipeline worker can check at the same time.
    with _lock:
        return _credential_snapshot_locked(force_refresh=force_refresh)


def _credential_snapshot_locked(*, force_refresh: bool = False) -> tuple[Credentials | None, bool, bool]:
    data = _load_token_data()
    if _requires_scope_upgrade(data):
        return None, True, False
    credentials = _credentials_from_data(data) if data else None
    if not credentials:
        return None, bool(data), False
    try:
        expiry = credentials.expiry
        if expiry and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        refresh_soon = bool(expiry and expiry <= datetime.now(timezone.utc) + _REFRESH_SKEW)
        if force_refresh or credentials.expired or refresh_soon:
            if not credentials.refresh_token:
                return None, True, False
            credentials.refresh(_TokenRefreshRequest())
            _save_credentials(
                credentials,
                scope_version=int(data.get("_reupai_scope_version", OAUTH_SCOPE_VERSION)),
                metadata=data,
            )
        return (credentials, False, False) if credentials.valid else (None, True, False)
    except RefreshError as error:
        # Revoked or invalid grants need consent again. A transient Google
        # token-server error should not erase a usable refresh token.
        value = str(error).lower()
        revoked = any(term in value for term in ("invalid_grant", "invalid_client", "unauthorized_client"))
        return None, revoked, not revoked
    except (TransportError, requests.RequestException, OSError):
        return None, False, True


def get_credentials() -> Credentials | None:
    return _credential_snapshot()[0]


def refresh_credentials() -> Credentials | None:
    """Force one refresh attempt, preserving encrypted local identity data."""
    return _credential_snapshot(force_refresh=True)[0]


def status() -> dict[str, object]:
    credentials, needs_reauthorization, temporary_error = _credential_snapshot()
    return _status_from_state(
        credentials=credentials,
        needs_reauthorization=needs_reauthorization,
        temporary_error=temporary_error,
    )


def start_authorization(nonce_hash: str | None = None, *, open_browser: bool = True, return_to: str | None = None) -> dict[str, object]:
    return_to = _google_return_url(return_to)
    if _client_config() is None:
        raise RuntimeError("Google OAuth chưa được cấu hình trong Local Engine. Hãy cập nhật bản Engine do ReupAI phát hành.")
    if nonce_hash is not None and not re.fullmatch(r"[0-9a-f]{64}", nonce_hash):
        raise ValueError("Mã xác thực đăng nhập Google không hợp lệ.")
    with _lock:
        _expire_authorization_locked()
        if _state["status"] == "connecting":
            raise RuntimeError("Một cửa sổ Google đang chờ xác nhận. Hãy hoàn tất hoặc dừng lượt đó trước.")
        _bind_legacy_project_owner()
        attempt = int(_state["attempt"]) + 1
        login_request = secrets.token_urlsafe(24) if nonce_hash else None
        _state.update(status="connecting", error="", attempt=attempt, started_at=time.time(),
                      api_setup=None, login_request=login_request, login_id_token=None,
                      login_completed_at=0.0, authorization_url=None, phase="preparing", browser_opened=False, project_discovery=None)

    def publish_authorization(value: str) -> None:
        url = _google_authorization_url(value)
        with _lock:
            if int(_state["attempt"]) != attempt:
                return
            _state.update(authorization_url=url, phase="awaiting_google")
        if not open_browser:
            return
        # Keep the loopback callback server alive even if Windows cannot launch
        # its default browser. The authenticated UI offers the same consent URL.
        try:
            opened = bool(webbrowser.open(url, new=1, autoraise=True))
        except Exception:
            opened = False
        with _lock:
            if int(_state["attempt"]) == attempt:
                _state["browser_opened"] = opened

    def exchanging() -> None:
        with _lock:
            if int(_state["attempt"]) == attempt:
                _state.update(phase="exchanging", authorization_url=None)

    def run() -> None:
        try:
            flow = _GoogleInstalledAppFlow.from_client_config(_client_config(), SCOPES, autogenerate_code_verifier=True)
            flow._reupai_authorization_ready = publish_authorization
            flow._reupai_exchanging = exchanging
            flow_options = {"nonce": nonce_hash} if nonce_hash else {}
            if return_to:
                credentials = _run_browser_flow(flow, flow_options, return_to, attempt)
            else:
                credentials = flow.run_local_server(
                    host="localhost", port=0, open_browser=False, timeout_seconds=OAUTH_WAIT_SECONDS,
                    prompt="consent", authorization_prompt_message="ReupAI đang mở trang đăng nhập Google…",
                    success_message="Google đã nhận xác nhận. Bạn có thể quay lại ReupAI để hoàn tất kết nối Gemini.",
                    **flow_options,
                )
            _require_gemini_scopes(credentials)
            identity_token = getattr(credentials, "id_token", None)
            if login_request and not identity_token:
                raise RuntimeError("Google không trả về danh tính đăng nhập. Hãy thử lại.")
            with _lock:
                if int(_state["attempt"]) != attempt:
                    return
                _save_credentials(credentials, metadata=_identity_from_id_token(identity_token))
                _state.update(phase="checking_api", authorization_url=None)
                _bind_legacy_project_owner()
            if not get_project_id():
                from services.google_projects import detect_projects
                with _lock:
                    _state["phase"] = "discovering_project"
                discovered = detect_projects(expected_attempt=attempt)
                with _lock:
                    if int(_state["attempt"]) != attempt:
                        return
                    _state.update(project_discovery=discovered, phase="checking_api")
            # Consent succeeded: enable the Gemini API immediately. The setup
            # stays local and runs without a second UI action.
            api_setup = enable_gemini_api()
            with _lock:
                if int(_state["attempt"]) == attempt:
                    _state.update(status="connected", error="", started_at=0.0, api_setup=api_setup,
                                  login_id_token=identity_token if login_request else None,
                                  login_completed_at=time.time() if login_request else 0.0,
                                  authorization_url=None, phase=None, browser_opened=False)
        except Exception as error:
            with _lock:
                if int(_state["attempt"]) == attempt:
                    message = ("Đã quá 5 phút chờ Google. Bấm Kết nối Google để tạo liên kết mới."
                               if time.time() - float(_state["started_at"] or 0) >= OAUTH_WAIT_SECONDS
                               else str(error)[:240])
                    _state.update(status="error", error=message, started_at=0.0,
                                  authorization_url=None, phase=None, browser_opened=False)

    threading.Thread(target=run, name="reupai-gemini-oauth", daemon=True).start()
    result = status()
    if login_request:
        result["login_request"] = login_request
    return result


def take_login_identity(login_request: str) -> dict[str, object]:
    """Return a fresh ID token once to the authorized local browser origin."""
    with _lock:
        if not login_request or login_request != _state["login_request"]:
            return {"state": "invalid", "message": "Lượt đăng nhập không còn hợp lệ. Hãy thử lại."}
        if _state["status"] == "error":
            return {"state": "error", "message": str(_state["error"] or "Google chưa hoàn tất đăng nhập.")}
        if _state["status"] == "connecting":
            return {"state": "connecting"}
        if time.time() - float(_state["login_completed_at"] or 0.0) > 300:
            _state.update(login_request=None, login_id_token=None)
            return {"state": "expired", "message": "Lượt đăng nhập đã hết hạn. Hãy thử lại."}
        identity_token = _state["login_id_token"]
        _state.update(login_request=None, login_id_token=None)
    if not identity_token:
        return {"state": "invalid", "message": "Danh tính đăng nhập đã được sử dụng. Hãy thử lại."}
    return {"state": "ready", "id_token": identity_token}


def _oauth_headers(credentials: Credentials, project_id: str | None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {credentials.token}"}
    if project_id:
        headers["x-goog-user-project"] = project_id
    return headers


def authorized_request(
    method: str,
    url: str,
    *,
    project_id: str | None = None,
    retry_unauthorized: bool = True,
    **kwargs: Any,
) -> requests.Response:
    """Call Google and recover once from an unexpectedly stale access token."""
    credentials = get_credentials()
    if not credentials or not credentials.token:
        raise RuntimeError("Google OAuth authorization is not available")
    base_headers = dict(kwargs.pop("headers", {}) or {})
    headers = {**base_headers, **_oauth_headers(credentials, project_id)}
    response = requests.request(method, url, headers=headers, **kwargs)
    if response.status_code != 401 or not retry_unauthorized:
        return response
    credentials = refresh_credentials()
    if not credentials or not credentials.token:
        return response
    retry_headers = {**base_headers, **_oauth_headers(credentials, project_id)}
    return requests.request(method, url, headers=retry_headers, **kwargs)


def _response_message(response: requests.Response) -> str:
    """Return a compact, safe message for the local setup screen."""
    try:
        data = response.json()
        value = data.get("error", {}).get("message", "") if isinstance(data, dict) else ""
    except ValueError:
        value = ""
    return str(value or "").replace("\n", " ")[:240]


def _gemini_check(credentials: Credentials, project_id: str | None) -> requests.Response:
    del credentials
    return authorized_request(
        "GET",
        "https://generativelanguage.googleapis.com/v1beta/models",
        project_id=project_id,
        timeout=15,
    )


def _is_api_disabled(response: requests.Response) -> bool:
    message = _response_message(response).lower()
    return response.status_code in {403, 404} and any(
        phrase in message
        for phrase in (
            "has not been used in project",
            "service_disabled",
            "service disabled",
            "gemini api is disabled",
            "gemini api has not been used",
        )
    )


def verify_gemini_access() -> dict[str, object]:
    """Check the actual Gemini endpoint without exposing a credential.

    Check the selected customer's project with the actual Gemini endpoint.
    """
    current = status()
    if current["needs_reauthorization"]:
        return {
            "state": "reauthorization_required",
            "ready": False,
            "message": "Cần kết nối lại Google để cấp quyền Gemini mới.",
            "action": "reauthorize", "action_label": "Kết nối lại Google", "retryable": False,
            "project_id": get_project_id(),
        }
    if current["temporary_error"]:
        return {
            "state": "temporary_error",
            "ready": False,
            "message": "Tạm thời chưa làm mới được quyền Google. Kiểm tra mạng rồi thử lại; không cần đăng nhập lại.",
            "action": "retry", "action_label": "Thử lại", "retryable": True,
            "project_id": get_project_id(),
        }
    credentials = get_credentials()
    project_id = get_project_id()
    if not credentials or not credentials.token:
        return {
            "state": "not_connected",
            "ready": False,
            "message": "Chưa kết nối Google cho Gemini.",
            "action": "reauthorize", "action_label": "Kết nối Google", "retryable": False,
            "project_id": project_id,
        }
    if not project_id:
        return {
            "state": "project_required",
            "ready": False,
            "message": "Chọn Google Cloud project của bạn trong Cài đặt Local Engine để dùng quota Gemini của chính bạn.",
            "action": "select_project", "action_label": "Chọn project", "retryable": False,
            "project_id": None,
        }
    try:
        response = _gemini_check(credentials, project_id)
    except requests.RequestException:
        return {
            "state": "temporary_error",
            "ready": False,
            "message": "Chưa thể kiểm tra Gemini. Hãy kiểm tra Internet rồi thử lại.",
            "action": "retry", "action_label": "Thử lại", "retryable": True,
            "project_id": project_id,
        }
    if response.ok:
        return {
            "state": "ready",
            "ready": True,
            "message": "Gemini đã sẵn sàng.",
            "action": None, "action_label": None, "retryable": False,
            "project_id": project_id,
        }
    if _is_api_disabled(response):
        return {
            "state": "disabled",
            "ready": False,
            "message": f"Gemini API chưa được bật cho project {project_id}.",
            "action": "enable_api", "action_label": "Bật Gemini API", "retryable": True,
            "project_id": project_id,
        }
    if response.status_code == 401:
        refreshed = status()
        if refreshed.get("temporary_error"):
            return {
                "state": "temporary_error",
                "ready": False,
                "message": "Google tạm thời chưa làm mới được phiên. Kiểm tra mạng rồi thử lại; chưa cần đăng nhập lại.",
                "action": "retry", "action_label": "Thử lại", "retryable": True,
                "project_id": project_id,
            }
        return {
            "state": "reauthorization_required",
            "ready": False,
            "message": "Quyền Google đã hết hạn. Hãy kết nối lại Google.",
            "action": "reauthorize", "action_label": "Kết nối lại Google", "retryable": False,
            "project_id": project_id,
        }
    if response.status_code == 403:
        message = _response_message(response).lower()
        quota_permission = "serviceusage.services.use" in message or "service usage consumer" in message
        return {
            "state": "quota_permission_required" if quota_permission else "permission_denied",
            "ready": False,
            "message": (
                "Tài khoản Google cần quyền Service Usage Consumer trên project đã chọn để dùng quota Gemini."
                if quota_permission else
                "Google từ chối quyền Gemini cho tài khoản hoặc project này. Hãy kiểm tra quyền truy cập và billing của project."
            ),
            "action": "open_project_permissions", "action_label": "Kiểm tra quyền project", "retryable": False,
            "project_id": project_id,
        }
    return {
        "state": "error",
        "ready": False,
        "message": "Không thể xác nhận quyền Gemini lúc này. Hãy thử lại.",
        "action": "retry", "action_label": "Thử lại", "retryable": True,
        "project_id": project_id,
    }


def enable_gemini_api(current: dict[str, object] | None = None) -> dict[str, object]:
    """Request Google Cloud to enable Gemini API for the selected project."""
    current = current or verify_gemini_access()
    if current["ready"] or current["state"] != "disabled":
        return current

    credentials = get_credentials()
    project_id = get_project_id()
    if not credentials or not credentials.token or not project_id:
        return {
            "state": "reauthorization_required",
            "ready": False,
            "message": "Hãy kết nối lại Google để bật Gemini API.",
            "project_id": project_id,
        }
    service = f"projects/{project_id}/services/generativelanguage.googleapis.com"
    try:
        response = authorized_request(
            "POST",
            f"https://serviceusage.googleapis.com/v1/{service}:enable",
            project_id=project_id,
            timeout=20,
        )
    except requests.RequestException:
        return {
            "state": "temporary_error",
            "ready": False,
            "message": "Chưa gửi được yêu cầu bật Gemini API. Hãy thử lại.",
            "project_id": project_id,
        }
    if response.ok or response.status_code == 409:
        return {
            "state": "enabling",
            "ready": False,
            "message": "Đang bật Gemini API. Google có thể cần vài phút để hoàn tất.",
            "action": "retry", "action_label": "Kiểm tra lại", "retryable": True,
            "project_id": project_id,
        }
    if response.status_code == 401:
        refreshed = status()
        temporary = bool(refreshed.get("temporary_error"))
        return {
            "state": "temporary_error" if temporary else "reauthorization_required",
            "ready": False,
            "message": (
                "Google tạm thời chưa làm mới được phiên. Kiểm tra mạng rồi thử lại."
                if temporary else "Quyền Google đã hết hạn. Hãy kết nối lại Google."
            ),
            "action": "retry" if temporary else "reauthorize",
            "action_label": "Thử lại" if temporary else "Kết nối lại Google",
            "retryable": temporary,
            "project_id": project_id,
        }
    if response.status_code == 403:
        return {
            "state": "administrator_required",
            "ready": False,
            "message": f"Tài khoản Google chưa có quyền bật Gemini API cho project {project_id}. Nhờ quản trị viên project bật API hoặc cấp quyền Service Usage Admin.",
            "action": "open_api_console", "action_label": "Mở Google Cloud", "retryable": False,
            "project_id": project_id,
        }
    return {
        "state": "error",
        "ready": False,
        "message": "Không thể bật Gemini API lúc này. Hãy thử lại.",
        "project_id": project_id,
    }


def repair_gemini_access() -> dict[str, object]:
    """Apply every safe automatic repair and return the next human action."""
    current = verify_gemini_access()
    if current.get("state") != "disabled":
        return current
    enabled = enable_gemini_api(current=current)
    if enabled.get("state") == "enabling":
        enabled.update(action="retry", action_label="Kiểm tra lại", retryable=True)
    return enabled


def disconnect() -> None:
    try:
        TOKEN_PATH.unlink(missing_ok=True)
    finally:
        with _lock:
            _state.update(
                status="disconnected",
                error="",
                attempt=int(_state["attempt"]) + 1,
                started_at=0.0,
                api_setup=None,
                login_request=None,
                login_id_token=None,
                login_completed_at=0.0,
                authorization_url=None,
                phase=None,
                browser_opened=False,
                project_discovery=None,
            )
