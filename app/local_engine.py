"""Standalone localhost adapter for the ReupAI Local Engine.

This process keeps the existing pipeline in place and exposes a small,
authenticated API for a future web frontend. It intentionally binds to
127.0.0.1 only.
"""

import secrets
import shutil
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Annotated

APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from runtime_paths import (
    get_downloads_dir,
    get_output_dir,
    get_runtime_root,
    ensure_runtime_dirs,
)
from services.job_db import list_active_jobs
from web.server import (
    DownloadRequest,
    PageRequest,
    ProcessRequest,
    SourceRequest,
    api_download,
    api_process,
    api_process_status,
    api_process_stop,
    api_videos,
    api_videos_page,
)


ENGINE_VERSION = "0.1.0"
LOCAL_TOKEN_PATH = get_runtime_root() / "local_token"
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


app = FastAPI(title="ReupAI Local Engine", version=ENGINE_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://reupai.vn",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def require_token(
    authorization: Annotated[str | None, Header()] = None,
):
    expected = f"Bearer {LOCAL_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Local Engine token không hợp lệ.")
    return True


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "engine": "ReupAI",
        "version": ENGINE_VERSION,
        "status": "ready",
    }


@app.get("/api/status")
def status(_: bool = Depends(require_token)):
    usage = shutil.disk_usage(get_runtime_root())
    return {
        "engine_running": True,
        "version": ENGINE_VERSION,
        "active_jobs": len(list_active_jobs(limit=20)),
        "storage": {
            "root": str(get_runtime_root()),
            "downloads": str(get_downloads_dir()),
            "output": str(get_output_dir()),
            "free_space": usage.free,
        },
    }


@app.post("/api/videos")
def videos(body: SourceRequest, _: bool = Depends(require_token)):
    return api_videos(body)


@app.post("/api/videos/page")
def videos_page(body: PageRequest, _: bool = Depends(require_token)):
    return api_videos_page(body)


@app.post("/api/download")
def download(body: DownloadRequest, _: bool = Depends(require_token)):
    return api_download(body)


def local_request() -> Request:
    request = SimpleNamespace()
    request.state = SimpleNamespace(user={"id": 1, "role": "local"})
    return request  # type: ignore[return-value]


@app.post("/api/process")
def process(body: ProcessRequest, _: bool = Depends(require_token)):
    return api_process(body, local_request())


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
    requested = (get_runtime_root() / file_path).resolve()
    root = get_runtime_root().resolve()
    if root not in requested.parents or not requested.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file local.")
    return FileResponse(str(requested))


def main():
    uvicorn.run(app, host="127.0.0.1", port=17888, log_level="info")


if __name__ == "__main__":
    main()
