import html
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path
from datetime import datetime
from typing import Any, Literal, Optional

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
from runtime_paths import (
    get_channels_dir,
    get_config_dir,
    get_data_dir,
    get_downloads_dir,
    get_output_dir,
    get_runtime_root,
)


def _build_child_environment() -> dict[str, str]:
    """Load current local settings for every packaged worker process."""
    from dotenv import dotenv_values

    env = os.environ.copy()
    config_paths = [get_config_dir() / "engine.env"]
    local_app_data = env.get("LOCALAPPDATA", "").strip()
    if local_app_data:
        config_paths.append(Path(local_app_data) / "ReupAI" / "config" / "engine.env")

    for config_path in config_paths:
        if not config_path.is_file():
            continue
        env["REUP_ENGINE_CONFIG_PATH"] = str(config_path.resolve())
        for key, value in dotenv_values(config_path).items():
            if value is not None:
                env[key] = value
        if (env.get("GEMINI_API_KEY") or "").strip():
            break
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


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

APP_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = APP_DIR.parent

if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

DOWNLOAD_ROOT = get_downloads_dir() / "demo"
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
    init_db,
    save_video,
)

from services.library_db import (
    detect_series,
)

from services.job_db import (
    ActiveJobExists,
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
    create_user,
    ensure_default_admin,
    get_user_by_id,
    get_user_by_email,
    get_user_by_username,
    issue_email_code,
    send_verification_email,
    verify_email_code,
)

from services.download_config import (
    max_parallel_downloads,
    max_parallel_pipelines,
    ytdlp_performance_args,
)
from services.engine_runtime import pipeline_command, python_module_command

init_db()
if os.getenv("REUP_LOCAL_ENGINE", "").strip() != "1":
    ensure_default_admin()


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
        get_data_dir()
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
    version="0.13.3",
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
    "/register",
    "/verify-email",
    "/verify-email/resend",
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
SOURCE_SYNC_LOCK = threading.Lock()
SOURCE_SYNC_CACHE_TTL_SECONDS = 60
DOWNLOAD_SLOTS = threading.BoundedSemaphore(
    max_parallel_downloads()
)
PIPELINE_SLOTS = threading.BoundedSemaphore(
    max_parallel_pipelines()
)


# =========================================================
# REQUEST MODELS
# =========================================================

class SourceRequest(BaseModel):
    url: str
    limit: int = 10
    refresh: bool = False
    known_videos: list[dict[str, Any]] = []


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
    preview_seconds: Optional[float] = None
    original_volume: float = 0.15
    voice_volume: float = 1.0
    voice: Optional[str] = None
    tts_speed: float = 1.10
    subtitle_font_size: Optional[int] = None
    blur_region: Optional[dict[str, float]] = None
    blur_preset: Optional[str] = None
    blur_intervals: list[dict[str, float]] = []
    custom_blur_region: Optional[dict[str, float]] = None
    auto_brand_blur: bool = False
    logo_mode: str = "default"
    logo_text: Optional[str] = None
    logo_data: Optional[str] = None
    logo_filename: Optional[str] = None
    music_url: Optional[str] = None
    music_data: Optional[str] = None
    music_filename: Optional[str] = None
    music_volume: float = 0.12
    logo_path: Optional[str] = None
    aspect_ratio: Optional[str] = None
    logo_size: Optional[float] = None
    logo_x: Optional[float] = None
    logo_y: Optional[float] = None


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
        source = find_valid_downloaded_video(folder)

        if source:
            return source

    return None


