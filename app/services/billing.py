"""Minimal bridge from the local worker to the website's billing ledger."""

import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASE_URL = os.getenv("REUP_BILLING_SITE_URL", "https://www.reupai.cloud").rstrip("/")


class BillingUnavailable(RuntimeError):
    pass


def _request(path: str, payload: dict | None = None, timeout: float = 10.0) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        f"{BASE_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "ReupAI-Local-Engine"},
        method="GET" if data is None else "POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as error:
        raise BillingUnavailable("Không thể xác minh gói ReupAI. Kiểm tra Internet rồi thử lại.") from error


def billing_enabled() -> bool:
    return bool(_request("/api/billing/config").get("enabled"))


def claim(token: str, video_id: str, mode: str) -> None:
    if not token or len(token) > 100:
        raise BillingUnavailable("Thiếu quyền xử lý video. Hãy đăng nhập ReupAI rồi thử lại.")
    result = _request("/api/billing/jobs/claim", {"token": token, "videoId": video_id, "mode": mode})
    if not result.get("allowed"):
        raise BillingUnavailable("Quyền xử lý video đã hết hiệu lực. Hãy bắt đầu lại từ website.")


def finish(token: str, status: str) -> bool:
    if not token:
        return True
    for attempt in range(3):
        try:
            return bool(_request("/api/billing/jobs/finish", {"token": token, "status": status}).get("ok"))
        except BillingUnavailable:
            if attempt < 2:
                time.sleep(2 ** attempt)
    return False
