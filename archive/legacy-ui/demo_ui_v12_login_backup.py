import html
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
from pathlib import Path
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

from services.source_db import (
    get_connection,
    save_video,
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
    version="0.12.0",
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

    if path in PUBLIC_PATHS:

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

    value = video_id.strip()

    if not re.fullmatch(
        r"BV[0-9A-Za-z]{6,20}",
        value,
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Bilibili video ID "
                "không hợp lệ."
            ),
        )

    return value


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
                "bilibili",

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
# BACKGROUND PIPELINE
# =========================================================

def pipeline_worker(
    *,
    video_url: str,
    video_id: str,
    channel: str,
    mode: str,
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
        downloaded_source_path(
            video_id
        )
    )

    if file_ok(
        source_path
    ):

        command.extend([
            "--source-file",
            str(
                source_path
            ),
        ])

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

            result = subprocess.run(
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
                check=False,
            )

        progress = read_json_file(
            job_dir
            / "progress.json"
        )

        if (
            result.returncode
            == 0
        ):

            result_file = (
                find_result_file(
                    channel,
                    video_id,
                    mode,
                )
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
                    f"{result.returncode}."
                )
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
                        0,

                    "message":
                        message,

                    "mode":
                        mode,

                    "channel":
                        channel,

                    "video_id":
                        video_id,

                    "log_path":
                        str(
                            log_path
                        ),
                }

    except Exception as error:

        with PROCESS_LOCK:

            PROCESS_STATE[
                key
            ] = {
                "status":
                    "failed",

                "stage":
                    "failed",

                "percent":
                    0,

                "message":
                    (
                        type(error).__name__
                        + ": "
                        + str(error)
                    ),

                "mode":
                    mode,

                "channel":
                    channel,

                "video_id":
                    video_id,

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
        "hdslb.com",
        "biliimg.com",
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
# LOGIN HTML
# =========================================================

LOGIN_HTML = r"""
<!DOCTYPE html>
<html lang="vi">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>Đăng nhập · Reup AI</title>

<style>

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background:
        radial-gradient(
            circle at 20% 20%,
            rgba(109, 93, 252, .18),
            transparent 32%
        ),
        radial-gradient(
            circle at 80% 80%,
            rgba(21, 151, 101, .12),
            transparent 30%
        ),
        #080c13;
    color: #eef2ff;
    font-family:
        Inter,
        Arial,
        sans-serif;
}

.login-shell {
    width: min(
        430px,
        100%
    );
}

.brand {
    margin-bottom: 18px;
}

.brand h1 {
    margin: 0;
    font-size: 34px;
    letter-spacing: -.8px;
}

.brand p {
    margin:
        7px
        0
        0;
    color: #8f9bb1;
}

.card {
    padding: 26px;
    border:
        1px
        solid
        #283249;
    border-radius: 20px;
    background:
        rgba(
            17,
            23,
            36,
            .94
        );
    box-shadow:
        0
        24px
        60px
        rgba(
            0,
            0,
            0,
            .34
        );
}

.card h2 {
    margin:
        0
        0
        5px;
    font-size: 22px;
}

.hint {
    margin:
        0
        0
        22px;
    color: #8793a8;
    font-size: 14px;
}

label {
    display: block;
    margin:
        0
        0
        7px;
    font-size: 13px;
    font-weight: 800;
    color: #c7d0e1;
}

input {
    width: 100%;
    height: 48px;
    margin-bottom: 16px;
    padding:
        0
        14px;
    border:
        1px
        solid
        #2b3650;
    border-radius: 12px;
    outline: none;
    background: #0d1320;
    color: white;
    font: inherit;
}

input:focus {
    border-color: #6d5dfc;
    box-shadow:
        0
        0
        0
        3px
        rgba(
            109,
            93,
            252,
            .13
        );
}

button {
    width: 100%;
    height: 48px;
    margin-top: 3px;
    border: 0;
    border-radius: 12px;
    background: #6d5dfc;
    color: white;
    font: inherit;
    font-weight: 850;
    cursor: pointer;
}

button:hover {
    filter: brightness(1.07);
}

.error {
    margin-bottom: 16px;
    padding:
        11px
        12px;
    border:
        1px
        solid
        #67313c;
    border-radius: 11px;
    background: #321820;
    color: #ff9cab;
    font-size: 13px;
}

.footer {
    margin-top: 14px;
    text-align: center;
    color: #66738a;
    font-size: 12px;
}

</style>

</head>

<body>

<div class="login-shell">

    <div class="brand">

        <h1>
            Reup AI
        </h1>

        <p>
            Video localization dashboard · V12
        </p>

    </div>


    <div class="card">

        <h2>
            Đăng nhập
        </h2>

        <p class="hint">
            Dùng tài khoản admin đã tạo trong setup V12.
        </p>

        __LOGIN_ERROR__

        <form
            method="post"
            action="/login"
        >

            <label for="username">
                Tên đăng nhập
            </label>

            <input
                id="username"
                name="username"
                type="text"
                value="__LOGIN_USERNAME__"
                autocomplete="username"
                autofocus
                required
            >


            <label for="password">
                Mật khẩu
            </label>

            <input
                id="password"
                name="password"
                type="password"
                autocomplete="current-password"
                required
            >


            <button type="submit">
                Đăng nhập
            </button>

        </form>

    </div>


    <div class="footer">
        Session local · SQLite · Argon2
    </div>

</div>

</body>
</html>
"""


def render_login(
    *,
    error: str = "",
    username: str = "",
):

    error_html = ""

    if error:

        error_html = (
            '<div class="error">'
            + html.escape(
                error
            )
            + '</div>'
        )

    return (
        LOGIN_HTML
        .replace(
            "__LOGIN_ERROR__",
            error_html,
        )
        .replace(
            "__LOGIN_USERNAME__",
            html.escape(
                username,
                quote=True,
            ),
        )
    )


# =========================================================
# HTML
# =========================================================

HTML = r"""
<!DOCTYPE html>
<html lang="vi">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>Reup AI Dashboard</title>

<style>

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: #0b0f17;
    color: #eef2ff;
    font-family:
        Inter,
        Arial,
        sans-serif;
}

button,
input,
select {
    font: inherit;
}

button {
    cursor: pointer;
}

.container {
    width: min(
        1280px,
        94%
    );
    margin: 0 auto;
    padding:
        32px
        0
        80px;
}

.header {
    display: flex;
    justify-content:
        space-between;
    align-items:
        flex-end;
    gap: 16px;
    margin-bottom: 24px;
}

h1 {
    margin:
        0
        0
        6px;
    font-size: 34px;
}

.subtitle {
    color: #8f9bb1;
}

.account-box {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.account-user {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding:
        0
        13px;
    border:
        1px
        solid
        #2a344a;
    border-radius: 12px;
    background: #121826;
    color: #dce4f4;
    font-size: 13px;
    font-weight: 800;
}

.account-role {
    padding:
        3px
        7px;
    border-radius: 999px;
    background: #282056;
    color: #bcb4ff;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .5px;
}

.logout-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    padding:
        0
        13px;
    border:
        1px
        solid
        #2a344a;
    border-radius: 12px;
    background: #1b2231;
    color: #dce4f4;
    text-decoration: none;
    font-size: 13px;
    font-weight: 800;
}

.logout-link:hover {
    border-color: #6d5dfc;
}

.source-bar {
    display: grid;
    grid-template-columns:
        1fr
        auto;
    gap: 10px;
    margin-bottom: 14px;
}

.control-bar {
    display: grid;
    grid-template-columns:
        minmax(220px, 1fr)
        190px
        auto;
    gap: 10px;
    margin-bottom: 12px;
}

input,
select {
    width: 100%;
    min-height: 46px;
    border:
        1px
        solid
        #2a344a;
    border-radius: 12px;
    padding:
        0
        14px;
    background: #121826;
    color: #fff;
    outline: none;
}

input:focus,
select:focus {
    border-color: #6d5dfc;
}

button {
    border: 0;
    border-radius: 11px;
    padding:
        11px
        14px;
    font-weight: 750;
}

button:disabled {
    opacity: .55;
    cursor:
        not-allowed;
}

.primary {
    background: #6d5dfc;
    color: #fff;
}

.secondary {
    background: #20293a;
    color: #f4f6ff;
}

.green {
    background: #159765;
    color: #fff;
}

.orange {
    background: #d36d2c;
    color: #fff;
}

.toolbar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 10px;
}

.info-line {
    min-height: 24px;
    margin:
        6px
        0
        18px;
    color: #9ba7bb;
}

.warning {
    color: #f0b56b;
}

.grid {
    display: grid;
    grid-template-columns:
        repeat(
            auto-fill,
            minmax(
                320px,
                1fr
            )
        );
    gap: 18px;
}

.card {
    overflow: hidden;
    border:
        1px
        solid
        #232d42;
    border-radius: 16px;
    background: #111724;
    box-shadow:
        0
        12px
        30px
        rgba(
            0,
            0,
            0,
            .15
        );
}

.cover-wrap {
    position: relative;
    width: 100%;
    aspect-ratio:
        16 / 9;
    background: #080c13;
}

.cover {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.cover-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #59657b;
    font-size: 14px;
    z-index: 0;
}

.cover {
    position: relative;
    z-index: 1;
}

.content {
    padding: 15px;
}

.title {
    font-size: 16px;
    font-weight: 800;
    line-height: 1.45;
    min-height: 46px;
    margin-bottom: 8px;
}

.meta {
    font-size: 13px;
    color: #8f9bb1;
    margin-bottom: 10px;
}

.badges {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 12px;
}

.badge {
    padding:
        5px
        8px;
    border-radius: 999px;
    background: #20293a;
    font-size: 12px;
    color: #c3ccdc;
}

.badge.ok {
    background: #123b2d;
    color: #72e6b0;
}

.badge.work {
    background: #3c3217;
    color: #f2ce74;
}

.badge.fail {
    background: #421e25;
    color: #ff8b9b;
}

.actions,
.ai-actions,
.result-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.actions {
    margin-bottom: 11px;
}

.channel-row {
    margin-bottom: 10px;
}

.ai-actions {
    display: grid;
    grid-template-columns:
        1fr
        1fr;
}

.result-actions {
    margin-top: 10px;
}

.progress-wrap {
    display: none;
    margin-top: 13px;
}

.progress {
    width: 100%;
    height: 9px;
    border-radius: 999px;
    overflow: hidden;
    background: #232b3c;
}

.progress-bar {
    width: 0%;
    height: 100%;
    background: #6d5dfc;
    transition:
        width
        .3s
        ease;
}

.progress-text {
    margin-top: 7px;
    color: #aeb8ca;
    font-size: 13px;
}

.log {
    display: none;
    margin-top: 10px;
    max-height: 145px;
    overflow: auto;
    border:
        1px
        solid
        #252e40;
    border-radius: 9px;
    background: #080c12;
    padding: 9px;
    color: #9eaabc;
    font-family:
        Consolas,
        monospace;
    font-size: 11px;
    white-space: pre-wrap;
}

.load-more-wrap {
    display: flex;
    justify-content: center;
    padding-top: 25px;
}

#loadMore {
    display: none;
    min-width: 210px;
}

.empty {
    grid-column: 1 / -1;
    padding: 40px 20px;
    text-align: center;
    color: #8f9bb1;
    border:
        1px
        dashed
        #2a344a;
    border-radius: 15px;
}

.modal {
    position: fixed;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 22px;
    background:
        rgba(
            0,
            0,
            0,
            .82
        );
    z-index: 1000;
}

.modal.open {
    display: flex;
}

.modal-box {
    width:
        min(
            1000px,
            96vw
        );
    border:
        1px
        solid
        #2c364a;
    border-radius: 16px;
    background: #101621;
    overflow: hidden;
}

.modal-head {
    display: flex;
    justify-content:
        space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 15px;
}

.modal-title {
    font-weight: 800;
}

.close-btn {
    background: #252d3d;
    color: white;
}

video {
    width: 100%;
    max-height: 78vh;
    display: block;
    background: black;
}


.bottom-pages {
    display: none;
    align-items: center;
    justify-content: center;
    gap: 7px;
    flex-wrap: wrap;
    padding-top: 28px;
}

.bottom-page-btn {
    min-width: 40px;
    height: 40px;
    padding: 0 11px;
    border: 1px solid #2a344a;
    border-radius: 10px;
    background: #171e2c;
    color: #dce4f4;
    font-weight: 800;
}

.bottom-page-btn:hover {
    border-color: #6d5dfc;
    background: #202a3d;
}

.bottom-page-btn.active {
    background: #6d5dfc;
    border-color: #6d5dfc;
    color: #fff;
}

.bottom-page-dots {
    min-width: 28px;
    text-align: center;
    color: #8390a7;
    font-weight: 800;
}

.page-info {
    min-height: 24px;
    padding-top: 10px;
    text-align: center;
    color: #8f9bb1;
    font-size: 13px;
}

@media (
    max-width: 760px
) {

    .source-bar,
    .control-bar {
        grid-template-columns:
            1fr;
    }

    .ai-actions {
        grid-template-columns:
            1fr;
    }

    .header {
        align-items:
            flex-start;
        flex-direction:
            column;
    }
}

</style>

</head>

<body>

<div class="container">

    <div class="header">

        <div>

            <h1>
                Reup AI
            </h1>

            <div class="subtitle">
                Video → Vietsub AI → Voice AI
            </div>

        </div>


        <div class="account-box">

            <div class="account-user">
                👤 __CURRENT_USER__
                <span class="account-role">
                    __CURRENT_ROLE__
                </span>
            </div>

            <a
                class="logout-link"
                href="/logout"
            >
                Đăng xuất
            </a>

        </div>

    </div>


    <div class="source-bar">

        <input
            id="sourceUrl"
            value="https://space.bilibili.com/4856007"
            placeholder="Dán link channel Bilibili..."
        >

        <button
            class="primary"
            onclick="loadVideos()"
        >
            🔄 Đồng bộ nguồn
        </button>

    </div>


    <div class="control-bar">

        <input
            id="searchInput"
            placeholder="🔍 Tìm trong trang hiện tại..."
            oninput="resetAndRender()"
        >

        <select
            id="statusFilter"
            onchange="resetAndRender()"
        >

            <option value="all">
                Tất cả trạng thái
            </option>

            <option value="not_downloaded">
                Chưa tải
            </option>

            <option value="downloaded">
                Đã tải
            </option>

            <option value="processing">
                Đang xử lý
            </option>

            <option value="subtitle">
                Đã Vietsub
            </option>

            <option value="voiceover">
                Đã lồng tiếng
            </option>

            <option value="failed">
                Bị lỗi
            </option>

        </select>

        <button
            class="secondary"
            onclick="refreshDisplay()"
        >
            ↻ Làm mới
        </button>

    </div>


    <div class="toolbar">

        <button
            class="secondary"
            onclick="setSort('new')"
        >
            🆕 Mới nhất
        </button>

        <button
            class="secondary"
            onclick="setSort('view')"
        >
            🔥 Top view
        </button>

    </div>


    <div
        id="info"
        class="info-line"
    ></div>

    <div
        class="info-line"
        style="margin-top:-10px;font-size:12px;"
    >
        Mỗi trang hiển thị 10 video. Bấm 1, 2, 3... để tải và chuyển sang đúng nhóm video của trang đó.
    </div>


    <div
        id="videos"
        class="grid"
    ></div>


    <div
        id="bottomPages"
        class="bottom-pages"
    ></div>

    <div
        id="pageInfo"
        class="page-info"
    ></div>

</div>


<div
    id="playerModal"
    class="modal"
    onclick="closePlayerIfBackdrop(event)"
>

    <div class="modal-box">

        <div class="modal-head">

            <div
                id="playerTitle"
                class="modal-title"
            >
                Video kết quả
            </div>

            <button
                class="close-btn"
                onclick="closePlayer()"
            >
                ✕
            </button>

        </div>

        <video
            id="player"
            controls
            playsinline
        ></video>

    </div>

</div>


<script>

let currentVideos = [];
let currentSort = 'new';
let currentPage = 1;
let sourceTotal = null;
let totalPages = null;
let remoteHasMore = true;
let loadingPage = false;
const PAGE_SIZE = 10;
const pageCache = {};


function escapeHtml(
    value
) {

    return String(
        value ?? ''
    )
    .replaceAll(
        '&',
        '&amp;'
    )
    .replaceAll(
        '<',
        '&lt;'
    )
    .replaceAll(
        '>',
        '&gt;'
    )
    .replaceAll(
        '"',
        '&quot;'
    )
    .replaceAll(
        "'",
        '&#039;'
    );
}


function formatViews(
    value
) {

    return (
        new Intl.NumberFormat(
            'vi-VN'
        )
        .format(
            Number(
                value
                || 0
            )
        )
    );
}


function formatDate(
    value
) {

    if (!value) {
        return '';
    }

    try {

        return (
            new Date(
                value
            )
            .toLocaleString(
                'vi-VN'
            )
        );

    } catch {

        return String(
            value
        );
    }
}


function coverUrl(
    url
) {

    if (!url) {
        return '';
    }

    return (
        '/api/cover?url='
        + encodeURIComponent(
            url
        )
    );
}


function getVideoById(
    videoId
) {

    return (
        currentVideos.find(
            item =>
                item.video_id
                === videoId
        )
    );
}


function getFilteredVideos() {

    const keyword = (
        document
        .getElementById(
            'searchInput'
        )
        .value
        .trim()
        .toLowerCase()
    );

    const status = (
        document
        .getElementById(
            'statusFilter'
        )
        .value
    );

    let videos = [
        ...currentVideos
    ];

    if (keyword) {

        videos = (
            videos.filter(
                video => {

                    const haystack = (
                        String(
                            video.title
                            || ''
                        )
                        + ' '
                        + String(
                            video.video_id
                            || ''
                        )
                    )
                    .toLowerCase();

                    return (
                        haystack.includes(
                            keyword
                        )
                    );
                }
            )
        );
    }

    if (
        status
        !== 'all'
    ) {

        videos = (
            videos.filter(
                video => {

                    if (
                        status
                        === 'not_downloaded'
                    ) {
                        return (
                            !video.downloaded
                        );
                    }

                    if (
                        status
                        === 'downloaded'
                    ) {
                        return (
                            !!video.downloaded
                        );
                    }

                    if (
                        status
                        === 'processing'
                    ) {
                        return (
                            !!video.processing
                        );
                    }

                    if (
                        status
                        === 'subtitle'
                    ) {
                        return (
                            !!video
                            .has_subtitle_result
                        );
                    }

                    if (
                        status
                        === 'voiceover'
                    ) {
                        return (
                            !!video
                            .has_voice_result
                        );
                    }

                    if (
                        status
                        === 'failed'
                    ) {
                        return (
                            video.db_status
                            === 'failed'
                        );
                    }

                    return true;
                }
            )
        );
    }

    if (
        currentSort
        === 'view'
    ) {

        videos.sort(
            (a, b) =>
                Number(
                    b.play_count
                    || 0
                )
                -
                Number(
                    a.play_count
                    || 0
                )
        );

    } else {

        videos.sort(
            (a, b) =>
                String(
                    b.published_at
                    || ''
                )
                .localeCompare(
                    String(
                        a.published_at
                        || ''
                    )
                )
        );
    }

    return videos;
}


function setSort(
    type
) {

    currentSort = type;

    renderVideos();
}


function resetAndRender() {

    renderVideos();
}


function refreshDisplay() {

    renderVideos();
}


function updateTotalPages() {

    if (
        Number.isFinite(
            sourceTotal
        )
        && sourceTotal >= 0
    ) {

        totalPages = Math.max(
            1,
            Math.ceil(
                sourceTotal
                / PAGE_SIZE
            )
        );

    } else {

        totalPages = null;
    }
}


function pageItems(
    current,
    total
) {

    if (
        !total
        || total <= 1
    ) {
        return [1];
    }

    if (
        total <= 9
    ) {

        return Array.from(
            {
                length: total
            },
            (
                _,
                index
            ) => index + 1
        );
    }

    const pages = new Set([
        1,
        2,
        total - 1,
        total,
        current - 2,
        current - 1,
        current,
        current + 1,
        current + 2,
    ]);

    const sorted = (
        Array.from(
            pages
        )
        .filter(
            page =>
                page >= 1
                && page <= total
        )
        .sort(
            (a, b) =>
                a - b
        )
    );

    const result = [];

    for (
        let index = 0;
        index < sorted.length;
        index++
    ) {

        if (
            index > 0
            && sorted[index]
                - sorted[index - 1]
                > 1
        ) {

            result.push(
                'dots'
            );
        }

        result.push(
            sorted[index]
        );
    }

    return result;
}


function renderPagination() {

    const root = (
        document
        .getElementById(
            'bottomPages'
        )
    );

    const pageInfo = (
        document
        .getElementById(
            'pageInfo'
        )
    );

    root.innerHTML =
        '';

    let effectiveTotalPages = (
        totalPages
    );

    if (
        !effectiveTotalPages
    ) {

        const cachedPages = (
            Object.keys(
                pageCache
            )
            .map(
                value =>
                    Number(
                        value
                    )
            )
            .filter(
                value =>
                    Number.isFinite(
                        value
                    )
            )
        );

        const highestCached = (
            cachedPages.length
            ? Math.max(
                ...cachedPages
            )
            : 1
        );

        effectiveTotalPages = (
            highestCached
            + (
                remoteHasMore
                ? 1
                : 0
            )
        );
    }

    effectiveTotalPages = Math.max(
        1,
        effectiveTotalPages
    );

    root.style.display =
        'flex';

    for (
        const item
        of pageItems(
            currentPage,
            effectiveTotalPages
        )
    ) {

        if (
            item === 'dots'
        ) {

            const dots = (
                document
                .createElement(
                    'span'
                )
            );

            dots.className =
                'bottom-page-dots';

            dots.textContent =
                '…';

            root.appendChild(
                dots
            );

            continue;
        }

        const button = (
            document
            .createElement(
                'button'
            )
        );

        button.className =
            (
                'bottom-page-btn'
                + (
                    Number(item)
                    === Number(currentPage)
                    ? ' active'
                    : ''
                )
            );

        button.dataset.page =
            String(
                item
            );

        button.textContent =
            String(
                item
            );

        button.disabled =
            loadingPage;

        button.onclick =
            () => loadPage(
                Number(
                    item
                )
            );

        root.appendChild(
            button
        );
    }

    const firstVideo = (
        (
            currentPage - 1
        )
        * PAGE_SIZE
        + 1
    );

    const lastVideo = (
        firstVideo
        + currentVideos.length
        - 1
    );

    if (
        Number.isFinite(
            sourceTotal
        )
    ) {

        pageInfo.textContent =
            (
                `Trang ${currentPage}`
                + ` / ${effectiveTotalPages}`
                + ` · video ${firstVideo}-${lastVideo}`
                + ` / ${sourceTotal}`
            );

    } else {

        pageInfo.textContent =
            (
                `Trang ${currentPage}`
                + ` · ${currentVideos.length} video`
            );
    }
}


function updateSourceInfo(
    extraMessage = ''
) {

    const info = (
        document
        .getElementById(
            'info'
        )
    );

    let text = (
        `Trang ${currentPage}`
    );

    if (
        Number.isFinite(
            sourceTotal
        )
    ) {

        text += (
            ` · tổng ${sourceTotal} video`
        );
    }

    if (
        extraMessage
    ) {

        text += (
            ` · ${extraMessage}`
        );
    }

    info.className =
        'info-line';

    info.textContent =
        text;
}


async function loadPage(
    page,
    force = false
) {

    page = Math.max(
        1,
        Number(
            page
        )
        || 1
    );

    if (
        totalPages
        && page > totalPages
    ) {
        page = totalPages;
    }

    if (
        !force
        && pageCache[
            page
        ]
    ) {

        currentPage =
            page;

        currentVideos = [
            ...pageCache[
                page
            ]
        ];

        renderVideos();

        updateSourceInfo(
            'đọc từ cache'
        );

        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });

        return;
    }

    if (
        loadingPage
    ) {
        return;
    }

    const sourceUrl = (
        document
        .getElementById(
            'sourceUrl'
        )
        .value
        .trim()
    );

    const info = (
        document
        .getElementById(
            'info'
        )
    );

    loadingPage =
        true;

    renderPagination();

    const startNumber = (
        (page - 1)
        * PAGE_SIZE
        + 1
    );

    const endNumber = (
        page
        * PAGE_SIZE
    );

    info.className =
        'info-line';

    info.textContent =
        (
            `Đang lấy trang ${page}`
            + ` · video ${startNumber}-${endNumber}...`
        );

    try {

        const response = (
            await fetch(
                '/api/videos/page',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            url:
                                sourceUrl,

                            page:
                                page,

                            page_size:
                                PAGE_SIZE
                        })
                }
            )
        );

        const data = (
            await response.json()
        );

        if (
            !response.ok
        ) {

            throw new Error(
                data.detail
                || (
                    `Không lấy được trang ${page}.`
                )
            );
        }

        const videos = (
            data.videos
            || []
        );

        if (
            data.total
            !== null
            && data.total
            !== undefined
        ) {

            sourceTotal = Number(
                data.total
            );

            updateTotalPages();
        }

        remoteHasMore =
            !!data.has_more;

        if (
            videos.length
            === 0
        ) {

            if (
                !totalPages
                || page >= totalPages
            ) {

                remoteHasMore =
                    false;
            }

            throw new Error(
                `Trang ${page} không có video.`
            );
        }

        pageCache[
            page
        ] = videos;

        currentPage =
            page;

        currentVideos = [
            ...videos
        ];

        renderVideos();

        updateSourceInfo(
            data.from_cache
            ? 'cache SQLite'
            : 'Bilibili'
        );

        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });

    } catch (
        error
    ) {

        info.className =
            'info-line warning';

        info.textContent =
            (
                'Lỗi: '
                + error.message
            );

    } finally {

        loadingPage =
            false;

        renderPagination();
    }
}


async function loadVideos() {

    const sourceUrl = (
        document
        .getElementById(
            'sourceUrl'
        )
        .value
        .trim()
    );

    const info = (
        document
        .getElementById(
            'info'
        )
    );

    info.className =
        'info-line';

    info.textContent =
        'Đang đồng bộ nguồn và đếm tổng video...';

    currentPage =
        1;

    currentVideos =
        [];

    sourceTotal =
        null;

    totalPages =
        null;

    remoteHasMore =
        true;

    for (
        const key
        of Object.keys(
            pageCache
        )
    ) {

        delete pageCache[
            key
        ];
    }

    try {

        const response = (
            await fetch(
                '/api/videos',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            url:
                                sourceUrl,

                            limit:
                                PAGE_SIZE
                        })
                }
            )
        );

        const data = (
            await response.json()
        );

        if (!response.ok) {

            throw new Error(
                data.detail
                || 'Không lấy được video.'
            );
        }

        sourceTotal = (
            data.total
            !== null
            && data.total
            !== undefined
            ? Number(
                data.total
            )
            : null
        );

        updateTotalPages();

        remoteHasMore = (
            data.has_more
            !== undefined
            ? !!data.has_more
            : true
        );

        const videos = (
            data.videos
            || []
        );

        // /api/videos có thể trả cả cache cũ.
        // Trang 1 chỉ lấy đúng 10 video đầu tiên.
        const pageOne = (
            videos.slice(
                0,
                PAGE_SIZE
            )
        );

        pageCache[
            1
        ] = pageOne;

        currentVideos = [
            ...pageOne
        ];

        currentPage =
            1;

        renderVideos();

        let extra = '';

        if (
            data.warning
        ) {

            extra =
                data.warning;
        }

        updateSourceInfo(
            extra
        );

    } catch (
        error
    ) {

        currentVideos = [];

        renderVideos();

        info.className =
            'info-line warning';

        info.textContent =
            'Lỗi: '
            + error.message;
    }
}


function renderVideos() {

    const root = (
        document
        .getElementById(
            'videos'
        )
    );

    const filtered = (
        getFilteredVideos()
    );

    root.innerHTML =
        '';

    if (
        filtered.length
        === 0
    ) {

        root.innerHTML = `
            <div class="empty">
                Không có video phù hợp ở trang này.
            </div>
        `;

        renderPagination();

        return;
    }

    for (
        const video
        of filtered
    ) {

        root.appendChild(
            buildCard(
                video
            )
        );
    }

    renderPagination();
}


function buildBadges(
    video
) {

    const badges = [];

    if (
        video.downloaded
    ) {

        badges.push(
            '<span class="badge ok">✓ Đã tải</span>'
        );

    } else {

        badges.push(
            '<span class="badge">Chưa tải</span>'
        );
    }

    if (
        video.has_subtitle_result
    ) {

        badges.push(
            '<span class="badge ok">🇻🇳 Vietsub</span>'
        );
    }

    if (
        video.has_voice_result
    ) {

        badges.push(
            '<span class="badge ok">🎙 Voice</span>'
        );
    }

    if (
        video.processing
    ) {

        badges.push(
            '<span class="badge work">⏳ Đang xử lý</span>'
        );
    }

    if (
        video.db_status
        === 'failed'
    ) {

        badges.push(
            '<span class="badge fail">Lỗi</span>'
        );
    }

    return (
        badges.join('')
    );
}


function buildCard(
    video
) {

    const card = (
        document.createElement(
            'div'
        )
    );

    card.className =
        'card';

    card.dataset.videoId =
        video.video_id;

    const channel = (
        video.channel_key
        || '2d_animation'
    );

    let resultButtons =
        '';

    if (
        video.has_subtitle_result
    ) {

        resultButtons += `
            <button
                class="secondary"
                data-result-mode="subtitle"
            >
                ▶ Xem Vietsub
            </button>
        `;
    }

    if (
        video.has_voice_result
    ) {

        resultButtons += `
            <button
                class="secondary"
                data-result-mode="voiceover"
            >
                ▶ Xem Voice
            </button>
        `;
    }

    card.innerHTML = `

        <div class="cover-wrap">

            <div class="cover-fallback">
                Không có thumbnail
            </div>

            <img
                class="cover"
                src="${escapeHtml(coverUrl(video.cover_url || ''))}"
                alt="${escapeHtml(video.title || '')}"
                loading="lazy"
                onerror="this.style.display='none'"
            >

        </div>


        <div class="content">

            <div class="title">
                ${escapeHtml(video.title || video.video_id)}
            </div>

            <div class="meta">
                ${escapeHtml(video.video_id)}
                · ${formatViews(video.play_count)} views
                ${
                    video.published_at
                    ? ' · '
                      + escapeHtml(
                            formatDate(
                                video.published_at
                            )
                        )
                    : ''
                }
            </div>

            <div class="badges">
                ${buildBadges(video)}
            </div>


            <div class="actions">

                <button
                    class="secondary open-btn"
                >
                    Mở
                </button>

                <button
                    class="secondary download-btn"
                >
                    ↓ Tải gốc
                </button>

            </div>


            <div class="channel-row">

                <select class="channel">

                    <option
                        value="2d_animation"
                        ${
                            channel
                            === '2d_animation'
                            ? 'selected'
                            : ''
                        }
                    >
                        2D Animation
                    </option>

                    <option
                        value="3d_animation"
                        ${
                            channel
                            === '3d_animation'
                            ? 'selected'
                            : ''
                        }
                    >
                        3D Animation
                    </option>

                    <option
                        value="comedy"
                        ${
                            channel
                            === 'comedy'
                            ? 'selected'
                            : ''
                        }
                    >
                        Comedy
                    </option>

                </select>

            </div>


            <div class="ai-actions">

                <button
                    class="green sub-btn"
                >
                    🇻🇳 Dịch Vietsub AI
                </button>

                <button
                    class="orange voice-btn"
                >
                    🎙 Dịch + Lồng tiếng
                </button>

            </div>


            <div class="result-actions">
                ${resultButtons}
            </div>


            <div class="progress-wrap">

                <div class="progress">
                    <div class="progress-bar"></div>
                </div>

                <div class="progress-text">
                    Chưa xử lý.
                </div>

                <div class="result-actions dynamic-results"></div>

                <div class="log"></div>

            </div>

        </div>
    `;


    card
    .querySelector(
        '.open-btn'
    )
    .onclick = () => {

        window.open(
            video.url,
            '_blank'
        );
    };


    card
    .querySelector(
        '.download-btn'
    )
    .onclick = () => {

        downloadVideo(
            video,
            card
        );
    };


    card
    .querySelector(
        '.sub-btn'
    )
    .onclick = () => {

        processVideo(
            video,
            card,
            'subtitle'
        );
    };


    card
    .querySelector(
        '.voice-btn'
    )
    .onclick = () => {

        processVideo(
            video,
            card,
            'voiceover'
        );
    };


    for (
        const button
        of card
        .querySelectorAll(
            '[data-result-mode]'
        )
    ) {

        button.onclick = () => {

            const mode = (
                button.dataset
                .resultMode
            );

            openPlayer(
                video,
                mode,
                card
                .querySelector(
                    '.channel'
                )
                .value
            );
        };
    }


    return card;
}


async function downloadVideo(
    video,
    card
) {

    const button = (
        card
        .querySelector(
            '.download-btn'
        )
    );

    const oldText = (
        button.textContent
    );

    button.disabled =
        true;

    button.textContent =
        'Đang tải...';

    try {

        const response = (
            await fetch(
                '/api/download',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            url:
                                video.url,

                            video_id:
                                video.video_id
                        })
                }
            )
        );

        if (
            !response.ok
        ) {

            let message =
                'Tải video thất bại.';

            try {

                const data = (
                    await response.json()
                );

                message = (
                    data.detail
                    || message
                );

            } catch {}

            throw new Error(
                message
            );
        }

        const blob = (
            await response.blob()
        );

        const objectUrl = (
            URL.createObjectURL(
                blob
            )
        );

        const anchor = (
            document
            .createElement(
                'a'
            )
        );

        anchor.href =
            objectUrl;

        anchor.download =
            (
                video.video_id
                + '_source.mp4'
            );

        document.body.appendChild(
            anchor
        );

        anchor.click();

        anchor.remove();

        URL.revokeObjectURL(
            objectUrl
        );

        video.downloaded =
            true;

        button.textContent =
            '✓ Đã tải';

        renderVideos();

    } catch (
        error
    ) {

        alert(
            error.message
        );

        button.textContent =
            oldText;

    } finally {

        button.disabled =
            false;
    }
}


async function processVideo(
    video,
    card,
    mode
) {

    const channel = (
        card
        .querySelector(
            '.channel'
        )
        .value
    );

    const subButton = (
        card
        .querySelector(
            '.sub-btn'
        )
    );

    const voiceButton = (
        card
        .querySelector(
            '.voice-btn'
        )
    );

    const progressWrap = (
        card
        .querySelector(
            '.progress-wrap'
        )
    );

    const progressBar = (
        card
        .querySelector(
            '.progress-bar'
        )
    );

    const progressText = (
        card
        .querySelector(
            '.progress-text'
        )
    );

    const logBox = (
        card
        .querySelector(
            '.log'
        )
    );

    const dynamicResults = (
        card
        .querySelector(
            '.dynamic-results'
        )
    );

    subButton.disabled =
        true;

    voiceButton.disabled =
        true;

    progressWrap.style.display =
        'block';

    logBox.style.display =
        'none';

    dynamicResults.innerHTML =
        '';

    progressBar.style.width =
        '1%';

    progressText.textContent =
        (
            mode === 'subtitle'
            ? 'Đang khởi động Vietsub AI...'
            : 'Đang khởi động Voice AI...'
        );

    try {

        const response = (
            await fetch(
                '/api/process',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            url:
                                video.url,

                            video_id:
                                video.video_id,

                            channel:
                                channel,

                            mode:
                                mode
                        })
                }
            )
        );

        const data = (
            await response.json()
        );

        if (
            !response.ok
        ) {

            throw new Error(
                data.detail
                || (
                    'Không khởi động '
                    + 'được pipeline.'
                )
            );
        }

        video.processing =
            true;

        await pollProcess(
            video,
            card,
            channel,
            mode
        );

    } catch (
        error
    ) {

        progressText.textContent =
            (
                'Lỗi: '
                + error.message
            );

        progressBar.style.width =
            '0%';

        subButton.disabled =
            false;

        voiceButton.disabled =
            false;

        video.processing =
            false;
    }
}


async function pollProcess(
    video,
    card,
    channel,
    mode
) {

    const subButton = (
        card
        .querySelector(
            '.sub-btn'
        )
    );

    const voiceButton = (
        card
        .querySelector(
            '.voice-btn'
        )
    );

    const progressBar = (
        card
        .querySelector(
            '.progress-bar'
        )
    );

    const progressText = (
        card
        .querySelector(
            '.progress-text'
        )
    );

    const logBox = (
        card
        .querySelector(
            '.log'
        )
    );

    const dynamicResults = (
        card
        .querySelector(
            '.dynamic-results'
        )
    );

    while (true) {

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    1500
                )
        );

        const url = (
            `/api/process/${encodeURIComponent(video.video_id)}`
            + `?channel=${encodeURIComponent(channel)}`
            + `&mode=${encodeURIComponent(mode)}`
        );

        const response = (
            await fetch(
                url
            )
        );

        const data = (
            await response.json()
        );

        if (
            !response.ok
        ) {

            throw new Error(
                data.detail
                || (
                    'Không đọc '
                    + 'được tiến độ.'
                )
            );
        }

        const percent = (
            Number(
                data.percent
                || 0
            )
        );

        progressBar.style.width =
            `${percent}%`;

        progressText.textContent =
            (
                `${percent}% · `
                + (
                    data.message
                    || data.stage
                    || ''
                )
            );

        if (
            data.log_tail
            && data.log_tail.length
        ) {

            logBox.style.display =
                'block';

            logBox.textContent =
                data.log_tail.join(
                    '\n'
                );

            logBox.scrollTop =
                logBox.scrollHeight;
        }

        if (
            data.status
            === 'completed'
        ) {

            progressBar.style.width =
                '100%';

            progressText.textContent =
                '100% · Hoàn tất';

            video.processing =
                false;

            if (
                mode
                === 'subtitle'
            ) {

                video.has_subtitle_result =
                    true;

            } else {

                video.has_voice_result =
                    true;
            }

            dynamicResults.innerHTML = `
                <button
                    class="secondary play-finished"
                >
                    ▶ Xem kết quả
                </button>

                <a
                    class="secondary download-finished"
                    style="
                        display:inline-block;
                        text-decoration:none;
                    "
                    href="/api/result/${encodeURIComponent(video.video_id)}?channel=${encodeURIComponent(channel)}&mode=${encodeURIComponent(mode)}"
                >
                    ↓ Tải kết quả
                </a>
            `;

            dynamicResults
            .querySelector(
                '.play-finished'
            )
            .onclick = () => {

                openPlayer(
                    video,
                    mode,
                    channel
                );
            };

            subButton.disabled =
                false;

            voiceButton.disabled =
                false;

            return;
        }

        if (
            data.status
            === 'failed'
        ) {

            video.processing =
                false;

            video.db_status =
                'failed';

            subButton.disabled =
                false;

            voiceButton.disabled =
                false;

            throw new Error(
                data.message
                || 'Pipeline thất bại.'
            );
        }
    }
}


function openPlayer(
    video,
    mode,
    channel
) {

    const modal = (
        document
        .getElementById(
            'playerModal'
        )
    );

    const player = (
        document
        .getElementById(
            'player'
        )
    );

    const title = (
        document
        .getElementById(
            'playerTitle'
        )
    );

    title.textContent =
        (
            (
                mode
                === 'subtitle'
                ? 'Vietsub'
                : 'Vietsub + Voice'
            )
            + ' · '
            + (
                video.title
                || video.video_id
            )
        );

    player.src = (
        `/api/stream/${encodeURIComponent(video.video_id)}`
        + `?channel=${encodeURIComponent(channel)}`
        + `&mode=${encodeURIComponent(mode)}`
    );

    modal.classList.add(
        'open'
    );

    player.load();

    player.play()
    .catch(
        () => {}
    );
}


function closePlayer() {

    const modal = (
        document
        .getElementById(
            'playerModal'
        )
    );

    const player = (
        document
        .getElementById(
            'player'
        )
    );

    player.pause();

    player.removeAttribute(
        'src'
    );

    player.load();

    modal.classList.remove(
        'open'
    );
}


function closePlayerIfBackdrop(
    event
) {

    if (
        event.target.id
        === 'playerModal'
    ) {

        closePlayer();
    }
}


document.addEventListener(
    'keydown',
    event => {

        if (
            event.key
            === 'Escape'
        ) {

            closePlayer();
        }
    }
);


loadVideos();

</script>

</body>
</html>
"""


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

            current_user = (
                get_user_by_id(
                    int(
                        current_user_id
                    )
                )
            )

        except Exception:

            current_user = None

        if (
            current_user
            and bool(
                current_user.get(
                    "enabled",
                    0,
                )
            )
        ):

            return RedirectResponse(
                url="/",
                status_code=303,
            )

    return HTMLResponse(
        render_login()
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

        return HTMLResponse(
            render_login(
                error=(
                    "Sai tài khoản hoặc mật khẩu."
                ),
                username=
                    username,
            ),
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
# PAGE
# =========================================================

@app.get(
    "/",
    response_class=HTMLResponse,
)
def home(
    request: Request,
):

    user = (
        request.state.user
    )

    page = (
        HTML
        .replace(
            "__CURRENT_USER__",
            html.escape(
                str(
                    user.get(
                        "username",
                        "user",
                    )
                )
            ),
        )
        .replace(
            "__CURRENT_ROLE__",
            html.escape(
                str(
                    user.get(
                        "role",
                        "user",
                    )
                )
            ),
        )
    )

    return HTMLResponse(
        page
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

    if (
        platform
        == "douyin"
    ):

        raise HTTPException(
            status_code=501,
            detail=(
                "Douyin adapter "
                "chưa được kết nối."
            ),
        )

    if (
        platform
        != "bilibili"
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "Link chưa được hỗ trợ."
            ),
        )

    source = (
        find_source_by_profile(
            url
        )
    )

    cached = []

    default_channel = (
        "2d_animation"
    )

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

    try:

        live_meta = (
            bilibili_fetch_latest_meta(
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
                "Bilibili đang "
                "rate-limit; "
                "đang dùng cache SQLite."
            )

        else:

            raise HTTPException(
                status_code=429,
                detail=(
                    "Bilibili đang "
                    "rate-limit và "
                    "chưa có cache."
                ),
            )

    except Exception as error:

        if cached:

            warning = (
                "Live API lỗi; "
                "đang dùng cache: "
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
            "bilibili",

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

    if (
        platform
        != "bilibili"
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "Lazy pagination hiện "
                "chỉ hỗ trợ Bilibili."
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

    # ---------------------------------------------
    # 1. Nếu SQLite đã có đủ trang này -> dùng cache
    # ---------------------------------------------

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

    # ---------------------------------------------
    # 2. Cache chưa có -> chỉ lúc này mới gọi Bilibili
    # ---------------------------------------------

    try:

        live_meta = (
            bilibili_fetch_page_meta(
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
                "Bilibili đang rate-limit. "
                "Không retry liên tục; "
                "thử lại trang này sau."
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

    if (
        platform
        != "bilibili"
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "Download hiện tại "
                "chỉ hỗ trợ Bilibili."
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

    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "-f",
        "bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "-o",
        output_template,
        body.url,
    ]

    env = (
        os.environ.copy()
    )

    env[
        "PYTHONIOENCODING"
    ] = "utf-8"

    env[
        "PYTHONUTF8"
    ] = "1"

    result = subprocess.run(
        command,
        cwd=str(
            PROJECT_ROOT
        ),
        env=env,
        check=False,
    )

    if (
        result.returncode
        != 0
    ):

        raise HTTPException(
            status_code=500,
            detail=(
                "yt-dlp download "
                "thất bại."
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
                "nhưng không tìm "
                "thấy source video."
            ),
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

        "uses_downloaded_source":
            file_ok(
                downloaded_source_path(
                    video_id
                )
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
# RUN
# =========================================================

if __name__ == "__main__":

    import uvicorn

    print()
    print(
        "=================================="
    )
    print(
        "REUP AI DASHBOARD V12 · LOGIN"
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
