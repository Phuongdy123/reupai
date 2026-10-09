import html
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path
from datetime import datetime
from typing import Literal

from fastapi import FastAPI, Form, HTTPException, Query, Request
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
    Response,
)
from starlette.middleware.sessions import SessionMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel


# =========================================================
# WINDOWS UTF-8
# =========================================================

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(
        encoding="utf-8",
        errors="replace",
    )

if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(
        encoding="utf-8",
        errors="replace",
    )


# =========================================================
# PATHS
# =========================================================

APP_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = APP_DIR.parent

if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

DOWNLOAD_ROOT = APP_DIR / "downloads" / "demo"
PIPELINE_FILE = APP_DIR / "pipeline.py"

WEB_DIR = APP_DIR / "web"
TEMPLATE_DIR = WEB_DIR / "templates"
STATIC_DIR = WEB_DIR / "static"

DOWNLOAD_ROOT.mkdir(
    parents=True,
    exist_ok=True,
)


# =========================================================
# SERVICES
# =========================================================

from services.sources.bilibili import (
    fetch_latest_meta as bilibili_fetch_latest_meta,
    fetch_page_meta as bilibili_fetch_page_meta,
    BilibiliRateLimited,
)

from services.sources.douyin import (
    fetch_latest_meta as douyin_fetch_latest_meta,
    fetch_page_meta as douyin_fetch_page_meta,
    download_video as douyin_download_video,
    DouyinUnavailable,
)

from services.source_db import (
    get_connection,
    save_video,
)

from services.job_db import (
    complete_job,
    create_job,
    fail_job,
    file_stats,
    list_active_jobs,
    mark_job_started,
    recover_interrupted_jobs,
    register_video_file,
    update_job_progress,
    update_source_video_state,
)

from services.auth_service import (
    authenticate_user,
    get_user_by_id,
)


# =========================================================
# APP
# =========================================================

def get_session_secret():
    env_secret = (
        os.getenv(
            "REUP_SESSION_SECRET",
            "",
        )
        .strip()
    )

    if env_secret:
        return env_secret

    secret_file = (
        APP_DIR
        / "data"
        / ".session_secret"
    )

    secret_file.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    if secret_file.exists():

        value = (
            secret_file
            .read_text(
                encoding="utf-8",
            )
            .strip()
        )

        if value:
            return value

    value = secrets.token_urlsafe(
        48
    )

    secret_file.write_text(
        value,
        encoding="utf-8",
    )

    return value


SESSION_SECRET = (
    get_session_secret()
)

SESSION_HTTPS_ONLY = (
    os.getenv(
        "REUP_HTTPS_ONLY",
        "0",
    )
    .strip()
    .lower()
    in {
        "1",
        "true",
        "yes",
        "on",
    }
)


app = FastAPI(
    title="Reup AI Dashboard",
    version="0.13.0",
)


# =========================================================
# V13 LIBRARY ROUTER
# =========================================================

from services.library_api import (
    router as library_router,
)

app.include_router(
    library_router
)


PUBLIC_PATHS = {
    "/login",
    "/favicon.ico",
}


@app.middleware(
    "http"
)
async def auth_guard(
    request: Request,
    call_next,
):

    path = (
        request.url.path
    )

    if (
        path in PUBLIC_PATHS
        or path.startswith("/static/")
    ):

        return await call_next(
            request
        )

    user_id = (
        request.session.get(
            "user_id"
        )
    )

    if not user_id:

        if path.startswith(
            "/api/"
        ):

            return JSONResponse(
                status_code=401,
                content={
                    "detail":
                        (
                            "Chưa đăng nhập "
                            "hoặc phiên đã hết hạn."
                        )
                },
            )

        return RedirectResponse(
            url="/login",
            status_code=303,
        )

    try:

        user = get_user_by_id(
            int(
                user_id
            )
        )

    except Exception:

        user = None

    if (
        not user
        or not bool(
            user.get(
                "enabled",
                0,
            )
        )
    ):

        request.session.clear()

        if path.startswith(
            "/api/"
        ):

            return JSONResponse(
                status_code=401,
                content={
                    "detail":
                        "Tài khoản không hợp lệ."
                },
            )

        return RedirectResponse(
            url="/login",
            status_code=303,
        )

    request.state.user = user

    return await call_next(
        request
    )


# IMPORTANT:
# SessionMiddleware is added AFTER auth_guard registration so it
# wraps the auth middleware and request.session is available there.
app.add_middleware(
    SessionMiddleware,
    secret_key=
        SESSION_SECRET,
    session_cookie=
        "reup_session",
    max_age=
        60 * 60 * 24 * 7,
    same_site=
        "lax",
    https_only=
        SESSION_HTTPS_ONLY,
)


templates = Jinja2Templates(
    directory=str(
        TEMPLATE_DIR
    )
)

app.mount(
    "/static",
    StaticFiles(
        directory=str(
            STATIC_DIR
        )
    ),
    name="static",
)


# =========================================================
# PROCESS STATE
# =========================================================

PROCESS_STATE = {}
PROCESS_LOCK = threading.Lock()


# =========================================================
# REQUEST MODELS
# =========================================================

class SourceRequest(BaseModel):
    url: str
    limit: int = 10
    refresh: bool = False


class PageRequest(BaseModel):
    url: str
    page: int = 1
    page_size: int = 10


class DownloadRequest(BaseModel):
    url: str
    video_id: str


class ProcessRequest(BaseModel):
    url: str
    video_id: str
    channel: str = "2d_animation"
    mode: Literal[
        "subtitle",
        "voiceover",
    ] = "subtitle"


# =========================================================
# BASIC HELPERS
# =========================================================

def detect_platform(
    url: str,
) -> str:

    value = (
        url.strip()
        .lower()
    )

    if (
        "bilibili.com" in value
        or "b23.tv" in value
    ):
        return "bilibili"

    if "douyin.com" in value:
        return "douyin"

    return "unknown"


def validate_video_id(
    video_id: str,
) -> str:

    value = (
        video_id.strip()
    )

    # Bilibili
    if re.fullmatch(
        r"BV[0-9A-Za-z]{6,20}",
        value,
    ):
        return value

    # Douyin aweme/video ID
    if re.fullmatch(
        r"\d{10,25}",
        value,
    ):
        return value

    raise HTTPException(
        status_code=400,
        detail=(
            "Video ID khong hop le. "
            "Ho tro Bilibili BV... "
            "hoac Douyin numeric ID."
        ),
    )


def validate_channel(
    channel: str,
) -> str:

    value = channel.strip()

    if not re.fullmatch(
        r"[A-Za-z0-9_-]+",
        value,
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Channel key "
                "không hợp lệ."
            ),
        )

    return value


def normalize_profile_url(
    url: str,
) -> str:

    value = url.strip()

    parsed = urllib.parse.urlsplit(
        value
    )

    path = (
        parsed.path.rstrip("/")
        or "/"
    )

    return urllib.parse.urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            path,
            "",
            "",
        )
    )


def downloaded_source_path(
    video_id: str,
) -> Path:

    return (
        DOWNLOAD_ROOT
        / video_id
        / "source.mp4"
    )


def local_source_for_process(
    channel: str,
    video_id: str,
) -> Path | None:
    candidates = [
        DOWNLOAD_ROOT / video_id,
        job_dir_for(channel, video_id),
    ]

    for folder in candidates:
        source = find_downloaded_video(folder)

        if source:
            return source

    return None


