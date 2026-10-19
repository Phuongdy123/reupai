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
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

from runtime_paths import get_config_dir


SCOPES = ["https://www.googleapis.com/auth/generative-language.retriever"]
TOKEN_PATH = get_config_dir() / "gemini-oauth.dat"
_lock = threading.Lock()
_state: dict[str, str] = {"status": "disconnected", "error": ""}


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


def _load_credentials() -> Credentials | None:
    try:
        payload = TOKEN_PATH.read_bytes()
        if payload.startswith(b"DPAPI:"):
            payload = _dpapi_decrypt(base64.b64decode(payload[6:]))
        data = json.loads(payload.decode("utf-8"))
        return Credentials.from_authorized_user_info(data, SCOPES)
    except (OSError, ValueError, TypeError, UnicodeError):
        return None


def _save_credentials(credentials: Credentials) -> None:
    data = credentials.to_json().encode("utf-8")
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        data = b"DPAPI:" + base64.b64encode(_dpapi_encrypt(data))
    temporary = TOKEN_PATH.with_suffix(".tmp")
    temporary.write_bytes(data)
    temporary.replace(TOKEN_PATH)


def get_credentials() -> Credentials | None:
    credentials = _load_credentials()
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
    credentials = get_credentials()
    with _lock:
        running = _state["status"] == "connecting"
        error = _state["error"]
    return {
        "configured": _client_config() is not None,
        "connected": credentials is not None,
        "connecting": running,
        "error": error if error else None,
        "storage": "windows_dpapi" if os.name == "nt" else "local_user_file",
    }


def start_authorization() -> dict[str, object]:
    if _client_config() is None:
        raise RuntimeError("Google OAuth chưa được cấu hình trong Local Engine. Hãy cập nhật bản Engine do ReupAI phát hành.")
    with _lock:
        if _state["status"] == "connecting":
            return status()
        _state.update(status="connecting", error="")

    def run() -> None:
        try:
            flow = InstalledAppFlow.from_client_config(_client_config(), SCOPES)
            credentials = flow.run_local_server(host="localhost", port=0, open_browser=True, authorization_prompt_message="ReupAI đang mở trang đăng nhập Google…")
            _save_credentials(credentials)
            with _lock:
                _state.update(status="connected", error="")
        except Exception as error:
            with _lock:
                _state.update(status="error", error=str(error)[:240])

    threading.Thread(target=run, name="reupai-gemini-oauth", daemon=True).start()
    return status()


def disconnect() -> None:
    try:
        TOKEN_PATH.unlink(missing_ok=True)
    finally:
        with _lock:
            _state.update(status="disconnected", error="")
