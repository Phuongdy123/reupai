"""Publish finished videos using explicitly supplied provider credentials."""
from pathlib import Path
import re
import threading
import time
from urllib.parse import urlsplit
import uuid

import httpx

FACEBOOK = "https://graph.facebook.com/v27.0"
TIKTOK = "https://open.tiktokapis.com/v2"
_jobs = {}
_lock = threading.Lock()


def _headers(token):
    if not isinstance(token, str) or not 10 <= len(token) <= 4096 or not re.fullmatch(r"[\x21-\x7e]+", token):
        raise ValueError("Access token không hợp lệ.")
    return {"Authorization": f"Bearer {token}"}


def _result(response, platform):
    if response.status_code in {401, 403}:
        raise PermissionError(f"{platform} từ chối token hoặc quyền đăng.")
    if not response.is_success:
        raise RuntimeError(f"{platform} chưa xử lý được yêu cầu (HTTP {response.status_code}).")
    result = response.json()
    error = result.get("error", {})
    if error.get("code") not in {None, "ok"}:
        code = str(error["code"])
        if not re.fullmatch(r"[A-Za-z0-9_]{1,64}", code):
            code = "unknown"
        raise RuntimeError(f"{platform} từ chối yêu cầu ({code}).")
    return result


def destination(provider, token):
    headers = _headers(token)
    if provider == "facebook":
        result = _result(httpx.get(f"{FACEBOOK}/me", headers=headers,
                                  params={"fields": "id,name,category"}, timeout=15), "Facebook")
        if not result.get("category") or not re.fullmatch(r"\d+", str(result.get("id", ""))):
            raise ValueError("Cần Page access token của Fanpage.")
        return {"id": str(result["id"]), "name": str(result.get("name") or "Facebook Page")}
    if provider == "tiktok":
        result = _result(httpx.get(f"{TIKTOK}/user/info/", headers=headers,
                                  params={"fields": "open_id,display_name"}, timeout=15), "TikTok")
        user = result.get("data", {}).get("user", {})
        if user.get("open_id") and user.get("display_name"):
            return {"id": user["open_id"], "name": user["display_name"]}
        raise PermissionError("TikTok cần quyền user.info.basic để xác nhận tài khoản.")
    raise ValueError("Nền tảng không hợp lệ.")


def _facebook(token, page_id, message, video):
    headers = _headers(token)
    if video is None:
        response = httpx.post(f"{FACEBOOK}/{page_id}/feed", headers=headers,
                              data={"message": message}, timeout=30)
    else:
        with video.open("rb") as source:
            response = httpx.post(f"https://graph-video.facebook.com/v27.0/{page_id}/videos",
                                  headers=headers, data={"description": message, "published": "true"},
                                  files={"source": ("video.mp4", source, "video/mp4")}, timeout=120)
    identifier = _result(response, "Facebook").get("id")
    if not identifier or not re.fullmatch(r"\d+(?:_\d+)?", str(identifier)):
        raise RuntimeError("Facebook chưa trả mã bài đăng hoặc video.")
    return {"state": "complete", "url": f"https://www.facebook.com/{identifier}"}


def _tiktok(token, video, progress):
    size = video.stat().st_size
    if not 0 < size <= 4 * 1024 ** 3:
        raise ValueError("Video TikTok phải có kích thước lớn hơn 0 và không quá 4 GB.")
    chunk_size = min(size, 16 * 1024 ** 2)
    count = size // chunk_size
    headers = _headers(token)
    response = httpx.post(f"{TIKTOK}/post/publish/inbox/video/init/", headers=headers, timeout=30,
                          json={"source_info": {"source": "FILE_UPLOAD", "video_size": size,
                                                "chunk_size": chunk_size, "total_chunk_count": count}})
    target = _result(response, "TikTok").get("data", {})
    url = urlsplit(target.get("upload_url", ""))
    if url.scheme != "https" or not (url.hostname or "").endswith(".tiktokapis.com") or url.username or url.password:
        raise RuntimeError("TikTok chưa cung cấp địa chỉ tải video hợp lệ.")
    with video.open("rb") as source, httpx.Client(timeout=90) as client:
        for index in range(count):
            start = index * chunk_size
            length = size - start if index == count - 1 else chunk_size
            data = source.read(length)
            if len(data) != length:
                raise RuntimeError("Video đã thay đổi trong lúc tải.")
            sent = client.put(url.geturl(), content=data, headers={"Content-Type": "video/mp4",
                              "Content-Range": f"bytes {start}-{start + length - 1}/{size}"})
            if sent.status_code != (201 if index == count - 1 else 206):
                raise RuntimeError(f"TikTok chưa nhận được video (HTTP {sent.status_code}).")
            progress(round(95 * (start + length) / size))
    publish_id = target.get("publish_id")
    if not publish_id:
        raise RuntimeError("TikTok chưa trả mã theo dõi video.")
    return {"state": "sent", "publish_id": publish_id}


def start(owner, provider, payload, video: Path | None):
    if payload.get("confirmed") is not True:
        raise ValueError("Hãy xác nhận trước khi gửi bài.")
    request_id = str(uuid.UUID(str(payload.get("request_id", ""))))
    message = str(payload.get("message") or "").strip()
    if len(message) > 5000 or (provider == "facebook" and not message and video is None):
        raise ValueError("Hãy nhập nội dung tối đa 5.000 ký tự.")
    if provider == "tiktok" and video is None:
        raise ValueError("Hãy chọn video thành phẩm.")
    token = payload.get("token")
    target = destination(provider, token)
    if target["id"] != payload.get("target_id"):
        raise PermissionError("Tài khoản đích đã thay đổi. Hãy kiểm tra lại trước khi gửi.")
    key = (owner, provider, request_id)
    with _lock:
        for old_key, job in list(_jobs.items()):
            if job["state"] != "uploading" and time.monotonic() - job["started"] > 86400:
                del _jobs[old_key]
        if key in _jobs:
            return status(owner, provider, request_id, locked=True)
        _jobs[key] = {"state": "uploading", "percent": 0, "started": time.monotonic()}

    def update(**values):
        with _lock:
            _jobs[key].update(values)

    def run():
        try:
            result = _facebook(token, target["id"], message, video) if provider == "facebook" else _tiktok(token, video, lambda percent: update(percent=percent))
            update(**result, percent=100)
        except (ValueError, RuntimeError, PermissionError) as error:
            update(state="failed", error=str(error))
        except Exception:
            update(state="failed", error="Chưa xác nhận được kết quả. Kiểm tra trên nền tảng trước khi thử lại.")

    threading.Thread(target=run, daemon=True, name=f"reupai-{provider}-publish").start()
    return status(owner, provider, request_id)


def status(owner, provider, request_id, *, locked=False):
    if not locked:
        with _lock:
            return status(owner, provider, request_id, locked=True)
    job = _jobs.get((owner, provider, request_id))
    if not job:
        raise FileNotFoundError("Không tìm thấy lượt gửi này.")
    return {"id": request_id, **{key: value for key, value in job.items() if key != "started"}}