def job_dir_for(
    channel: str,
    video_id: str,
) -> Path:

    return (
        APP_DIR
        / "channels"
        / channel
        / "jobs"
        / video_id
    )


def process_key(
    channel: str,
    video_id: str,
    mode: str,
) -> str:

    return (
        f"{channel}:"
        f"{video_id}:"
        f"{mode}"
    )


def file_ok(
    path: Path,
) -> bool:

    return (
        path.exists()
        and path.is_file()
        and path.stat().st_size > 0
    )


def read_json_file(
    path: Path,
):

    try:

        if not file_ok(
            path
        ):
            return None

        with open(
            path,
            "r",
            encoding="utf-8",
        ) as file:

            return json.load(
                file
            )

    except Exception:
        return None


def read_log_tail(
    path: Path,
    line_count: int = 12,
) -> list[str]:

    try:

        if not file_ok(
            path
        ):
            return []

        with open(
            path,
            "r",
            encoding="utf-8",
            errors="replace",
        ) as file:

            lines = (
                file.readlines()
            )

        return [
            line.rstrip()
            for line
            in lines[
                -line_count:
            ]
            if line.strip()
        ]

    except Exception:
        return []


def find_downloaded_video(
    folder: Path,
) -> Path | None:

    preferred = (
        folder
        / "source.mp4"
    )

    if file_ok(
        preferred
    ):
        return preferred

    for ext in (
        "mp4",
        "mkv",
        "webm",
        "mov",
    ):

        path = (
            folder
            / f"source.{ext}"
        )

        if file_ok(
            path
        ):
            return path

    return None


def find_result_file(
    channel: str,
    video_id: str,
    mode: str,
) -> Path | None:

    job_dir = job_dir_for(
        channel,
        video_id,
    )

    filename = (
        "final_sub.mp4"
        if mode == "subtitle"
        else "final_voice.mp4"
    )

    path = (
        job_dir
        / filename
    )

    if file_ok(
        path
    ):
        return path

    job_info = read_json_file(
        job_dir
        / "job.json"
    )

    if not job_info:
        return None

    final_video = (
        job_info.get(
            "final_video"
        )
    )

    if not final_video:
        return None

    candidate = Path(
        final_video
    )

    if not candidate.is_absolute():
        candidate = (
            PROJECT_ROOT
            / candidate
        )

    candidate = (
        candidate.resolve()
    )

    try:

        candidate.relative_to(
            PROJECT_ROOT.resolve()
        )

    except ValueError:
        return None

    if file_ok(
        candidate
    ):
        return candidate

    return None


# =========================================================
# SQLITE CACHE
# =========================================================

def find_source_by_profile(
    profile_url: str,
):

    target = normalize_profile_url(
        profile_url
    )

    conn = get_connection()

    try:

        rows = conn.execute(
            """
            SELECT *
            FROM sources
            WHERE enabled = 1
            ORDER BY id DESC
            """
        ).fetchall()

        for row in rows:

            current = (
                normalize_profile_url(
                    row["profile_url"]
                )
            )

            if current == target:
                return dict(row)

    finally:
        conn.close()

    return None


def load_cached_videos(
    source_id: int,
    *,
    limit: int = 250,
):

    conn = get_connection()

    try:

        source_row = conn.execute(
            """
            SELECT platform
            FROM sources
            WHERE id = ?
            LIMIT 1
            """,
            (
                source_id,
            ),
        ).fetchone()

        platform = (
            source_row["platform"]
            if source_row
            else "unknown"
        )

        rows = conn.execute(
            """
            SELECT *
            FROM source_videos
            WHERE source_id = ?
            ORDER BY
                published_at DESC,
                id DESC
            LIMIT ?
            """,
            (
                source_id,
                limit,
            ),
        ).fetchall()

    finally:
        conn.close()

    return [
        {
            "platform":
                platform,

            "video_id":
                row["platform_video_id"],

            "url":
                row["url"],

            "title":
                row["title"]
                or "",

            "cover_url":
                row["cover_url"]
                or "",

            "published_at":
                row["published_at"],

            "play_count":
                row["play_count"]
                or 0,

            "like_count":
                row["like_count"]
                or 0,

            "comment_count":
                row["comment_count"]
                or 0,

            "share_count":
                row["share_count"]
                or 0,

            "db_status":
                row["status"]
                or "new",

            "db_job_id":
                row["job_id"],
        }
        for row in rows
    ]


def cache_live_videos(
    source_id: int,
    videos,
):

    for video in videos:

        try:

            save_video(
                source_id=
                    source_id,

                platform_video_id=
                    video["video_id"],

                url=
                    video["url"],

                title=
                    video.get(
                        "title",
                        "",
                    ),

                cover_url=
                    video.get(
                        "cover_url",
                        "",
                    ),

                published_at=
                    video.get(
                        "published_at"
                    ),

                play_count=
                    int(
                        video.get(
                            "play_count",
                            0,
                        )
                        or 0
                    ),

                like_count=
                    int(
                        video.get(
                            "like_count",
                            0,
                        )
                        or 0
                    ),

                comment_count=
                    int(
                        video.get(
                            "comment_count",
                            0,
                        )
                        or 0
                    ),

                share_count=
                    int(
                        video.get(
                            "share_count",
                            0,
                        )
                        or 0
                    ),
            )

        except Exception as error:

            print(
                "[CACHE WARN]",
                video.get(
                    "video_id"
                ),
                error,
            )


def merge_videos(
    live_videos,
    cached_videos,
):

    merged = {}
    order = []

    for video in (
        list(live_videos)
        + list(cached_videos)
    ):

        video_id = (
            video.get(
                "video_id"
            )
        )

        if not video_id:
            continue

        if video_id not in merged:

            merged[
                video_id
            ] = dict(
                video
            )

            order.append(
                video_id
            )

        else:

            old = merged[
                video_id
            ]

            new = dict(
                old
            )

            for key, value in (
                video.items()
            ):

                if (
                    value is not None
                    and value != ""
                ):
                    new[key] = value

            merged[
                video_id
            ] = new

    return [
        merged[
            video_id
        ]
        for video_id in order
    ]


def get_processing_state(
    video_id: str,
):

    with PROCESS_LOCK:

        for state in (
            PROCESS_STATE.values()
        ):

            if (
                state.get(
                    "video_id"
                )
                == video_id
                and state.get(
                    "status"
                )
                in {
                    "queued",
                    "processing",
                }
            ):
                return dict(
                    state
                )

    return None


def enrich_video(
    video: dict,
    *,
    default_channel: str,
):

    result = dict(
        video
    )

    video_id = (
        result[
            "video_id"
        ]
    )

    channel = (
        result.get(
            "channel_key"
        )
        or default_channel
        or "2d_animation"
    )

    download_file = (
        find_downloaded_video(
            DOWNLOAD_ROOT
            / video_id
        )
    )

    subtitle_file = (
        find_result_file(
            channel,
            video_id,
            "subtitle",
        )
    )

    voice_file = (
        find_result_file(
            channel,
            video_id,
            "voiceover",
        )
    )

    processing = (
        get_processing_state(
            video_id
        )
    )

    result[
        "channel_key"
    ] = channel

    result[
        "downloaded"
    ] = (
        download_file
        is not None
    )

    result[
        "has_subtitle_result"
    ] = (
        subtitle_file
        is not None
    )

    result[
        "has_voice_result"
    ] = (
        voice_file
        is not None
    )

    result[
        "processing"
    ] = (
        processing
        is not None
    )

    if processing:

        result[
            "processing_mode"
        ] = processing.get(
            "mode"
        )

    else:

        result[
            "processing_mode"
        ] = None

    return result


