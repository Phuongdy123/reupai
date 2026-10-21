"""Local Google OAuth credentials for Gemini.

The Local Engine is a desktop application.  OAuth tokens belong only to the
signed-in Windows user and are protected with Windows DPAPI before they are
written below LocalAppData.  No token is ever returned from the HTTP API.
"""

from __future__ import annotations

import base64
import ctypes
import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

from runtime_paths import get_config_dir


# ``cloud-platform`` is required only for the one-click "Bật Gemini API"
# action. The Gemini scope continues to authorize calls to the Developer API.
# Keep both scopes in the consent request so a newly installed Engine has a
# complete setup flow and never asks a customer to paste an API key.
SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/generative-language.retriever",
]
OAUTH_SCOPE_VERSION = 2
TOKEN_PATH = get_config_dir() / "gemini-oauth.dat"
_lock = threading.RLock()
_state: dict[str, object] = {
    "status": "disconnected",
    "error": "",
    # Every authorization attempt gets an id. Disconnecting invalidates the
    # current id, so a stale browser callback can never sign the user back in.
    "attempt": 0,
    "started_at": 0.0,
}


def _status_from_state(
    *,
    credentials: Credentials | None = None,
    needs_reauthorization: bool = False,
) -> dict[str, object]:
    """Build a status response without re-entering the state lock."""
    with _lock:
        running = _state["status"] == "connecting"
        error = str(_state["error"] or "")
        started_at = float(_state["started_at"] or 0.0)
    return {
        "configured": _client_config() is not None,
        "connected": credentials is not None,
        "needs_reauthorization": needs_reauthorization,
        "connecting": running,
        "error": error if error else None,
        "started_at": int(started_at) if running and started_at else None,
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
    """Return the Google Cloud project that owns this desktop OAuth client.

    OAuth calls to the Gemini Developer API must identify the project used for
    quota. Desktop client JSON includes this value, and the environment fallback
    keeps development and managed installations configurable without exposing a
    token or an API key.
    """
    client_config = _client_config() or {}
    installed = client_config.get("installed")
    if isinstance(installed, dict):
        project_id = str(installed.get("project_id") or "").strip()
        if project_id:
            return project_id
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    return project_id or None


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
        return Credentials.from_authorized_user_info(data, SCOPES)
    except (ValueError, TypeError):
        return None


def _requires_scope_upgrade(data: dict[str, Any] | None) -> bool:
    """Old tokens cannot enable the API and must receive the new consent."""
    return bool(data) and data.get("_reupai_scope_version") != OAUTH_SCOPE_VERSION


def _save_credentials(credentials: Credentials) -> None:
    data = json.loads(credentials.to_json())
    data["_reupai_scope_version"] = OAUTH_SCOPE_VERSION
    payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        payload = b"DPAPI:" + base64.b64encode(_dpapi_encrypt(payload))
    temporary = TOKEN_PATH.with_suffix(".tmp")
    temporary.write_bytes(payload)
    temporary.replace(TOKEN_PATH)


def get_credentials() -> Credentials | None:
    data = _load_token_data()
    if _requires_scope_upgrade(data):
        return None
    credentials = _credentials_from_data(data) if data else None
    if not credentials:
        return None
    try:
        if credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
            _save_credentials(credentials)
        return credentials if credentials.valid else None
    except Exception:
        return None


def status() -> dict[str, object]:
    data = _load_token_data()
    needs_reauthorization = _requires_scope_upgrade(data)
    credentials = None if needs_reauthorization else get_credentials()
    return _status_from_state(
        credentials=credentials,
        needs_reauthorization=needs_reauthorization,
    )


def start_authorization() -> dict[str, object]:
    if _client_config() is None:
        raise RuntimeError("Google OAuth chưa được cấu hình trong Local Engine. Hãy cập nhật bản Engine do ReupAI phát hành.")
    with _lock:
        if _state["status"] == "connecting":
            return _status_from_state(credentials=get_credentials())
        attempt = int(_state["attempt"]) + 1
        _state.update(status="connecting", error="", attempt=attempt, started_at=time.time())

    def run() -> None:
        try:
            flow = InstalledAppFlow.from_client_config(_client_config(), SCOPES)
            credentials = flow.run_local_server(host="localhost", port=0, open_browser=True, authorization_prompt_message="ReupAI đang mở trang đăng nhập Google…")
            with _lock:
                if int(_state["attempt"]) != attempt:
                    return
            _save_credentials(credentials)
            with _lock:
                if int(_state["attempt"]) == attempt:
                    _state.update(status="connected", error="", started_at=0.0)
        except Exception as error:
            with _lock:
                if int(_state["attempt"]) == attempt:
                    _state.update(status="error", error=str(error)[:240], started_at=0.0)

    threading.Thread(target=run, name="reupai-gemini-oauth", daemon=True).start()
    return status()


def _oauth_headers(credentials: Credentials, project_id: str | None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {credentials.token}"}
    if project_id:
        headers["x-goog-user-project"] = project_id
    return headers


def _response_message(response: requests.Response) -> str:
    """Return a compact, safe message for the local setup screen."""
    try:
        data = response.json()
        value = data.get("error", {}).get("message", "") if isinstance(data, dict) else ""
    except ValueError:
        value = ""
    return str(value or "").replace("\n", " ")[:240]


def _gemini_check(credentials: Credentials, project_id: str | None) -> requests.Response:
    return requests.get(
        "https://generativelanguage.googleapis.com/v1beta/models",
        headers=_oauth_headers(credentials, project_id),
        timeout=15,
    )


def _is_api_disabled(response: requests.Response) -> bool:
    message = _response_message(response).lower()
    return response.status_code in {403, 404} and any(
        phrase in message
        for phrase in (
            "has not been used in project",
            "generativelanguage.googleapis.com",
            "gemini api is disabled",
            "gemini api has not been used",
        )
    )


def verify_gemini_access() -> dict[str, object]:
    """Check the actual Gemini endpoint without exposing a credential.

    We intentionally verify Gemini first. A customer can use an API already
    enabled by the ReupAI administrator without having IAM rights to inspect
    Google Cloud Service Usage themselves.
    """
    current = status()
    if current["needs_reauthorization"]:
        return {
            "state": "reauthorization_required",
            "ready": False,
            "message": "Cần kết nối lại Google để cấp quyền Gemini mới.",
            "project_id": get_project_id(),
        }
    credentials = get_credentials()
    project_id = get_project_id()
    if not credentials or not credentials.token:
        return {
            "state": "not_connected",
            "ready": False,
            "message": "Chưa kết nối Google cho Gemini.",
            "project_id": project_id,
        }
    try:
        response = _gemini_check(credentials, project_id)
    except requests.RequestException:
        return {
            "state": "temporary_error",
            "ready": False,
            "message": "Chưa thể kiểm tra Gemini. Hãy kiểm tra Internet rồi thử lại.",
            "project_id": project_id,
        }
    if response.ok:
        return {
            "state": "ready",
            "ready": True,
            "message": "Gemini đã sẵn sàng.",
            "project_id": project_id,
        }
    if _is_api_disabled(response):
        return {
            "state": "disabled",
            "ready": False,
            "message": "Gemini API chưa được bật cho dự án ReupAI.",
            "project_id": project_id,
        }
    if response.status_code in {401, 403}:
        return {
            "state": "reauthorization_required",
            "ready": False,
            "message": "Quyền Google đã hết hạn. Hãy kết nối lại Google.",
            "project_id": project_id,
        }
    return {
        "state": "error",
        "ready": False,
        "message": "Không thể xác nhận quyền Gemini lúc này. Hãy thử lại.",
        "project_id": project_id,
    }


def enable_gemini_api() -> dict[str, object]:
    """Request Google Cloud to enable Gemini API for the OAuth client project."""
    current = verify_gemini_access()
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
        response = requests.post(
            f"https://serviceusage.googleapis.com/v1/{service}:enable",
            headers=_oauth_headers(credentials, project_id),
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
            "project_id": project_id,
        }
    if response.status_code in {401, 403}:
        return {
            "state": "administrator_required",
            "ready": False,
            "message": "Tài khoản Google này chưa có quyền bật Gemini API cho dự án ReupAI.",
            "project_id": project_id,
        }
    return {
        "state": "error",
        "ready": False,
        "message": "Không thể bật Gemini API lúc này. Hãy thử lại.",
        "project_id": project_id,
    }


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
            )
