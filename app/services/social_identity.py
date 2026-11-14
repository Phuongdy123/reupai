"""Verify the cloud account before accessing its local social credentials."""
import hashlib
import os
import threading
import time
import uuid

import requests
from services.billing import BASE_URL

SOCIAL_BASE_URL = os.getenv("REUP_SOCIAL_SITE_URL", BASE_URL).rstrip("/")

_cache = {}
_lock = threading.Lock()


def account_for_token(token: str) -> str:
    if not token or len(token) > 16000:
        raise PermissionError("Hãy đăng nhập ReupAI để kết nối kênh.")
    key = hashlib.sha256(token.encode()).hexdigest()
    with _lock:
        cached = _cache.get(key)
        if cached and cached[0] > time.monotonic():
            return cached[1]
    try:
        response = requests.get(SOCIAL_BASE_URL + "/api/social/session", headers={"Authorization": "Bearer " + token}, timeout=10)
        if response.status_code == 401:
            raise PermissionError("Phiên ReupAI đã hết hạn. Hãy đăng nhập lại.")
        if not response.ok:
            raise RuntimeError("Chưa xác minh được tài khoản ReupAI. Kiểm tra kết nối rồi thử lại.")
        owner = str(uuid.UUID(response.json()["userId"]))
    except (requests.RequestException, ValueError, KeyError) as error:
        raise RuntimeError("Chưa xác minh được tài khoản ReupAI. Kiểm tra kết nối rồi thử lại.") from error
    with _lock:
        if len(_cache) >= 128:
            _cache.clear()
        _cache[key] = (time.monotonic() + 30, owner)
    return owner