# =========================================================
# V12.2 DB FILE SYNC
# =========================================================

def register_downloaded_source(
    video_id: str,
    path,
):
    try:
        register_video_file(
            platform_video_id=
                video_id,
            file_type=
                "source",
            path=
                path,
            job_id=
                None,
        )
    except Exception as error:
        print(
            "[DB WARN] source file:",
            error,
        )


def sync_job_files(
    *,
    video_id: str,
    channel: str,
    job_id=None,
):
    job_dir = job_dir_for(
        channel,
        video_id,
    )

    source_path = (
        find_downloaded_video(
            DOWNLOAD_ROOT
            / video_id
        )
    )

    files = []

    if source_path:
        files.append(
            (
                "source",
                source_path,
            )
        )

    candidates = [
        (
            "source_audio",
            job_dir
            / "source_16k.wav",
        ),
        (
            "chinese_srt",
            job_dir
            / "chinese.srt",
        ),
        (
            "vietnamese_srt",
            job_dir
            / "vietnamese.srt",
        ),
        (
            "voice",
            job_dir
            / "voice.wav",
        ),
        (
            "subtitle_region",
            job_dir
            / "subtitle_region.json",
        ),
        (
            "final_ass",
            job_dir
            / "final.ass",
        ),
        (
            "final_sub",
            job_dir
            / "final_sub.mp4",
        ),
        (
            "final_voice",
            job_dir
            / "final_voice.mp4",
        ),
    ]

    files.extend(
        candidates
    )

    for (
        file_type,
        path,
    ) in files:

        try:
            register_video_file(
                platform_video_id=
                    video_id,
                file_type=
                    file_type,
                path=
                    path,
                job_id=
                    job_id,
            )

        except Exception as error:
            print(
                "[DB WARN] register file",
                file_type,
                error,
            )


def sync_existing_files_to_db():
    if DOWNLOAD_ROOT.exists():

        for folder in (
            DOWNLOAD_ROOT
            .iterdir()
        ):

            if not folder.is_dir():
                continue

            source = (
                find_downloaded_video(
                    folder
                )
            )

            if source:

                register_downloaded_source(
                    folder.name,
                    source,
                )

    channels_dir = (
        APP_DIR
        / "channels"
    )

    if not channels_dir.exists():
        return

    for channel_dir in (
        channels_dir
        .iterdir()
    ):

        jobs_dir = (
            channel_dir
            / "jobs"
        )

        if not jobs_dir.exists():
            continue

        for job_dir in (
            jobs_dir
            .iterdir()
        ):

            if not job_dir.is_dir():
                continue

            sync_job_files(
                video_id=
                    job_dir.name,
                channel=
                    channel_dir.name,
                job_id=
                    None,
            )


# =========================================================
# BACKGROUND PIPELINE
# =========================================================

def pipeline_worker(
    *,
    video_url: str,
    video_id: str,
    channel: str,
    mode: str,
    db_job_id: int,
):

    key = process_key(
        channel,
        video_id,
        mode,
    )

    job_dir = job_dir_for(
        channel,
        video_id,
    )

    job_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    progress_path = (
        job_dir
        / "progress.json"
    )

    log_path = (
        job_dir
        / f"web_{mode}.log"
    )

    command = [
        sys.executable,
        str(
            PIPELINE_FILE
        ),
        video_url,
        "--channel",
        channel,
        "--mode",
        mode,
    ]

    source_path = (
        local_source_for_process(
            channel,
            video_id,
        )
    )

    if (
        source_path
        and file_ok(
            source_path
        )
    ):

        command.extend([
            "--source-file",
            str(
                source_path
            ),
        ])

    mark_job_started(
        db_job_id
    )

    update_source_video_state(
        platform_video_id=
            video_id,
        status=
            "processing",
        job_id=
            db_job_id,
    )

    with PROCESS_LOCK:

        PROCESS_STATE[
            key
        ] = {
            "status":
                "processing",

            "stage":
                "starting",

            "percent":
                1,

            "message":
                (
                    "Pipeline "
                    "đang khởi động..."
                ),

            "mode":
                mode,

            "channel":
                channel,

            "video_id":
                video_id,

            "db_job_id":
                db_job_id,

            "log_path":
                str(
                    log_path
                ),
        }

    try:

        with open(
            log_path,
            "w",
            encoding="utf-8",
            errors="replace",
        ) as log_file:

            log_file.write(
                "COMMAND:\n"
                + " ".join(
                    command
                )
                + "\n\n"
            )

            log_file.flush()

            env = (
                os.environ.copy()
            )

            env[
                "PYTHONIOENCODING"
            ] = "utf-8"

            env[
                "PYTHONUTF8"
            ] = "1"

            process = subprocess.Popen(
                command,
                cwd=str(
                    PROJECT_ROOT
                ),
                stdout=log_file,
                stderr=
                    subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
            )

            last_signature = None

            while True:

                return_code = (
                    process.poll()
                )

                progress = (
                    read_json_file(
                        progress_path
                    )
                )

                if progress:

                    status = (
                        progress.get(
                            "status"
                        )
                        or "processing"
                    )

                    stage = (
                        progress.get(
                            "stage"
                        )
                        or "processing"
                    )

                    percent = (
                        progress.get(
                            "percent",
                            0,
                        )
                    )

                    message = (
                        progress.get(
                            "message"
                        )
                        or stage
                    )

                    signature = (
                        str(
                            status
                        ),
                        str(
                            stage
                        ),
                        int(
                            float(
                                percent
                                or 0
                            )
                        ),
                        str(
                            message
                        ),
                    )

                    if (
                        signature
                        != last_signature
                    ):

                        db_status = (
                            "processing"
                            if status not in {
                                "completed",
                                "failed",
                            }
                            else status
                        )

                        update_job_progress(
                            db_job_id,
                            status=
                                db_status,
                            stage=
                                stage,
                            progress=
                                percent,
                        )

                        with PROCESS_LOCK:

                            state = (
                                PROCESS_STATE
                                .setdefault(
                                    key,
                                    {},
                                )
                            )

                            state.update({
                                "status":
                                    db_status,

                                "stage":
                                    stage,

                                "percent":
                                    percent,

                                "message":
                                    message,

                                "mode":
                                    mode,

                                "channel":
                                    channel,

                                "video_id":
                                    video_id,

                                "db_job_id":
                                    db_job_id,

                                "log_path":
                                    str(
                                        log_path
                                    ),
                            })

                        sync_job_files(
                            video_id=
                                video_id,
                            channel=
                                channel,
                            job_id=
                                db_job_id,
                        )

                        last_signature = (
                            signature
                        )

                if (
                    return_code
                    is not None
                ):
                    break

                time.sleep(
                    1.0
                )

        progress = (
            read_json_file(
                progress_path
            )
        )

        if (
            return_code
            == 0
        ):

            result_file = (
                find_result_file(
                    channel,
                    video_id,
                    mode,
                )
            )

            sync_job_files(
                video_id=
                    video_id,
                channel=
                    channel,
                job_id=
                    db_job_id,
            )

            complete_job(
                db_job_id,
                output_path=
                    result_file,
            )

            update_source_video_state(
                platform_video_id=
                    video_id,
                status=
                    "processed",
                job_id=
                    db_job_id,
            )

            with PROCESS_LOCK:

                PROCESS_STATE[
                    key
                ] = {
                    "status":
                        "completed",

                    "stage":
                        "completed",

                    "percent":
                        100,

                    "message":
                        (
                            "Xử lý AI "
                            "hoàn tất."
                        ),

                    "mode":
                        mode,

                    "channel":
                        channel,

                    "video_id":
                        video_id,

                    "db_job_id":
                        db_job_id,

                    "result_ready":
                        (
                            result_file
                            is not None
                        ),

                    "log_path":
                        str(
                            log_path
                        ),
                }

        else:

            message = (
                progress.get(
                    "message"
                )
                if progress
                else (
                    "Pipeline dừng "
                    f"với exit code "
                    f"{return_code}."
                )
            )

            fail_job(
                db_job_id,
                message=
                    message,
                stage=
                    (
                        progress.get(
                            "stage",
                            "failed",
                        )
                        if progress
                        else "failed"
                    ),
            )

            update_source_video_state(
                platform_video_id=
                    video_id,
                status=
                    "failed",
                job_id=
                    db_job_id,
            )

            with PROCESS_LOCK:

                PROCESS_STATE[
                    key
                ] = {
                    "status":
                        "failed",

                    "stage":
                        "failed",

                    "percent":
                        (
                            progress.get(
                                "percent",
                                0,
                            )
                            if progress
                            else 0
                        ),

                    "message":
                        message,

                    "mode":
                        mode,

                    "channel":
                        channel,

                    "video_id":
                        video_id,

                    "db_job_id":
                        db_job_id,

                    "log_path":
                        str(
                            log_path
                        ),
                }

    except Exception as error:

        message = (
            type(error).__name__
            + ": "
            + str(error)
        )

        try:
            fail_job(
                db_job_id,
                message=
                    message,
                stage=
                    "exception",
            )

            update_source_video_state(
                platform_video_id=
                    video_id,
                status=
                    "failed",
                job_id=
                    db_job_id,
            )

        except Exception as db_error:

            print(
                "[DB ERROR]",
                db_error,
            )

        with PROCESS_LOCK:

            PROCESS_STATE[
                key
            ] = {
                "status":
                    "failed",

                "stage":
                    "exception",

                "percent":
                    0,

                "message":
                    message,

                "mode":
                    mode,

                "channel":
                    channel,

                "video_id":
                    video_id,

                "db_job_id":
                    db_job_id,

                "log_path":
                    str(
                        log_path
                    ),
            }