def job_dir_for(
    channel: str,
    video_id: str,
) -> Path:

    return (
        get_channels_dir()
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

    if file_ok(preferred):
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

        if file_ok(path):
            return path

    return None


def find_valid_downloaded_video(folder: Path) -> Path | None:
    candidate = find_downloaded_video(folder)
    return candidate if candidate and media_file_ok(candidate) else None


def media_file_ok(path: Path) -> bool:
    """Validate a downloaded source once and cache the ffprobe result."""
    if not file_ok(path):
        return False
    try:
        stat = path.stat()
        marker = path.with_name(f".{path.name}.probe.json")
        cached = read_json_file(marker)
        if (
            isinstance(cached, dict)
            and cached.get("size") == stat.st_size
            and cached.get("mtime_ns") == stat.st_mtime_ns
        ):
            return bool(cached.get("valid"))

        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=codec_type:format=duration",
                "-of", "json",
                str(path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=30,
        )
        payload = json.loads(result.stdout or "{}") if result.returncode == 0 else {}
        streams = payload.get("streams") or []
        duration = float((payload.get("format") or {}).get("duration") or 0)
        valid = duration > 0 and any(item.get("codec_type") == "video" for item in streams)
        temporary = marker.with_suffix(marker.suffix + ".tmp")
        temporary.write_text(
            json.dumps(
                {
                    "size": stat.st_size,
                    "mtime_ns": stat.st_mtime_ns,
                    "duration": duration,
                    "valid": valid,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        temporary.replace(marker)
        return valid
    except (OSError, ValueError, TypeError, subprocess.SubprocessError, json.JSONDecodeError):
        return False


def finalize_staged_download(folder: Path) -> Path:
    candidates = [
        path
        for path in folder.glob("source.pending.*")
        if path.is_file() and path.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}
    ]
    for candidate in candidates:
        if not media_file_ok(candidate):
            continue
        destination = folder / f"source{candidate.suffix.lower()}"
        candidate.replace(destination)
        probe_marker = candidate.with_name(f".{candidate.name}.probe.json")
        probe_marker.unlink(missing_ok=True)
        if not media_file_ok(destination):
            destination.unlink(missing_ok=True)
            break
        return destination
    raise RuntimeError("File tải về không có video stream hợp lệ hoặc bị hỏng.")


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
    offset: int = 0,
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
            OFFSET ?
            """,
            (
                source_id,
                max(1, int(limit)),
                max(0, int(offset)),
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

            "duration_seconds": row["duration_seconds"],

            "video_width": row["video_width"],

            "video_height": row["video_height"],

            "db_status":
                row["status"]
                or "new",

            "db_job_id":
                row["job_id"],
        }
        for row in rows
    ]


def count_cached_videos(source_id: int) -> int:

    conn = get_connection()

    try:
        row = conn.execute(
            """
            SELECT COUNT(*) AS total
            FROM source_videos
            WHERE source_id = ?
            """,
            (source_id,),
        ).fetchone()
    finally:
        conn.close()

    return int(row["total"] if row else 0)


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

                duration_seconds=
                    video.get(
                        "duration_seconds"
                    ),

                video_width=
                    video.get(
                        "video_width"
                    ),

                video_height=
                    video.get(
                        "video_height"
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
                    "stopping",
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

    # Expose series metadata for fresh and cached source results alike.
    result.update(
        detect_series(
            result.get(
                "title"
            )
        )
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
        get_channels_dir()
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
# PROCESS CONTROL
# =========================================================

def terminate_process_tree(
    process,
):
    if process is None:
        return

    try:
        if process.poll() is not None:
            return
    except Exception:
        return

    try:

        if os.name == "nt":

            subprocess.run(
                [
                    "taskkill",
                    "/PID",
                    str(
                        process.pid
                    ),
                    "/T",
                    "/F",
                ],
                stdout=
                    subprocess.DEVNULL,
                stderr=
                    subprocess.DEVNULL,
                check=False,
            )

        else:

            try:
                import signal

                os.killpg(
                    os.getpgid(
                        process.pid
                    ),
                    signal.SIGTERM,
                )

            except Exception:
                process.terminate()

    except Exception:

        try:
            process.terminate()

        except Exception:
            pass


def process_cancel_requested(
    key,
):
    with PROCESS_LOCK:

        state = (
            PROCESS_STATE.get(
                key,
                {}
            )
        )

        return bool(
            state.get(
                "cancel_requested",
                False,
            )
        )


def mark_process_cancelled(
    *,
    key,
    video_id,
    channel,
    mode,
    db_job_id,
    log_path,
    percent=0,
):

    message = (
        "Đã dừng xử lý theo yêu cầu."
    )

    try:
        update_job_progress(
            db_job_id,
            status=
                "cancelled",
            stage=
                "cancelled",
            progress=
                percent,
        )
    except Exception:
        try:
            fail_job(
                db_job_id,
                message=
                    message,
                stage=
                    "cancelled",
            )
        except Exception:
            pass

    try:
        update_source_video_state(
            platform_video_id=
                video_id,
            status=
                "cancelled",
            job_id=
                db_job_id,
        )
    except Exception:
        pass

    with PROCESS_LOCK:

        PROCESS_STATE[
            key
        ] = {
            "status":
                "cancelled",

            "stage":
                "cancelled",

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

            "cancel_requested":
                True,
        }


# =========================================================
# BACKGROUND PIPELINE
# =========================================================

def _pipeline_worker_once(
    *,
    video_url: str,
    video_id: str,
    channel: str,
    mode: str,
    db_job_id: int,
    settings: Optional[dict[str, Any]] = None,
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

    command = pipeline_command(
        video_url,
        "--channel",
        channel,
        "--mode",
        mode,
    )

    # A job must always render from the exact settings submitted for that job.
    # A per-job file prevents a later click/preset from replacing the config
    # while the current worker is queued or already running.
    config_path = job_dir / f"process_config.{db_job_id}.json"
    if settings:
        temporary_config = config_path.with_suffix(config_path.suffix + ".tmp")
        temporary_config.write_text(
            json.dumps(settings, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary_config.replace(config_path)
        command.extend(["--config", str(config_path)])

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

            env = _build_child_environment()

            popen_extra = {}

            if os.name == "nt":
                popen_extra[
                    "creationflags"
                ] = (
                    subprocess
                    .CREATE_NEW_PROCESS_GROUP
                )
            else:
                popen_extra[
                    "start_new_session"
                ] = True

            process = subprocess.Popen(
                command,
                cwd=str(
                    PROJECT_ROOT
                ),
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=
                    subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                **popen_extra,
            )

            with PROCESS_LOCK:

                state = (
                    PROCESS_STATE
                    .setdefault(
                        key,
                        {},
                    )
                )

                state[
                    "process"
                ] = process

                state[
                    "pid"
                ] = process.pid

                cancel_now = bool(
                    state.get(
                        "cancel_requested",
                        False,
                    )
                )

            if cancel_now:
                terminate_process_tree(
                    process
                )

            last_signature = None

            while True:

                if (
                    process_cancel_requested(
                        key
                    )
                    and process.poll()
                    is None
                ):
                    terminate_process_tree(
                        process
                    )

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

                            if not state.get(
                                "cancel_requested",
                                False,
                            ):

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

        if process_cancel_requested(
            key
        ):

            cancel_percent = (
                progress.get(
                    "percent",
                    0,
                )
                if progress
                else 0
            )

            mark_process_cancelled(
                key=
                    key,
                video_id=
                    video_id,
                channel=
                    channel,
                mode=
                    mode,
                db_job_id=
                    db_job_id,
                log_path=
                    log_path,
                percent=
                    cancel_percent,
            )

            return

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
                            progress.get("message")
                            or "Xử lý AI hoàn tất."
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

        if process_cancel_requested(
            key
        ):

            mark_process_cancelled(
                key=
                    key,
                video_id=
                    video_id,
                channel=
                    channel,
                mode=
                    mode,
                db_job_id=
                    db_job_id,
                log_path=
                    log_path,
                percent=
                    0,
            )

            return

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

def pipeline_worker(
    *,
    video_url: str,
    video_id: str,
    channel: str,
    mode: str,
    db_job_id: int,
    settings: Optional[dict[str, Any]] = None,
):
    key = process_key(channel, video_id, mode)
    log_path = job_dir_for(channel, video_id) / f"web_{mode}.log"

    # Keep the expensive model/FFmpeg subprocess count bounded. Requests stay
    # queued in the existing UI state and can still be cancelled while waiting.
    while True:
        if process_cancel_requested(key):
            mark_process_cancelled(
                key=key,
                video_id=video_id,
                channel=channel,
                mode=mode,
                db_job_id=db_job_id,
                log_path=log_path,
            )
            return

        if PIPELINE_SLOTS.acquire(timeout=0.5):
            break

    try:
        if process_cancel_requested(key):
            mark_process_cancelled(
                key=key,
                video_id=video_id,
                channel=channel,
                mode=mode,
                db_job_id=db_job_id,
                log_path=log_path,
            )
            return

        _pipeline_worker_once(
            video_url=video_url,
            video_id=video_id,
            channel=channel,
            mode=mode,
            db_job_id=db_job_id,
            settings=settings,
        )
    finally:
        PIPELINE_SLOTS.release()


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

    channels_dir = get_channels_dir()

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

                    # Local Engine converts this absolute runtime path into a
                    # safe runtime-relative file_path before returning it to
                    # the browser. The legacy FastAPI UI ignores this field.
                    "path":
                        str(path),
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

def _auth_template(request: Request, name: str, **context):
    return templates.TemplateResponse(request=request, name=name, context=context)


def _valid_registration(username: str, email: str, password: str):
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,32}", username):
        return "Tên đăng nhập dài 3-32 ký tự, chỉ dùng chữ, số, ., _, -"
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return "Email không hợp lệ."
    if len(password) < 8:
        return "Mật khẩu phải có ít nhất 8 ký tự."
    return ""


@app.get("/register", response_class=HTMLResponse)
def register_page(request: Request):
    if request.session.get("user_id"):
        return RedirectResponse(url="/", status_code=303)
    return _auth_template(request, "register.html", error="", username="", email="")


@app.post("/register", response_class=HTMLResponse)
def register_submit(request: Request, username: str = Form(...), email: str = Form(...), password: str = Form(...), password_confirm: str = Form(...)):
    username, email = username.strip(), email.strip().lower()
    error = _valid_registration(username, email, password)
    if not error and password != password_confirm:
        error = "Mật khẩu xác nhận không khớp."
    if not error and (get_user_by_username(username) or get_user_by_email(email)):
        error = "Tên đăng nhập hoặc email đã được sử dụng."
    if error:
        return _auth_template(request, "register.html", error=error, username=username, email=email)
    try:
        user = create_user(username, email, password)
        code = issue_email_code(user["id"])
        delivery = send_verification_email(email, code)
    except Exception as exc:
        return _auth_template(request, "register.html", error=f"Không thể tạo tài khoản: {exc}", username=username, email=email)
    request.session["pending_verification_user_id"] = int(user["id"])
    request.session["pending_verification_email"] = email
    notice = "Mã đã được gửi qua email." if delivery == "smtp" else "SMTP chưa cấu hình; mã xác minh đã được ghi trong cửa sổ chạy web."
    return _auth_template(request, "verify_email.html", error="", email=email, notice=notice)


@app.get("/verify-email", response_class=HTMLResponse)
def verify_email_page(request: Request):
    email = request.session.get("pending_verification_email", "")
    if not email:
        return RedirectResponse(url="/register", status_code=303)
    return _auth_template(request, "verify_email.html", error="", email=email, notice="")


@app.post("/verify-email", response_class=HTMLResponse)
def verify_email_submit(request: Request, code: str = Form(...)):
    user_id = request.session.get("pending_verification_user_id")
    email = request.session.get("pending_verification_email", "")
    if not user_id:
        return RedirectResponse(url="/register", status_code=303)
    if not verify_email_code(int(user_id), code):
        return _auth_template(request, "verify_email.html", error="Mã không đúng, đã hết hạn hoặc nhập quá số lần.", email=email, notice="")
    request.session.pop("pending_verification_user_id", None)
    request.session.pop("pending_verification_email", None)
    request.session["user_id"] = int(user_id)
    return RedirectResponse(url="/", status_code=303)


@app.post("/verify-email/resend", response_class=HTMLResponse)
def resend_verification_email(request: Request):
    user_id = request.session.get("pending_verification_user_id")
    email = request.session.get("pending_verification_email", "")
    if not user_id or not email:
        return RedirectResponse(url="/register", status_code=303)
    code = issue_email_code(int(user_id))
    try:
        delivery = send_verification_email(email, code)
        notice = "Mã mới đã được gửi." if delivery == "smtp" else "Mã mới đã được ghi trong cửa sổ chạy web."
        error = ""
    except Exception as exc:
        notice, error = "", f"Không thể gửi lại mã: {exc}"
    return _auth_template(request, "verify_email.html", error=error, email=email, notice=notice)


def require_admin(request: Request):
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Chỉ admin mới được phép.")
    return user


@app.get("/admin/users", response_class=HTMLResponse)
def admin_users_page(request: Request):
    user = require_admin(request)
    conn = get_connection()
    try:
        users = [dict(row) for row in conn.execute("SELECT id, username, email, role, enabled, email_verified, created_at, last_login_at FROM users ORDER BY id").fetchall()]
    finally:
        conn.close()
    return _auth_template(request, "admin_users.html", users=users, error="", user=user)


@app.post("/admin/users/{user_id}/toggle")
def admin_toggle_user(request: Request, user_id: int):
    require_admin(request)
    if int(user_id) == int(request.state.user["id"]):
        raise HTTPException(status_code=400, detail="Không thể tự khóa tài khoản admin đang đăng nhập.")
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET enabled = CASE enabled WHEN 1 THEN 0 ELSE 1 END WHERE id = ?", (int(user_id),))
        conn.commit()
    finally:
        conn.close()
    return RedirectResponse(url="/admin/users", status_code=303)

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
    "/api/preview/source/{video_id}",
)
def preview_source_video(
    video_id: str,
):
    """Serve a downloaded source inline for lightweight library previews."""

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
            detail="Không tìm thấy source video.",
        )

    return FileResponse(
        path=str(path),
        media_type="video/mp4",
        headers={
            "Content-Disposition": "inline",
        },
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
def api_active_jobs(request: Request):

    user = request.state.user
    owner_id = None if user.get("role") == "admin" else user.get("id")

    jobs = (
        list_active_jobs(
            limit=20,
            created_by=owner_id,
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
    command = python_module_command(
        "yt_dlp",
        "--continue",
        "--retries",
        "20",
        "--fragment-retries",
        "20",
        "--retry-sleep",
        "1",
        "--socket-timeout",
        "30",
    )

    command.extend(ytdlp_performance_args())

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
    env = _build_child_environment()

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

def load_source_sync_cache(profile_url: str):

    profile_key = normalize_profile_url(profile_url)
    conn = get_connection()

    try:
        row = conn.execute(
            """
            SELECT platform, profile_url, videos_json, total, has_more, checked_at
            FROM source_sync_cache
            WHERE profile_key = ?
            LIMIT 1
            """,
            (profile_key,),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return None

    try:
        videos = json.loads(row["videos_json"] or "[]")
    except (TypeError, ValueError):
        videos = []

    return {
        "platform": row["platform"],
        "profile_url": row["profile_url"],
        "videos": [video for video in videos if isinstance(video, dict)],
        "total": row["total"],
        "has_more": bool(row["has_more"]),
        "checked_at": float(row["checked_at"] or 0),
    }


def save_source_sync_cache(
    profile_url: str,
    platform: str,
    videos,
    *,
    total=None,
    has_more=True,
    checked_at=None,
):

    profile_key = normalize_profile_url(profile_url)
    payload = json.dumps(
        list(videos or [])[:500],
        ensure_ascii=False,
    )
    conn = get_connection()

    try:
        conn.execute(
            """
            INSERT INTO source_sync_cache (
                profile_key, platform, profile_url, videos_json,
                total, has_more, checked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(profile_key) DO UPDATE SET
                platform = excluded.platform,
                profile_url = excluded.profile_url,
                videos_json = excluded.videos_json,
                total = excluded.total,
                has_more = excluded.has_more,
                checked_at = excluded.checked_at
            """,
            (
                profile_key,
                platform,
                profile_url,
                payload,
                total,
                int(bool(has_more)),
                float(checked_at if checked_at is not None else time.time()),
            ),
        )
        conn.commit()
    finally:
        conn.close()


@app.post(
    "/api/videos",
)
def api_videos(
    body: SourceRequest,
):

    url = body.url.strip()
    limit = max(1, min(int(body.limit), 10))
    platform = detect_platform(url)

    if platform not in {"bilibili", "douyin"}:
        raise HTTPException(
            status_code=400,
            detail="Link chưa được hỗ trợ. Chỉ hỗ trợ Bilibili và Douyin.",
        )

    source = find_source_by_profile(url)
    default_channel = source["channel_key"] if source else "2d_animation"

    def read_cache_state():
        sync_cache = load_source_sync_cache(url)
        client_videos = []
        for item in body.known_videos[:500]:
            if not isinstance(item, dict):
                continue
            video_id = str(item.get("video_id") or "").strip()
            if not video_id:
                continue
            video = dict(item)
            video["video_id"] = video_id
            video.setdefault("platform", platform)
            video.setdefault("channel_key", default_channel)
            client_videos.append(video)

        source_videos = (
            load_cached_videos(source["id"], limit=500)
            if source
            else []
        )
        cached_videos = merge_videos(
            (sync_cache or {}).get("videos", []) + client_videos,
            source_videos,
        )
        for video in cached_videos:
            video["channel_key"] = default_channel
            video.setdefault("platform", platform)

        source_total = (
            count_cached_videos(source["id"])
            if source
            else 0
        )
        total = (
            (sync_cache or {}).get("total")
            if (sync_cache or {}).get("total") is not None
            else source_total or None
        )
        has_more = bool((sync_cache or {}).get("has_more", False))
        if total is not None and len(cached_videos) < total:
            has_more = True

        return sync_cache, cached_videos, total, has_more

    def cache_response(
        sync_cache,
        cached_videos,
        total,
        has_more,
        message,
    ):
        page_videos = cached_videos[:limit]
        enriched = [
            enrich_video(video, default_channel=default_channel)
            for video in page_videos
        ]
        return {
            "platform": platform,
            "videos": enriched,
            "live_count": 0,
            "cached_count": len(cached_videos),
            "warning": message,
            "registered_source": bool(source),
            "channel": default_channel,
            "total": total,
            "has_more": has_more,
            "checked_remote": False,
            "new_count": 0,
        }

    def persist_cache_if_needed(sync_cache, cached_videos, total, has_more):
        if cached_videos and not (sync_cache or {}).get("videos"):
            save_source_sync_cache(
                url,
                platform,
                cached_videos,
                total=total,
                has_more=has_more,
                checked_at=(sync_cache or {}).get("checked_at") or time.time(),
            )

    # Serialize syncs so simultaneous clicks share the result of one network fetch.
    with SOURCE_SYNC_LOCK:
        sync_cache, cached, cached_total, cached_has_more = read_cache_state()
        now = time.time()

        if cached and not body.refresh:
            persist_cache_if_needed(
                sync_cache,
                cached,
                cached_total,
                cached_has_more,
            )
            return cache_response(
                sync_cache,
                cached,
                cached_total,
                cached_has_more,
                "Đang hiển thị dữ liệu đã lưu. Bấm Đồng bộ để kiểm tra video mới.",
            )

        if (
            sync_cache
            and now - sync_cache["checked_at"] < SOURCE_SYNC_CACHE_TTL_SECONDS
        ):
            persist_cache_if_needed(
                sync_cache,
                cached,
                cached_total,
                cached_has_more,
            )
            return cache_response(
                sync_cache,
                cached,
                cached_total,
                cached_has_more,
                (
                    "Nguồn vừa được kiểm tra; đang dùng dữ liệu đã lưu để tránh gọi Bilibili liên tục."
                    if cached
                    else "Bilibili vừa giới hạn yêu cầu. Đợi một chút rồi thử đồng bộ lại."
                ),
            )

        try:
            live_meta = fetch_platform_latest_meta(
                platform,
                url,
                limit=limit,
            )
        except BilibiliRateLimited:
            if not cached:
                save_source_sync_cache(
                    url,
                    platform,
                    [],
                    total=None,
                    has_more=True,
                    checked_at=time.time(),
                )
                raise HTTPException(
                    status_code=429,
                    detail="Bilibili đang giới hạn yêu cầu; chưa có dữ liệu cache để hiển thị.",
                )
            save_source_sync_cache(
                url,
                platform,
                cached,
                total=cached_total,
                has_more=cached_has_more,
                checked_at=time.time(),
            )
            return cache_response(
                None,
                cached,
                cached_total,
                cached_has_more,
                "Bilibili đang giới hạn yêu cầu; đang hiển thị dữ liệu đã lưu. Thử đồng bộ lại sau khoảng một phút.",
            )
        except DouyinUnavailable as error:
            if not cached:
                raise HTTPException(
                    status_code=503,
                    detail="Douyin không lấy được danh sách video: " + str(error),
                )
            save_source_sync_cache(
                url,
                platform,
                cached,
                total=cached_total,
                has_more=cached_has_more,
                checked_at=time.time(),
            )
            return cache_response(
                None,
                cached,
                cached_total,
                cached_has_more,
                "Chưa thể cập nhật nguồn; đang hiển thị dữ liệu đã lưu.",
            )
        except Exception as error:
            if not cached:
                raise HTTPException(
                    status_code=500,
                    detail=type(error).__name__ + ": " + str(error),
                )
            save_source_sync_cache(
                url,
                platform,
                cached,
                total=cached_total,
                has_more=cached_has_more,
                checked_at=time.time(),
            )
            return cache_response(
                None,
                cached,
                cached_total,
                cached_has_more,
                "Chưa thể cập nhật nguồn; đang hiển thị dữ liệu đã lưu.",
            )

        live = live_meta.get("videos", []) or []
        remote_total = live_meta.get("total")
        remote_has_more = bool(live_meta.get("has_more", True))
        cached_ids = {video.get("video_id") for video in cached}
        new_count = sum(
            1
            for video in live
            if video.get("video_id") and video.get("video_id") not in cached_ids
        )

        for video in live:
            video["channel_key"] = default_channel
            video.setdefault("platform", platform)

        if source and live:
            cache_live_videos(source["id"], live)
            source_videos = load_cached_videos(source["id"], limit=500)
        else:
            source_videos = cached

        merged = merge_videos(live, source_videos)
        for video in merged:
            video["channel_key"] = default_channel
            video.setdefault("platform", platform)

        total = remote_total if remote_total is not None else cached_total
        has_more = remote_has_more or (
            total is not None and len(merged) < total
        )
        save_source_sync_cache(
            url,
            platform,
            merged,
            total=total,
            has_more=has_more,
            checked_at=now,
        )

        return {
            "platform": platform,
            "videos": [
                enrich_video(video, default_channel=default_channel)
                for video in merged[:limit]
            ],
            "live_count": len(live),
            "cached_count": len(cached),
            "warning": (
                "Đã kiểm tra nguồn, chưa có video mới."
                if new_count == 0 and cached
                else None
            ),
            "registered_source": bool(source),
            "channel": default_channel,
            "total": total,
            "has_more": has_more,
            "checked_remote": True,
            "new_count": new_count,
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

        cached_total = count_cached_videos(source["id"])
        cached = (
            load_cached_videos(
                source[
                    "id"
                ],
                limit=page_size,
                offset=start,
            )
        )

        if (
            cached
        ):

            page_items = cached

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
                        cached_total,

                    "has_more":
                        start + len(page_items) < cached_total,
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
        find_valid_downloaded_video(
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

    output_template = str(folder / "source.pending.%(ext)s")

    try:
        with DOWNLOAD_SLOTS:
            # Recheck after acquiring a slot so duplicate requests for the
            # same video do not start a second downloader process.
            existing = find_valid_downloaded_video(folder)
            if not existing:
                # Remove only known invalid/staging files inside this video's
                # own download folder. A valid source is never touched.
                for stale in folder.glob("source.pending.*"):
                    if stale.is_file():
                        stale.unlink(missing_ok=True)
                for suffix in (".mp4", ".mkv", ".webm", ".mov"):
                    invalid = folder / f"source{suffix}"
                    if invalid.exists() and not media_file_ok(invalid):
                        invalid.unlink(missing_ok=True)
                        invalid.with_name(f".{invalid.name}.probe.json").unlink(missing_ok=True)
                run_platform_download(
                    body.url,
                    output_template,
                    platform,
                )
                finalize_staged_download(folder)

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
        find_valid_downloaded_video(
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

    if not getattr(sys, "frozen", False) and not PIPELINE_FILE.exists():

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

    try:
        minimum_free = max(
            256 * 1024 * 1024,
            int(os.getenv("REUP_MIN_FREE_DISK_BYTES", str(2 * 1024**3))),
        )
    except (TypeError, ValueError):
        minimum_free = 2 * 1024**3
    free_space = shutil.disk_usage(get_runtime_root()).free
    if free_space < minimum_free:
        raise HTTPException(
            status_code=507,
            detail=(
                "Không đủ dung lượng trống để xử lý video. "
                f"Cần tối thiểu {minimum_free // (1024**2)} MB."
            ),
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

    job_settings = body.model_dump(exclude_none=True)
    try:
        db_job = create_job(
            platform_video_id=video_id,
            channel_key=channel,
            mode=mode,
            created_by=request.state.user["id"],
            source_path=(
                source_path
                if source_path and file_ok(source_path)
                else None
            ),
            config=job_settings,
            request_url=body.url,
        )
    except ActiveJobExists as error:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Video này đang được xử lý.",
                "job": error.job,
            },
        ) from error

    db_job_id = (
        db_job[
            "id"
        ]
    )

    # progress.json belongs to the previous execution of this video. Leaving
    # it in place makes a freshly queued job briefly report 100%/completed.
    stale_progress = job_dir_for(channel, video_id) / "progress.json"
    try:
        stale_progress.unlink(missing_ok=True)
    except OSError:
        pass

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

                "settings":
                    job_settings,
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


@app.post(
    "/api/process/{video_id}/stop",
)
def api_process_stop(
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
            detail=
                "Mode không hợp lệ.",
        )

    key = (
        process_key(
            channel,
            video_id,
            mode,
        )
    )

    with PROCESS_LOCK:

        state = (
            PROCESS_STATE.get(
                key
            )
        )

        if not state:

            raise HTTPException(
                status_code=404,
                detail=(
                    "Không tìm thấy tiến trình "
                    "đang chạy."
                ),
            )

        status = (
            state.get(
                "status"
            )
        )

        if status in {
            "completed",
            "failed",
            "cancelled",
        }:

            return {
                "ok":
                    True,

                "status":
                    status,

                "already_finished":
                    True,
            }

        state[
            "cancel_requested"
        ] = True

        state[
            "status"
        ] = "stopping"

        state[
            "stage"
        ] = "stopping"

        state[
            "message"
        ] = (
            "Đang dừng tiến trình..."
        )

        process = (
            state.get(
                "process"
            )
        )

        db_job_id = state.get("db_job_id")

    if db_job_id:
        update_job_progress(
            int(db_job_id),
            status="stopping",
            stage="stopping",
            progress=state.get("percent", 0),
        )

    terminate_process_tree(
        process
    )

    return {
        "ok":
            True,

        "status":
            "stopping",

        "video_id":
            video_id,

        "channel":
            channel,

        "mode":
            mode,
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
            "stopping",
            "cancelled",
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
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
        },
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
                "inline",
            "Cache-Control":
                "no-store, no-cache, must-revalidate",
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