# =========================================================
# COVER PROXY
# =========================================================

def cover_host_allowed(
    hostname: str,
) -> bool:

    hostname = (
        hostname.lower()
        .strip(".")
    )

    allowed_suffixes = (
        # Bilibili
        "hdslb.com",
        "biliimg.com",

        # Douyin / ByteDance
        "douyinpic.com",
        "douyincdn.com",
        "byteimg.com",
        "byteimg.cn",
        "ibytedtos.com",
        "pstatp.com",
    )

    return any(
        hostname == suffix
        or hostname.endswith(
            "." + suffix
        )
        for suffix
        in allowed_suffixes
    )



# =========================================================
# V12.1 WEB HELPERS
# =========================================================

def current_user(
    request: Request,
):
    return getattr(
        request.state,
        "user",
        None,
    )


def template_context(
    request: Request,
    *,
    title: str,
    active: str,
    **extra,
):
    context = {
        "request":
            request,

        "title":
            title,

        "active":
            active,

        "user":
            current_user(
                request
            ),
    }

    context.update(
        extra
    )

    return context


def human_size(
    size_bytes: int,
):
    value = float(
        size_bytes
        or 0
    )

    units = [
        "B",
        "KB",
        "MB",
        "GB",
        "TB",
    ]

    for unit in units:

        if (
            value < 1024
            or unit == units[-1]
        ):

            if unit == "B":
                return f"{int(value)} {unit}"

            return (
                f"{value:.1f} {unit}"
            )

        value /= 1024

    return (
        f"{value:.1f} TB"
    )


def file_mtime_text(
    path: Path,
):
    try:

        return (
            datetime
            .fromtimestamp(
                path.stat().st_mtime
            )
            .strftime(
                "%d/%m/%Y %H:%M"
            )
        )

    except Exception:
        return ""


def video_metadata_map():
    conn = get_connection()

    try:

        rows = conn.execute(
            """
            SELECT
                platform_video_id,
                title,
                cover_url,
                url,
                published_at,
                play_count
            FROM source_videos
            ORDER BY id DESC
            """
        ).fetchall()

    except Exception:
        rows = []

    finally:
        conn.close()

    result = {}

    for row in rows:

        key = (
            row[
                "platform_video_id"
            ]
        )

        if key not in result:
            result[key] = dict(
                row
            )

    return result


def scan_downloaded_library():
    metadata = (
        video_metadata_map()
    )

    items = []

    if not DOWNLOAD_ROOT.exists():
        return items

    for folder in sorted(
        DOWNLOAD_ROOT.iterdir(),
        key=lambda path:
            path.stat().st_mtime,
        reverse=True,
    ):

        if not folder.is_dir():
            continue

        video_id = (
            folder.name
        )

        source_file = (
            find_downloaded_video(
                folder
            )
        )

        if not source_file:
            continue

        meta = (
            metadata.get(
                video_id,
                {},
            )
        )

        items.append({
            "video_id":
                video_id,

            "title":
                meta.get(
                    "title"
                )
                or video_id,

            "cover_url":
                meta.get(
                    "cover_url"
                )
                or "",

            "source_url":
                meta.get(
                    "url"
                )
                or "",

            "play_count":
                meta.get(
                    "play_count"
                )
                or 0,

            "path":
                str(
                    source_file
                ),

            "size_bytes":
                source_file
                .stat()
                .st_size,

            "size_text":
                human_size(
                    source_file
                    .stat()
                    .st_size
                ),

            "updated_at":
                file_mtime_text(
                    source_file
                ),
        })

    return items


def scan_outputs_library():
    metadata = (
        video_metadata_map()
    )

    items = []

    channels_dir = (
        APP_DIR
        / "channels"
    )

    if not channels_dir.exists():
        return items

    for channel_dir in (
        channels_dir.iterdir()
    ):

        jobs_dir = (
            channel_dir
            / "jobs"
        )

        if (
            not channel_dir.is_dir()
            or not jobs_dir.exists()
        ):
            continue

        for job_dir in (
            jobs_dir.iterdir()
        ):

            if not job_dir.is_dir():
                continue

            video_id = (
                job_dir.name
            )

            meta = (
                metadata.get(
                    video_id,
                    {},
                )
            )

            candidates = [
                (
                    "subtitle",
                    "Vietsub",
                    job_dir
                    / "final_sub.mp4",
                ),
                (
                    "voiceover",
                    "Vietsub + Voice",
                    job_dir
                    / "final_voice.mp4",
                ),
            ]

            for (
                mode,
                mode_label,
                path,
            ) in candidates:

                if not file_ok(
                    path
                ):
                    continue

                size = (
                    path
                    .stat()
                    .st_size
                )

                items.append({
                    "video_id":
                        video_id,

                    "title":
                        meta.get(
                            "title"
                        )
                        or video_id,

                    "cover_url":
                        meta.get(
                            "cover_url"
                        )
                        or "",

                    "channel":
                        channel_dir.name,

                    "mode":
                        mode,

                    "mode_label":
                        mode_label,

                    "size_bytes":
                        size,

                    "size_text":
                        human_size(
                            size
                        ),

                    "updated_at":
                        file_mtime_text(
                            path
                        ),
                })

    items.sort(
        key=lambda item:
            item[
                "updated_at"
            ],
        reverse=True,
    )

    return items


def load_job_history(
    limit: int = 100,
):
    conn = get_connection()

    try:

        rows = conn.execute(
            """
            SELECT
                id,
                job_key,
                platform_video_id,
                channel_key,
                mode,
                status,
                stage,
                progress,
                error_message,
                created_at,
                started_at,
                completed_at,
                updated_at
            FROM jobs
            ORDER BY id DESC
            LIMIT ?
            """,
            (
                int(
                    limit
                ),
            ),
        ).fetchall()

        return [
            dict(
                row
            )
            for row in rows
        ]

    except Exception:
        return []

    finally:
        conn.close()


def dashboard_data():
    conn = get_connection()

    try:

        def count(
            sql,
            params=(),
        ):
            row = conn.execute(
                sql,
                params,
            ).fetchone()

            if not row:
                return 0

            return int(
                row[0]
                or 0
            )

        total_videos = count(
            """
            SELECT COUNT(*)
            FROM source_videos
            """
        )

        total_sources = count(
            """
            SELECT COUNT(*)
            FROM sources
            WHERE enabled = 1
            """
        )

        completed_jobs = count(
            """
            SELECT COUNT(*)
            FROM jobs
            WHERE status = 'completed'
            """
        )

        failed_jobs = count(
            """
            SELECT COUNT(*)
            FROM jobs
            WHERE status = 'failed'
            """
        )

        processing_jobs = count(
            """
            SELECT COUNT(*)
            FROM jobs
            WHERE status IN (
                'queued',
                'processing'
            )
            """
        )

    except Exception:

        total_videos = 0
        total_sources = 0
        completed_jobs = 0
        failed_jobs = 0
        processing_jobs = 0

    finally:
        conn.close()

    files = (
        file_stats()
    )

    return {
        "total_videos":
            total_videos,

        "total_sources":
            total_sources,

        "downloaded":
            files[
                "downloaded"
            ],

        "outputs":
            files[
                "outputs"
            ],

        "completed_jobs":
            completed_jobs,

        "failed_jobs":
            failed_jobs,

        "processing_jobs":
            processing_jobs,

        "storage":
            human_size(
                files[
                    "storage_bytes"
                ]
            ),
    }


# =========================================================
# AUTH ROUTES
# =========================================================

@app.get(
    "/login",
    response_class=HTMLResponse,
)
def login_page(
    request: Request,
):

    current_user_id = (
        request.session.get(
            "user_id"
        )
    )

    if current_user_id:

        try:

            user = get_user_by_id(
                int(
                    current_user_id
                )
            )

        except Exception:

            user = None

        if (
            user
            and bool(
                user.get(
                    "enabled",
                    0,
                )
            )
        ):

            return RedirectResponse(
                url="/",
                status_code=303,
            )

    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={
            "error":
                "",
            "username":
                "",
        },
    )


@app.post(
    "/login",
    response_class=HTMLResponse,
)
def login_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
):

    username = (
        username.strip()
    )

    user = authenticate_user(
        username,
        password,
    )

    if not user:

        return templates.TemplateResponse(
            request=request,
            name="login.html",
            context={
                "error":
                    (
                        "Sai tài khoản "
                        "hoặc mật khẩu."
                    ),
                "username":
                    username,
            },
            status_code=401,
        )

    request.session.clear()

    request.session[
        "user_id"
    ] = int(
        user["id"]
    )

    return RedirectResponse(
        url="/",
        status_code=303,
    )


@app.get(
    "/logout",
)
def logout(
    request: Request,
):

    request.session.clear()

    return RedirectResponse(
        url="/login",
        status_code=303,
    )


# =========================================================
# WEB PAGES
# =========================================================

@app.get(
    "/",
    response_class=HTMLResponse,
)
def dashboard_page(
    request: Request,
):

    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context=
            template_context(
                request,
                title=
                    "Dashboard",
                active=
                    "dashboard",
                stats=
                    dashboard_data(),
                recent_jobs=
                    load_job_history(
                        8
                    ),
            ),
    )


@app.get(
    "/sources",
    response_class=HTMLResponse,
)
def sources_page(
    request: Request,
):

    return templates.TemplateResponse(
        request=request,
        name="sources.html",
        context=
            template_context(
                request,
                title=
                    "Nguồn video",
                active=
                    "sources",
            ),
    )


@app.get(
    "/downloads",
    response_class=HTMLResponse,
)
def downloads_page(
    request: Request,
):

    return templates.TemplateResponse(
        request=request,
        name="downloads.html",
        context=
            template_context(
                request,
                title=
                    "Video đã tải",
                active=
                    "downloads",
                videos=
                    scan_downloaded_library(),
            ),
    )


@app.get(
    "/outputs",
    response_class=HTMLResponse,
)
def outputs_page(
    request: Request,
):

    return templates.TemplateResponse(
        request=request,
        name="outputs.html",
        context=
            template_context(
                request,
                title=
                    "Thành phẩm",
                active=
                    "outputs",
                videos=
                    scan_outputs_library(),
            ),
    )


@app.get(
    "/history",
    response_class=HTMLResponse,
)
def history_page(
    request: Request,
):

    return templates.TemplateResponse(
        request=request,
        name="history.html",
        context=
            template_context(
                request,
                title=
                    "Lịch sử",
                active=
                    "history",
                jobs=
                    load_job_history(
                        200
                    ),
            ),
    )


@app.get(
    "/settings",
    response_class=HTMLResponse,
)
def settings_page(
    request: Request,
):

    return templates.TemplateResponse(
        request=request,
        name="settings.html",
        context=
            template_context(
                request,
                title=
                    "Cài đặt",
                active=
                    "settings",
                session_https=
                    SESSION_HTTPS_ONLY,
            ),
    )


@app.get(
    "/library/source/{video_id}",
)
def library_source(
    video_id: str,
):

    video_id = (
        validate_video_id(
            video_id
        )
    )

    path = (
        find_downloaded_video(
            DOWNLOAD_ROOT
            / video_id
        )
    )

    if not path:

        raise HTTPException(
            status_code=404,
            detail=
                "Không tìm thấy source video.",
        )

    return FileResponse(
        path=str(
            path
        ),
        media_type=
            "video/mp4",
        filename=
            f"{video_id}_source.mp4",
    )


@app.get(
    "/api/me",
)
def api_me(
    request: Request,
):

    user = dict(
        request.state.user
    )

    return {
        "id":
            user.get(
                "id"
            ),

        "username":
            user.get(
                "username"
            ),

        "role":
            user.get(
                "role"
            ),

        "enabled":
            bool(
                user.get(
                    "enabled",
                    0,
                )
            ),

        "last_login_at":
            user.get(
                "last_login_at"
            ),
    }


@app.get(
    "/api/jobs/active",
)
def api_active_jobs():

    jobs = (
        list_active_jobs(
            limit=20
        )
    )

    return {
        "count":
            len(
                jobs
            ),

        "jobs":
            jobs,
    }


# =========================================================
# COVER PROXY
# =========================================================

@app.get(
    "/api/cover",
)
def api_cover(
    url: str = Query(...),
):

    try:

        parsed = (
            urllib.parse
            .urlsplit(
                url
            )
        )

        if (
            parsed.scheme
            not in {
                "http",
                "https",
            }
        ):

            raise HTTPException(
                status_code=400,
                detail=(
                    "Cover URL "
                    "không hợp lệ."
                ),
            )

        hostname = (
            parsed.hostname
            or ""
        )

        if not cover_host_allowed(
            hostname
        ):

            raise HTTPException(
                status_code=403,
                detail=(
                    "Cover host "
                    "không được phép."
                ),
            )

        request = (
            urllib.request.Request(
                url,
                headers={
                    "User-Agent":
                        (
                            "Mozilla/5.0 "
                            "(Windows NT 10.0; "
                            "Win64; x64)"
                        ),

                    "Referer":
                        (
                            "https://www."
                            "bilibili.com/"
                        ),
                },
            )
        )

        with urllib.request.urlopen(
            request,
            timeout=12,
        ) as response:

            content_type = (
                response.headers.get(
                    "Content-Type",
                    "image/jpeg",
                )
            )

            if not content_type.startswith(
                "image/"
            ):

                raise HTTPException(
                    status_code=502,
                    detail=(
                        "Bilibili không "
                        "trả về ảnh."
                    ),
                )

            data = response.read(
                10 * 1024 * 1024
                + 1
            )

            if (
                len(data)
                > 10 * 1024 * 1024
            ):

                raise HTTPException(
                    status_code=413,
                    detail=(
                        "Ảnh quá lớn."
                    ),
                )

        return Response(
            content=data,
            media_type=content_type,
            headers={
                "Cache-Control":
                    (
                        "public, "
                        "max-age=3600"
                    )
            },
        )

    except HTTPException:
        raise

    except Exception as error:

        raise HTTPException(
            status_code=502,
            detail=(
                "Không tải được "
                "thumbnail: "
                + str(error)
            ),
        )


def fetch_platform_latest_meta(
    platform: str,
    url: str,
    limit: int,
):
    if platform == "bilibili":
        return bilibili_fetch_latest_meta(
            url,
            limit=limit,
        )

    if platform == "douyin":
        return douyin_fetch_latest_meta(
            url,
            limit=limit,
        )

    raise ValueError(
        "Platform chua ho tro: "
        + str(platform)
    )


def fetch_platform_page_meta(
    platform: str,
    url: str,
    *,
    page: int,
    limit: int,
):
    if platform == "bilibili":
        return bilibili_fetch_page_meta(
            url,
            page=page,
            limit=limit,
        )

    if platform == "douyin":
        return douyin_fetch_page_meta(
            url,
            page=page,
            limit=limit,
        )

    raise ValueError(
        "Platform chua ho tro: "
        + str(platform)
    )


def build_ytdlp_download_command(
    url: str,
    output_template: str,
    platform: str,
    *,
    use_browser_cookies: bool,
):
    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--continue",
        "--http-chunk-size",
        "2M",
        "--retries",
        "20",
        "--fragment-retries",
        "20",
        "--retry-sleep",
        "1",
        "--socket-timeout",
        "30",
    ]

    if use_browser_cookies:
        command.extend([
            "--cookies-from-browser",
            os.getenv(
                "REUP_COOKIE_BROWSER",
                "chrome",
            ),
        ])

    command.extend([
        "-f",
        "bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "-o",
        output_template,
        url,
    ])

    return command


def run_platform_download(
    url: str,
    output_template: str,
    platform: str,
):
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    # Douyin: bo qua yt-dlp extractor.
    # Lay media URL bang Playwright session roi tai bang ffmpeg.
    if platform == "douyin":

        output_path = (
            output_template
            .replace(
                "%(ext)s",
                "mp4",
            )
        )

        douyin_download_video(
            url,
            output_path,
        )

        return

    # Bilibili: tiep tuc dung yt-dlp.
    # Bilibili: khong cookie truoc, neu loi moi retry cookie.
    attempts = (
        [True, False]
        if platform == "douyin"
        else [False, True]
    )

    last_code = 1

    for use_cookies in attempts:
        command = build_ytdlp_download_command(
            url,
            output_template,
            platform,
            use_browser_cookies=use_cookies,
        )

        print(
            "\\n[DOWNLOAD]",
            platform,
            "| cookies:",
            use_cookies,
        )

        result = subprocess.run(
            command,
            cwd=str(
                PROJECT_ROOT
            ),
            env=env,
            check=False,
        )

        last_code = (
            result.returncode
        )

        if last_code == 0:
            return

        print(
            "[DOWNLOAD RETRY] "
            "yt-dlp exit code:",
            last_code,
        )

    raise RuntimeError(
        f"yt-dlp download that bai "
        f"({platform}), exit code "
        f"{last_code}."
    )


# =========================================================
# VIDEOS + CACHE
# =========================================================

@app.post(
    "/api/videos",
)
def api_videos(
    body: SourceRequest,
):

    url = body.url.strip()

    platform = (
        detect_platform(
            url
        )
    )

    if platform not in {
        "bilibili",
        "douyin",
    }:
        raise HTTPException(
            status_code=400,
            detail=(
                "Link chua duoc ho tro. "
                "Chi ho tro Bilibili va Douyin."
            ),
        )

    source = (
        find_source_by_profile(
            url
        )
    )

    cached = []
    default_channel = "2d_animation"

    if source:

        default_channel = (
            source[
                "channel_key"
            ]
        )

        cached = (
            load_cached_videos(
                source[
                    "id"
                ],
                limit=250,
            )
        )

        for video in cached:
            video[
                "channel_key"
            ] = (
                default_channel
            )

    live = []
    warning = None
    total = None
    has_more = True

    if (
        source
        and cached
        and not bool(
            body.refresh
        )
    ):

        enriched = [
            enrich_video(
                video,
                default_channel=
                    default_channel,
            )
            for video
            in cached
        ]

        return {
            "platform":
                platform,

            "videos":
                enriched,

            "live_count":
                0,

            "cached_count":
                len(
                    cached
                ),

            "warning":
                (
                    "Dang dung cache SQLite; "
                    f"bam dong bo de lam moi tu "
                    f"{platform}."
                ),

            "registered_source":
                True,

            "channel":
                default_channel,

            "total":
                None,

            "has_more":
                True,
        }

    try:

        live_meta = (
            fetch_platform_latest_meta(
                platform,
                url,
                limit=min(
                    max(
                        int(
                            body.limit
                        ),
                        1,
                    ),
                    10,
                ),
            )
        )

        live = (
            live_meta.get(
                "videos",
                [],
            )
        )

        total = (
            live_meta.get(
                "total"
            )
        )

        has_more = (
            live_meta.get(
                "has_more",
                True,
            )
        )

        if source:

            cache_live_videos(
                source[
                    "id"
                ],
                live,
            )

            cached = (
                load_cached_videos(
                    source[
                        "id"
                    ],
                    limit=250,
                )
            )

            for video in cached:
                video[
                    "channel_key"
                ] = (
                    default_channel
                )

    except BilibiliRateLimited:

        if cached:
            warning = (
                "Bilibili dang rate-limit; "
                "dang dung cache SQLite."
            )

        else:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Bilibili dang rate-limit "
                    "va chua co cache."
                ),
            )

    except DouyinUnavailable as error:

        if cached:
            warning = (
                "Douyin live fetch loi; "
                "dang dung cache SQLite: "
                + str(error)
            )

        else:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Douyin khong lay duoc "
                    "danh sach video: "
                    + str(error)
                ),
            )

    except Exception as error:

        if cached:
            warning = (
                "Live fetch loi; "
                "dang dung cache: "
                + str(error)
            )

        else:
            raise HTTPException(
                status_code=500,
                detail=(
                    type(error).__name__
                    + ": "
                    + str(error)
                ),
            )

    for video in live:
        video[
            "channel_key"
        ] = default_channel

        video.setdefault(
            "platform",
            platform,
        )

    merged = (
        merge_videos(
            live,
            cached,
        )
    )

    enriched = [
        enrich_video(
            video,
            default_channel=
                default_channel,
        )
        for video in merged
    ]

    return {
        "platform":
            platform,

        "videos":
            enriched,

        "live_count":
            len(
                live
            ),

        "cached_count":
            len(
                cached
            ),

        "warning":
            warning,

        "registered_source":
            bool(
                source
            ),

        "channel":
            default_channel,

        "total":
            total,

        "has_more":
            (
                bool(
                    has_more
                )
                or (
                    total is not None
                    and len(cached)
                        < total
                )
            ),
    }


# =========================================================
# LAZY REMOTE PAGINATION
# =========================================================

@app.post(
    "/api/videos/page",
)
def api_videos_page(
    body: PageRequest,
):

    url = body.url.strip()

    platform = (
        detect_platform(
            url
        )
    )

    if platform not in {
        "bilibili",
        "douyin",
    }:
        raise HTTPException(
            status_code=400,
            detail=(
                "Pagination chi ho tro "
                "Bilibili va Douyin."
            ),
        )

    page = max(
        1,
        int(
            body.page
        ),
    )

    page_size = max(
        1,
        min(
            int(
                body.page_size
            ),
            10,
        ),
    )

    source = (
        find_source_by_profile(
            url
        )
    )

    default_channel = (
        source[
            "channel_key"
        ]
        if source
        else "2d_animation"
    )

    start = (
        (page - 1)
        * page_size
    )

    if source:

        cached = (
            load_cached_videos(
                source[
                    "id"
                ],
                limit=max(
                    250,
                    page
                    * page_size
                    + page_size,
                ),
            )
        )

        if (
            len(cached)
            > start
        ):

            page_items = (
                cached[
                    start:
                    start
                    + page_size
                ]
            )

            if (
                len(page_items)
                == page_size
            ):

                for video in page_items:
                    video[
                        "channel_key"
                    ] = (
                        default_channel
                    )

                enriched = [
                    enrich_video(
                        video,
                        default_channel=
                            default_channel,
                    )
                    for video
                    in page_items
                ]

                return {
                    "page":
                        page,

                    "page_size":
                        page_size,

                    "videos":
                        enriched,

                    "from_cache":
                        True,

                    "total":
                        None,

                    "has_more":
                        True,
                }

    try:

        live_meta = (
            fetch_platform_page_meta(
                platform,
                url,
                page=page,
                limit=page_size,
            )
        )

        live = (
            live_meta.get(
                "videos",
                [],
            )
        )

        total = (
            live_meta.get(
                "total"
            )
        )

        has_more = (
            live_meta.get(
                "has_more",
                len(live)
                == page_size,
            )
        )

    except BilibiliRateLimited:

        raise HTTPException(
            status_code=429,
            detail=(
                "Bilibili dang rate-limit. "
                "Thu lai sau."
            ),
        )

    except DouyinUnavailable as error:

        raise HTTPException(
            status_code=503,
            detail=(
                "Douyin fetch loi: "
                + str(error)
            ),
        )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=(
                type(error).__name__
                + ": "
                + str(error)
            ),
        )

    if (
        source
        and live
    ):

        cache_live_videos(
            source[
                "id"
            ],
            live,
        )

    for video in live:

        video[
            "channel_key"
        ] = (
            default_channel
        )

        video.setdefault(
            "platform",
            platform,
        )

    enriched = [
        enrich_video(
            video,
            default_channel=
                default_channel,
        )
        for video
        in live
    ]

    return {
        "page":
            page,

        "page_size":
            page_size,

        "videos":
            enriched,

        "from_cache":
            False,

        "total":
            total,

        "has_more":
            bool(
                has_more
            ),
    }


# =========================================================
# DOWNLOAD ORIGINAL
# =========================================================

@app.post(
    "/api/download",
)
def api_download(
    body: DownloadRequest,
):

    video_id = (
        validate_video_id(
            body.video_id
        )
    )

    platform = (
        detect_platform(
            body.url
        )
    )

    if platform not in {
        "bilibili",
        "douyin",
    }:
        raise HTTPException(
            status_code=400,
            detail=(
                "Download chi ho tro "
                "Bilibili va Douyin."
            ),
        )

    folder = (
        DOWNLOAD_ROOT
        / video_id
    )

    folder.mkdir(
        parents=True,
        exist_ok=True,
    )

    existing = (
        find_downloaded_video(
            folder
        )
    )

    if existing:

        register_downloaded_source(
            video_id,
            existing,
        )

        return FileResponse(
            path=str(
                existing
            ),
            media_type=
                "video/mp4",
            filename=
                (
                    f"{video_id}"
                    "_source.mp4"
                ),
        )

    output_template = str(
        folder
        / "source.%(ext)s"
    )

    try:

        run_platform_download(
            body.url,
            output_template,
            platform,
        )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=(
                type(error).__name__
                + ": "
                + str(error)
            ),
        )

    video_path = (
        find_downloaded_video(
            folder
        )
    )

    if not video_path:

        raise HTTPException(
            status_code=500,
            detail=(
                "Download xong "
                "nhung khong tim thay "
                "source video."
            ),
        )

    register_downloaded_source(
        video_id,
        video_path,
    )

    return FileResponse(
        path=str(
            video_path
        ),
        media_type=
            "video/mp4",
        filename=
            (
                f"{video_id}"
                "_source.mp4"
            ),
    )


# =========================================================
# PROCESS
# =========================================================

@app.post(
    "/api/process",
)
def api_process(
    body: ProcessRequest,
    request: Request,
):

    if not PIPELINE_FILE.exists():

        raise HTTPException(
            status_code=500,
            detail=(
                "Không tìm thấy "
                "app/pipeline.py"
            ),
        )

    video_id = (
        validate_video_id(
            body.video_id
        )
    )

    channel = (
        validate_channel(
            body.channel
        )
    )

    mode = (
        body.mode
    )

    with PROCESS_LOCK:

        for state in (
            PROCESS_STATE.values()
        ):

            if (
                state.get(
                    "video_id"
                )
                == video_id
                and state.get(
                    "status"
                )
                in {
                    "queued",
                    "processing",
                }
            ):

                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Video này đang "
                        "được xử lý."
                    ),
                )

    key = (
        process_key(
            channel,
            video_id,
            mode,
        )
    )

    source_path = (
        local_source_for_process(
            channel,
            video_id,
        )
    )

    db_job = create_job(
        platform_video_id=
            video_id,
        channel_key=
            channel,
        mode=
            mode,
        created_by=
            request.state.user[
                "id"
            ],
        source_path=
            (
                source_path
                if (
                    source_path
                    and file_ok(
                        source_path
                    )
                )
                else None
            ),
    )

    db_job_id = (
        db_job[
            "id"
        ]
    )

    update_source_video_state(
        platform_video_id=
            video_id,
        status=
            "queued",
        job_id=
            db_job_id,
    )

    with PROCESS_LOCK:

        PROCESS_STATE[
            key
        ] = {
            "status":
                "queued",

            "stage":
                "queued",

            "percent":
                0,

            "message":
                "Đã vào hàng đợi.",

            "mode":
                mode,

            "channel":
                channel,

            "video_id":
                video_id,

            "db_job_id":
                db_job_id,
        }

    thread = (
        threading.Thread(
            target=
                pipeline_worker,

            kwargs={
                "video_url":
                    body.url,

                "video_id":
                    video_id,

                "channel":
                    channel,

                "mode":
                    mode,

                "db_job_id":
                    db_job_id,
            },

            daemon=True,
        )
    )

    thread.start()

    return {
        "ok":
            True,

        "status":
            "queued",

        "video_id":
            video_id,

        "channel":
            channel,

        "mode":
            mode,

        "job_id":
            db_job_id,

        "uses_downloaded_source":
            (
                local_source_for_process(
                    channel,
                    video_id,
                )
                is not None
            ),
    }


@app.get(
    "/api/process/{video_id}",
)
def api_process_status(
    video_id: str,
    channel: str =
        "2d_animation",
    mode: str =
        "subtitle",
):

    video_id = (
        validate_video_id(
            video_id
        )
    )

    channel = (
        validate_channel(
            channel
        )
    )

    if (
        mode
        not in {
            "subtitle",
            "voiceover",
        }
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "Mode không hợp lệ."
            ),
        )

    key = (
        process_key(
            channel,
            video_id,
            mode,
        )
    )

    job_dir = (
        job_dir_for(
            channel,
            video_id,
        )
    )

    progress = (
        read_json_file(
            job_dir
            / "progress.json"
        )
    )

    with PROCESS_LOCK:

        memory = dict(
            PROCESS_STATE.get(
                key,
                {},
            )
        )

    if progress:

        status = (
            progress.get(
                "status",
                memory.get(
                    "status",
                    "processing",
                ),
            )
        )

        stage = (
            progress.get(
                "stage",
                memory.get(
                    "stage",
                    "processing",
                ),
            )
        )

        percent = (
            progress.get(
                "percent",
                memory.get(
                    "percent",
                    0,
                ),
            )
        )

        message = (
            progress.get(
                "message",
                memory.get(
                    "message",
                    "",
                ),
            )
        )

    else:

        status = (
            memory.get(
                "status",
                "idle",
            )
        )

        stage = (
            memory.get(
                "stage",
                "idle",
            )
        )

        percent = (
            memory.get(
                "percent",
                0,
            )
        )

        message = (
            memory.get(
                "message",
                (
                    "Chưa có "
                    "tiến trình."
                ),
            )
        )

    if (
        memory.get(
            "status"
        )
        in {
            "completed",
            "failed",
        }
    ):

        status = (
            memory[
                "status"
            ]
        )

        stage = (
            memory.get(
                "stage",
                stage,
            )
        )

        percent = (
            memory.get(
                "percent",
                percent,
            )
        )

        message = (
            memory.get(
                "message",
                message,
            )
        )

    log_path = (
        job_dir
        / f"web_{mode}.log"
    )

    result_file = (
        find_result_file(
            channel,
            video_id,
            mode,
        )
    )

    return {
        "video_id":
            video_id,

        "channel":
            channel,

        "mode":
            mode,

        "status":
            status,

        "stage":
            stage,

        "percent":
            percent,

        "message":
            message,

        "result_ready":
            (
                result_file
                is not None
            ),

        "log_tail":
            read_log_tail(
                log_path,
                line_count=10,
            ),
    }


# =========================================================
# RESULT DOWNLOAD + STREAM
# =========================================================

@app.get(
    "/api/result/{video_id}",
)
def api_result(
    video_id: str,
    channel: str =
        "2d_animation",
    mode: str =
        "subtitle",
):

    video_id = (
        validate_video_id(
            video_id
        )
    )

    channel = (
        validate_channel(
            channel
        )
    )

    if (
        mode
        not in {
            "subtitle",
            "voiceover",
        }
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "Mode không hợp lệ."
            ),
        )

    result_file = (
        find_result_file(
            channel,
            video_id,
            mode,
        )
    )

    if not result_file:

        raise HTTPException(
            status_code=404,
            detail=(
                "Chưa có video "
                "kết quả."
            ),
        )

    filename = (
        f"{video_id}_vietsub.mp4"
        if mode == "subtitle"
        else (
            f"{video_id}"
            "_vietsub_voice.mp4"
        )
    )

    return FileResponse(
        path=str(
            result_file
        ),
        media_type=
            "video/mp4",
        filename=
            filename,
    )


@app.get(
    "/api/stream/{video_id}",
)
def api_stream(
    video_id: str,
    channel: str =
        "2d_animation",
    mode: str =
        "subtitle",
):

    video_id = (
        validate_video_id(
            video_id
        )
    )

    channel = (
        validate_channel(
            channel
        )
    )

    if (
        mode
        not in {
            "subtitle",
            "voiceover",
        }
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "Mode không hợp lệ."
            ),
        )

    result_file = (
        find_result_file(
            channel,
            video_id,
            mode,
        )
    )

    if not result_file:

        raise HTTPException(
            status_code=404,
            detail=(
                "Chưa có video "
                "kết quả."
            ),
        )

    return FileResponse(
        path=str(
            result_file
        ),
        media_type=
            "video/mp4",
        headers={
            "Content-Disposition":
                "inline"
        },
    )


# =========================================================
# V12.2 STARTUP RECOVERY + FILE INDEX
# =========================================================

@app.on_event(
    "startup"
)
def v12_2_startup():

    try:
        interrupted = (
            recover_interrupted_jobs()
        )

        if interrupted:
            print(
                "[V12.2] recovered interrupted jobs:",
                interrupted,
            )

    except Exception as error:
        print(
            "[V12.2] recover warning:",
            error,
        )

    try:
        sync_existing_files_to_db()

        print(
            "[V12.2] video_files sync: OK"
        )

    except Exception as error:
        print(
            "[V12.2] file sync warning:",
            error,
        )


# =========================================================
# RUN
# =========================================================

if __name__ == "__main__":

    import uvicorn

    print()
    print(
        "=================================="
    )
    print(
        "REUP AI DASHBOARD V12.2"
    )
    print(
        "=================================="
    )
    print(
        "http://127.0.0.1:8000"
    )
    print(
        "=================================="
    )
    print()

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info",
    )
