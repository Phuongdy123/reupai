import json
import re
import sqlite3
import unicodedata
from datetime import datetime
from pathlib import Path

from services.source_db import (
    get_connection,
)
from runtime_paths import get_channels_dir, get_downloads_dir


APP_DIR = (
    Path(__file__)
    .resolve()
    .parent
    .parent
)

DOWNLOAD_ROOT = get_downloads_dir() / "demo"

CHANNELS_ROOT = get_channels_dir()


# =========================================================
# BASIC
# =========================================================

def now():
    return (
        datetime.now()
        .isoformat(
            timespec="seconds"
        )
    )


def row_dict(
    row,
):
    if row is None:
        return None

    return dict(
        row
    )


def table_columns(
    conn,
    table_name,
):
    rows = (
        conn.execute(
            f"PRAGMA table_info({table_name})"
        )
        .fetchall()
    )

    return {
        row["name"]
        for row in rows
    }


# =========================================================
# SCHEMA
# =========================================================

def ensure_schema():

    conn = get_connection()

    try:

        cursor = conn.cursor()

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS library_videos (
                platform_video_id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                url TEXT NOT NULL,
                title TEXT,
                cover_url TEXT,
                source_id INTEGER,
                source_name TEXT,
                source_type TEXT NOT NULL DEFAULT 'source',
                channel_key TEXT,
                published_at TEXT,
                play_count INTEGER NOT NULL DEFAULT 0,
                like_count INTEGER NOT NULL DEFAULT 0,
                comment_count INTEGER NOT NULL DEFAULT 0,
                share_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

        # setup_v12 da co favorites. Lenh nay chi tao neu chua co.
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                platform_video_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'favorite',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, platform_video_id)
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, name)
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS collection_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                platform_video_id TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                added_at TEXT NOT NULL,
                UNIQUE(
                    collection_id,
                    platform_video_id
                ),
                FOREIGN KEY(collection_id)
                    REFERENCES collections(id)
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS ui_state (
                user_id INTEGER NOT NULL,
                state_key TEXT NOT NULL,
                value_json TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(user_id, state_key)
            )
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_library_videos_source
            ON library_videos(source_id)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_library_videos_updated
            ON library_videos(updated_at)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_collection_videos_collection
            ON collection_videos(collection_id)
            """
        )

        conn.commit()

    finally:
        conn.close()


# =========================================================
# VIDEO UPSERT
# =========================================================

def upsert_video(
    *,
    video_id,
    platform,
    url,
    title="",
    cover_url="",
    source_id=None,
    source_name=None,
    source_type="source",
    channel_key=None,
    published_at=None,
    play_count=0,
    like_count=0,
    comment_count=0,
    share_count=0,
):

    ensure_schema()

    video_id = str(
        video_id
    ).strip()

    if not video_id:
        raise ValueError(
            "video_id rong."
        )

    conn = get_connection()

    try:

        stamp = now()

        existing = (
            conn.execute(
                """
                SELECT *
                FROM library_videos
                WHERE platform_video_id = ?
                """,
                (
                    video_id,
                ),
            )
            .fetchone()
        )

        if existing:

            current = dict(
                existing
            )

            conn.execute(
                """
                UPDATE library_videos
                SET
                    platform = ?,
                    url = ?,
                    title = ?,
                    cover_url = ?,
                    source_id = ?,
                    source_name = ?,
                    source_type = ?,
                    channel_key = ?,
                    published_at = ?,
                    play_count = ?,
                    like_count = ?,
                    comment_count = ?,
                    share_count = ?,
                    updated_at = ?
                WHERE platform_video_id = ?
                """,
                (
                    platform
                    or current.get("platform")
                    or "unknown",

                    url
                    or current.get("url")
                    or "",

                    title
                    or current.get("title")
                    or "",

                    cover_url
                    or current.get("cover_url")
                    or "",

                    (
                        source_id
                        if source_id is not None
                        else current.get("source_id")
                    ),

                    source_name
                    or current.get("source_name"),

                    source_type
                    or current.get("source_type")
                    or "source",

                    channel_key
                    or current.get("channel_key"),

                    published_at
                    or current.get("published_at"),

                    int(
                        play_count
                        or current.get("play_count")
                        or 0
                    ),

                    int(
                        like_count
                        or current.get("like_count")
                        or 0
                    ),

                    int(
                        comment_count
                        or current.get("comment_count")
                        or 0
                    ),

                    int(
                        share_count
                        or current.get("share_count")
                        or 0
                    ),

                    stamp,
                    video_id,
                ),
            )

        else:

            conn.execute(
                """
                INSERT INTO library_videos (
                    platform_video_id,
                    platform,
                    url,
                    title,
                    cover_url,
                    source_id,
                    source_name,
                    source_type,
                    channel_key,
                    published_at,
                    play_count,
                    like_count,
                    comment_count,
                    share_count,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?
                )
                """,
                (
                    video_id,
                    platform or "unknown",
                    url or "",
                    title or "",
                    cover_url or "",
                    source_id,
                    source_name,
                    source_type or "source",
                    channel_key,
                    published_at,
                    int(play_count or 0),
                    int(like_count or 0),
                    int(comment_count or 0),
                    int(share_count or 0),
                    stamp,
                    stamp,
                ),
            )

        conn.commit()

    finally:
        conn.close()


def upsert_video_dict(
    video,
    *,
    source_id=None,
    source_name=None,
    source_type=None,
    channel_key=None,
):

    upsert_video(
        video_id=
            video.get(
                "video_id"
            )
            or video.get(
                "platform_video_id"
            ),

        platform=
            video.get(
                "platform",
                "unknown",
            ),

        url=
            video.get(
                "url",
                "",
            ),

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

        source_id=
            (
                source_id
                if source_id is not None
                else video.get(
                    "source_id"
                )
            ),

        source_name=
            (
                source_name
                if source_name is not None
                else video.get(
                    "source_name"
                )
            ),

        source_type=
            (
                source_type
                or video.get(
                    "source_type"
                )
                or "source"
            ),

        channel_key=
            (
                channel_key
                or video.get(
                    "channel_key"
                )
            ),

        published_at=
            video.get(
                "published_at"
            ),

        play_count=
            video.get(
                "play_count",
                0,
            ),

        like_count=
            video.get(
                "like_count",
                0,
            ),

        comment_count=
            video.get(
                "comment_count",
                0,
            ),

        share_count=
            video.get(
                "share_count",
                0,
            ),
    )


def sync_source_videos():

    ensure_schema()

    conn = get_connection()

    try:

        rows = (
            conn.execute(
                """
                SELECT
                    sv.*,
                    s.platform AS source_platform,
                    s.name AS source_name,
                    s.channel_key AS source_channel
                FROM source_videos sv
                JOIN sources s
                    ON s.id = sv.source_id
                ORDER BY sv.id DESC
                """
            )
            .fetchall()
        )

    finally:
        conn.close()

    for row in rows:

        item = dict(
            row
        )

        upsert_video(
            video_id=
                item[
                    "platform_video_id"
                ],

            platform=
                item.get(
                    "source_platform"
                )
                or "unknown",

            url=
                item.get(
                    "url"
                )
                or "",

            title=
                item.get(
                    "title"
                )
                or "",

            cover_url=
                item.get(
                    "cover_url"
                )
                or "",

            source_id=
                item.get(
                    "source_id"
                ),

            source_name=
                item.get(
                    "source_name"
                ),

            source_type=
                "source",

            channel_key=
                item.get(
                    "source_channel"
                ),

            published_at=
                item.get(
                    "published_at"
                ),

            play_count=
                item.get(
                    "play_count"
                )
                or 0,

            like_count=
                item.get(
                    "like_count"
                )
                or 0,

            comment_count=
                item.get(
                    "comment_count"
                )
                or 0,

            share_count=
                item.get(
                    "share_count"
                )
                or 0,
        )


# =========================================================
# SERIES DETECTION
# =========================================================

SERIES_PATTERNS = [
    # Chinese season titles such as “《绝命回溯》第二季 11无法醒来”.
    # The season is part of the series key so different seasons stay separate.
    re.compile(
        r"(?P<series>《[^》]{2,80}》)\s*第?\s*"
        r"(?P<season>[\d一二三四五六七八九十]{1,3})\s*季\s*(?:第\s*)?"
        r"(?P<episode>\d{1,4})(?=\D|$)"
    ),

    re.compile(
        r"(?i)\b(?:phần|phan|part|episode|ep|tập|tap)"
        r"\s*[-:#.]?\s*(\d{1,4})\b"
    ),

    re.compile(
        r"第\s*(\d{1,4})\s*[集话話期部]"
    ),

    re.compile(
        r"(?<!\d)(\d{1,4})\s*/\s*\d{1,4}(?!\d)"
    ),

    # Chinese titles often encode a playlist as “系列之…”, without an
    # explicit episode number. Keep the shared series name for grouping.
    re.compile(
        r"(?P<series>[\u4e00-\u9fffA-Za-z0-9]{2,40}系列)"
        r"(?:之|：|:|\s|《)"
    ),
]


def normalize_spaces(
    value,
):
    return re.sub(
        r"\s+",
        " ",
        str(
            value
            or ""
        ),
    ).strip()


def clean_series_base(
    text,
):
    value = normalize_spaces(
        text
    )

    value = re.sub(
        r"[\s\-–—:：#|/\\]+$",
        "",
        value,
    )

    value = re.sub(
        r"^[\s\-–—:：#|/\\]+",
        "",
        value,
    )

    return normalize_spaces(
        value
    )


def detect_series(
    title,
):

    original = normalize_spaces(
        title
    )

    if not original:
        return {
            "series_name":
                None,

            "series_key":
                None,

            "episode_number":
                None,

            "episode_label":
                None,
        }

    for pattern in SERIES_PATTERNS:

        match = pattern.search(
            original
        )

        if not match:
            continue

        groups = match.groupdict()

        if "episode" in groups and groups.get("episode"):
            base = clean_series_base(
                f"{match.group('series')} 第{match.group('season')}季"
            )
            key = re.sub(
                r"[^\w\u4e00-\u9fff]+",
                " ",
                unicodedata.normalize("NFKC", base).casefold(),
            )
            episode = int(groups["episode"])
            return {
                "series_name": base,
                "series_key": normalize_spaces(key),
                "episode_number": episode,
                "episode_label": str(episode),
            }

        if "series" in groups:
            base = clean_series_base(match.group("series"))
            key = re.sub(
                r"[^\w\u4e00-\u9fff]+",
                " ",
                unicodedata.normalize("NFKC", base).casefold(),
            )
            return {
                "series_name": base,
                "series_key": normalize_spaces(key),
                "episode_number": None,
                "episode_label": None,
            }

        episode = int(match.group(1))

        base = (
            original[
                :match.start()
            ]
            + " "
            + original[
                match.end():
            ]
        )

        base = clean_series_base(
            base
        )

        if len(base) < 2:
            continue

        key = (
            unicodedata.normalize(
                "NFKC",
                base,
            )
            .casefold()
        )

        key = re.sub(
            r"[^\w\u4e00-\u9fff]+",
            " ",
            key,
        )

        key = normalize_spaces(
            key
        )

        return {
            "series_name":
                base,

            "series_key":
                key,

            "episode_number":
                episode,

            "episode_label":
                str(
                    episode
                ),
        }

    # Trung: 上集 / 下集.
    for token, number in (
        ("上集", 1),
        ("下集", 2),
        ("上篇", 1),
        ("下篇", 2),
    ):

        if token in original:

            base = clean_series_base(
                original.replace(
                    token,
                    " ",
                )
            )

            if len(base) < 2:
                break

            key = (
                unicodedata.normalize(
                    "NFKC",
                    base,
                )
                .casefold()
            )

            key = re.sub(
                r"[^\w\u4e00-\u9fff]+",
                " ",
                key,
            )

            key = normalize_spaces(
                key
            )

            return {
                "series_name":
                    base,

                "series_key":
                    key,

                "episode_number":
                    number,

                "episode_label":
                    token,
            }

    return {
        "series_name":
            None,

        "series_key":
            None,

        "episode_number":
            None,

        "episode_label":
            None,
    }


# =========================================================
# LOCAL STATUS
# =========================================================

def local_video_state(
    video_id,
    channel_key=None,
):

    video_id = str(
        video_id
    )

    downloaded = False

    source_folder = (
        DOWNLOAD_ROOT
        / video_id
    )

    for suffix in (
        "mp4",
        "mkv",
        "webm",
        "mov",
    ):

        path = (
            source_folder
            / f"source.{suffix}"
        )

        if (
            path.exists()
            and path.is_file()
            and path.stat().st_size > 0
        ):
            downloaded = True
            break

    channels = []

    if channel_key:
        channels.append(
            channel_key
        )

    for name in (
        "2d_animation",
        "3d_animation",
        "comedy",
    ):

        if name not in channels:
            channels.append(
                name
            )

    has_subtitle = False
    has_voice = False
    resolved_channel = (
        channel_key
        or "2d_animation"
    )

    for channel in channels:

        job_dir = (
            CHANNELS_ROOT
            / channel
            / "jobs"
            / video_id
        )

        if (
            job_dir
            / "final_sub.mp4"
        ).exists():

            has_subtitle = True
            resolved_channel = channel

        if (
            job_dir
            / "final_voice.mp4"
        ).exists():

            has_voice = True
            resolved_channel = channel

        if (
            has_subtitle
            and has_voice
        ):
            break

    processing = False
    db_status = None

    conn = get_connection()

    try:

        # Neu jobs table chua duoc migrate thi bo qua.
        tables = {
            row["name"]
            for row in conn.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                """
            ).fetchall()
        }

        if "jobs" in tables:

            row = (
                conn.execute(
                    """
                    SELECT status
                    FROM jobs
                    WHERE platform_video_id = ?
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (
                        video_id,
                    ),
                )
                .fetchone()
            )

            if row:

                db_status = (
                    row[
                        "status"
                    ]
                )

                processing = (
                    db_status
                    in {
                        "queued",
                        "processing",
                        "running",
                    }
                )

    finally:
        conn.close()

    return {
        "downloaded":
            downloaded,

        "has_subtitle_result":
            has_subtitle,

        "has_voice_result":
            has_voice,

        "processing":
            processing,

        "db_status":
            db_status,

        "channel_key":
            resolved_channel,
    }


# =========================================================
# FAVORITES
# =========================================================

def is_favorite(
    user_id,
    video_id,
):

    ensure_schema()

    conn = get_connection()

    try:

        row = (
            conn.execute(
                """
                SELECT id
                FROM favorites
                WHERE user_id = ?
                AND platform_video_id = ?
                LIMIT 1
                """,
                (
                    int(
                        user_id
                    ),
                    str(
                        video_id
                    ),
                ),
            )
            .fetchone()
        )

        return bool(
            row
        )

    finally:
        conn.close()


def toggle_favorite(
    user_id,
    video_id,
):

    ensure_schema()

    conn = get_connection()

    try:

        row = (
            conn.execute(
                """
                SELECT id
                FROM favorites
                WHERE user_id = ?
                AND platform_video_id = ?
                LIMIT 1
                """,
                (
                    int(
                        user_id
                    ),
                    str(
                        video_id
                    ),
                ),
            )
            .fetchone()
        )

        if row:

            conn.execute(
                """
                DELETE FROM favorites
                WHERE id = ?
                """,
                (
                    row[
                        "id"
                    ],
                ),
            )

            favorite = False

        else:

            stamp = now()

            columns = table_columns(
                conn,
                "favorites",
            )

            if "status" in columns:

                conn.execute(
                    """
                    INSERT INTO favorites (
                        user_id,
                        platform_video_id,
                        status,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, 'favorite', ?, ?)
                    """,
                    (
                        int(
                            user_id
                        ),
                        str(
                            video_id
                        ),
                        stamp,
                        stamp,
                    ),
                )

            else:

                conn.execute(
                    """
                    INSERT INTO favorites (
                        user_id,
                        platform_video_id,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        int(
                            user_id
                        ),
                        str(
                            video_id
                        ),
                        stamp,
                        stamp,
                    ),
                )

            favorite = True

        conn.commit()

        return favorite

    finally:
        conn.close()


# =========================================================
# COLLECTIONS
# =========================================================

def list_collections(
    user_id,
):

    ensure_schema()

    conn = get_connection()

    try:

        rows = (
            conn.execute(
                """
                SELECT
                    c.*,
                    COUNT(cv.id) AS video_count
                FROM collections c
                LEFT JOIN collection_videos cv
                    ON cv.collection_id = c.id
                WHERE c.user_id = ?
                GROUP BY c.id
                ORDER BY c.updated_at DESC, c.id DESC
                """,
                (
                    int(
                        user_id
                    ),
                ),
            )
            .fetchall()
        )

        return [
            dict(
                row
            )
            for row in rows
        ]

    finally:
        conn.close()


def create_collection(
    user_id,
    name,
    description="",
):

    ensure_schema()

    name = normalize_spaces(
        name
    )

    if not name:
        raise ValueError(
            "Ten danh muc rong."
        )

    conn = get_connection()

    try:

        stamp = now()

        existing = (
            conn.execute(
                """
                SELECT *
                FROM collections
                WHERE user_id = ?
                AND lower(name) = lower(?)
                LIMIT 1
                """,
                (
                    int(
                        user_id
                    ),
                    name,
                ),
            )
            .fetchone()
        )

        if existing:

            return dict(
                existing
            )

        cursor = (
            conn.execute(
                """
                INSERT INTO collections (
                    user_id,
                    name,
                    description,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    int(
                        user_id
                    ),
                    name,
                    description or "",
                    stamp,
                    stamp,
                ),
            )
        )

        conn.commit()

        row = (
            conn.execute(
                """
                SELECT *
                FROM collections
                WHERE id = ?
                """,
                (
                    cursor.lastrowid,
                ),
            )
            .fetchone()
        )

        return dict(
            row
        )

    finally:
        conn.close()


def delete_collection(
    user_id,
    collection_id,
):

    ensure_schema()

    conn = get_connection()

    try:

        owned = (
            conn.execute(
                """
                SELECT id
                FROM collections
                WHERE id = ?
                AND user_id = ?
                """,
                (
                    int(
                        collection_id
                    ),
                    int(
                        user_id
                    ),
                ),
            )
            .fetchone()
        )

        if not owned:
            return False

        conn.execute(
            """
            DELETE FROM collection_videos
            WHERE collection_id = ?
            """,
            (
                int(
                    collection_id
                ),
            ),
        )

        conn.execute(
            """
            DELETE FROM collections
            WHERE id = ?
            """,
            (
                int(
                    collection_id
                ),
            ),
        )

        conn.commit()

        return True

    finally:
        conn.close()


def add_video_to_collection(
    user_id,
    collection_id,
    video_id,
):

    add_videos_to_collection(
        user_id,
        collection_id,
        [
            video_id,
        ],
    )


def add_videos_to_collection(
    user_id,
    collection_id,
    video_ids,
):

    # Keep one transaction for multi-select actions.  A large collection used
    # to open and commit SQLite once for every selected video.
    normalized_ids = list(
        dict.fromkeys(
            str(video_id).strip()
            for video_id in video_ids
            if str(video_id).strip()
        )
    )

    if not normalized_ids:
        return 0

    ensure_schema()

    conn = get_connection()

    try:

        collection = (
            conn.execute(
                """
                SELECT id
                FROM collections
                WHERE id = ?
                AND user_id = ?
                """,
                (
                    int(
                        collection_id
                    ),
                    int(
                        user_id
                    ),
                ),
            )
            .fetchone()
        )

        if not collection:
            raise ValueError(
                "Danh muc khong ton tai."
            )

        stamp = now()

        conn.executemany(
            """
            INSERT OR IGNORE
            INTO collection_videos (
                collection_id,
                platform_video_id,
                added_at
            )
            VALUES (?, ?, ?)
            """,
            [
                (
                    int(
                        collection_id
                    ),
                    video_id,
                    stamp,
                )
                for video_id in normalized_ids
            ],
        )

        conn.execute(
            """
            UPDATE collections
            SET updated_at = ?
            WHERE id = ?
            """,
            (
                stamp,
                int(
                    collection_id
                ),
            ),
        )

        conn.commit()

        return len(
            normalized_ids
        )

    finally:
        conn.close()


def remove_video_from_collection(
    user_id,
    collection_id,
    video_id,
):

    ensure_schema()

    conn = get_connection()

    try:

        collection = (
            conn.execute(
                """
                SELECT id
                FROM collections
                WHERE id = ?
                AND user_id = ?
                """,
                (
                    int(
                        collection_id
                    ),
                    int(
                        user_id
                    ),
                ),
            )
            .fetchone()
        )

        if not collection:
            return False

        conn.execute(
            """
            DELETE FROM collection_videos
            WHERE collection_id = ?
            AND platform_video_id = ?
            """,
            (
                int(
                    collection_id
                ),
                str(
                    video_id
                ),
            ),
        )

        conn.commit()

        return True

    finally:
        conn.close()


def collection_ids_for_video(
    user_id,
    video_id,
):

    ensure_schema()

    conn = get_connection()

    try:

        rows = (
            conn.execute(
                """
                SELECT c.id
                FROM collections c
                JOIN collection_videos cv
                    ON cv.collection_id = c.id
                WHERE c.user_id = ?
                AND cv.platform_video_id = ?
                ORDER BY c.id
                """,
                (
                    int(
                        user_id
                    ),
                    str(
                        video_id
                    ),
                ),
            )
            .fetchall()
        )

        return [
            int(
                row[
                    "id"
                ]
            )
            for row in rows
        ]

    finally:
        conn.close()


# =========================================================
# VIDEO LIST / META
# =========================================================

def list_library_videos(
    user_id,
    *,
    favorite=False,
    collection_id=None,
    source_id=None,
    series_key=None,
    query=None,
    limit=500,
):

    sync_source_videos()

    conn = get_connection()

    try:

        rows = (
            conn.execute(
                """
                SELECT *
                FROM library_videos
                ORDER BY
                    COALESCE(
                        published_at,
                        updated_at
                    ) DESC,
                    updated_at DESC
                LIMIT ?
                """,
                (
                    max(
                        1,
                        min(
                            int(
                                limit
                            ),
                            2000,
                        ),
                    ),
                ),
            )
            .fetchall()
        )

        favorite_rows = (
            conn.execute(
                """
                SELECT platform_video_id
                FROM favorites
                WHERE user_id = ?
                """,
                (
                    int(
                        user_id
                    ),
                ),
            )
            .fetchall()
        )

        favorite_ids = {
            row[
                "platform_video_id"
            ]
            for row in favorite_rows
        }

        collection_video_ids = None

        if collection_id is not None:

            owned = (
                conn.execute(
                    """
                    SELECT id
                    FROM collections
                    WHERE id = ?
                    AND user_id = ?
                    """,
                    (
                        int(
                            collection_id
                        ),
                        int(
                            user_id
                        ),
                    ),
                )
                .fetchone()
            )

            if not owned:
                return []

            member_rows = (
                conn.execute(
                    """
                    SELECT platform_video_id
                    FROM collection_videos
                    WHERE collection_id = ?
                    """,
                    (
                        int(
                            collection_id
                        ),
                    ),
                )
                .fetchall()
            )

            collection_video_ids = {
                row[
                    "platform_video_id"
                ]
                for row
                in member_rows
            }

    finally:
        conn.close()

    result = []

    query_text = (
        normalize_spaces(
            query
        )
        .casefold()
        if query
        else ""
    )

    for row in rows:

        item = dict(
            row
        )

        video_id = (
            item[
                "platform_video_id"
            ]
        )

        if (
            favorite
            and video_id
            not in favorite_ids
        ):
            continue

        if (
            collection_video_ids
            is not None
            and video_id
            not in collection_video_ids
        ):
            continue

        if (
            source_id
            is not None
            and int(
                item.get(
                    "source_id"
                )
                or 0
            )
            != int(
                source_id
            )
        ):
            continue

        series = detect_series(
            item.get(
                "title"
            )
        )

        if (
            series_key
            and series.get(
                "series_key"
            )
            != series_key
        ):
            continue

        if query_text:

            haystack = (
                str(
                    item.get(
                        "title"
                    )
                    or ""
                )
                + " "
                + str(
                    video_id
                )
                + " "
                + str(
                    item.get(
                        "source_name"
                    )
                    or ""
                )
            ).casefold()

            if query_text not in haystack:
                continue

        item[
            "video_id"
        ] = video_id

        item[
            "favorite"
        ] = (
            video_id
            in favorite_ids
        )

        item.update(
            series
        )

        item.update(
            local_video_state(
                video_id,
                item.get(
                    "channel_key"
                ),
            )
        )

        result.append(
            item
        )

    result.sort(
        key=lambda item: (
            (
                item.get(
                    "series_key"
                )
                or ""
            ),
            (
                item.get(
                    "episode_number"
                )
                if item.get(
                    "episode_number"
                )
                is not None
                else 10**9
            ),
            (
                item.get(
                    "published_at"
                )
                or ""
            ),
        )
        if series_key
        else (
            item.get(
                "published_at"
            )
            or item.get(
                "updated_at"
            )
            or ""
        ),
        reverse=(
            False
            if series_key
            else True
        ),
    )

    return result


def library_meta(
    user_id,
    video_ids,
):

    ensure_schema()

    ids = [
        str(
            value
        )
        for value
        in video_ids
        if str(
            value
        ).strip()
    ]

    if not ids:
        return {}

    conn = get_connection()

    try:

        placeholders = ",".join(
            "?"
            for _ in ids
        )

        favorite_rows = (
            conn.execute(
                f"""
                SELECT platform_video_id
                FROM favorites
                WHERE user_id = ?
                AND platform_video_id
                    IN ({placeholders})
                """,
                (
                    int(
                        user_id
                    ),
                    *ids,
                ),
            )
            .fetchall()
        )

        favorite_ids = {
            row[
                "platform_video_id"
            ]
            for row in favorite_rows
        }

        collection_rows = (
            conn.execute(
                f"""
                SELECT
                    cv.platform_video_id,
                    c.id AS collection_id
                FROM collection_videos cv
                JOIN collections c
                    ON c.id = cv.collection_id
                WHERE c.user_id = ?
                AND cv.platform_video_id
                    IN ({placeholders})
                """,
                (
                    int(
                        user_id
                    ),
                    *ids,
                ),
            )
            .fetchall()
        )

    finally:
        conn.close()

    collection_map = {
        video_id:
            []
        for video_id in ids
    }

    for row in collection_rows:

        collection_map.setdefault(
            row[
                "platform_video_id"
            ],
            [],
        ).append(
            int(
                row[
                    "collection_id"
                ]
            )
        )

    return {
        video_id: {
            "favorite":
                (
                    video_id
                    in favorite_ids
                ),

            "collection_ids":
                collection_map.get(
                    video_id,
                    [],
                ),
        }
        for video_id in ids
    }


def list_series(
    user_id,
):

    videos = (
        list_library_videos(
            user_id,
            limit=2000,
        )
    )

    groups = {}

    for video in videos:

        key = (
            video.get(
                "series_key"
            )
        )

        name = (
            video.get(
                "series_name"
            )
        )

        if not key or not name:
            continue

        group = (
            groups.setdefault(
                key,
                {
                    "series_key":
                        key,

                    "name":
                        name,

                    "count":
                        0,

                    "episodes":
                        [],

                    "sources":
                        [],

                    "source_label":
                        "",
                },
            )
        )

        group[
            "count"
        ] += 1

        if (
            video.get(
                "episode_number"
            )
            is not None
        ):

            group[
                "episodes"
            ].append(
                int(
                    video[
                        "episode_number"
                    ]
                )
            )

        source_name = (
            str(
                video.get("source_name")
                or video.get("channel_name")
                or video.get("platform")
                or "Nguồn không tên"
            ).strip()
        )

        source_id = video.get("source_id")
        source_key = f"{source_id or ''}:{source_name.casefold()}"

        if not any(
            item.get("key") == source_key
            for item in group["sources"]
        ):
            group["sources"].append(
                {
                    "key": source_key,
                    "name": source_name,
                    "source_id": source_id,
                    "platform": video.get("platform") or "",
                }
            )

    # Chi hien series co tu 2 video.
    result = [
        item
        for item in groups.values()
        if item[
            "count"
        ] >= 2
    ]

    for item in result:

        item[
            "episodes"
        ] = sorted(
            set(
                item[
                    "episodes"
                ]
            )
        )

        item["sources"] = sorted(
            item.get("sources") or [],
            key=lambda source: str(source.get("name") or "").casefold(),
        )
        item["source_label"] = " / ".join(
            str(source.get("name") or "Nguồn không tên")
            for source in item["sources"]
        )

    result.sort(
        key=lambda item: (
            -int(
                item[
                    "count"
                ]
            ),
            item[
                "name"
            ].casefold(),
        )
    )

    return result


# =========================================================
# UI STATE OPTIONAL DB BACKUP
# =========================================================

def save_ui_state(
    user_id,
    key,
    value,
):

    ensure_schema()

    conn = get_connection()

    try:

        stamp = now()

        conn.execute(
            """
            INSERT INTO ui_state (
                user_id,
                state_key,
                value_json,
                updated_at
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(
                user_id,
                state_key
            )
            DO UPDATE SET
                value_json =
                    excluded.value_json,
                updated_at =
                    excluded.updated_at
            """,
            (
                int(
                    user_id
                ),
                str(
                    key
                ),
                json.dumps(
                    value,
                    ensure_ascii=False,
                ),
                stamp,
            ),
        )

        conn.commit()

    finally:
        conn.close()


def load_ui_state(
    user_id,
    key,
):

    ensure_schema()

    conn = get_connection()

    try:

        row = (
            conn.execute(
                """
                SELECT value_json
                FROM ui_state
                WHERE user_id = ?
                AND state_key = ?
                """,
                (
                    int(
                        user_id
                    ),
                    str(
                        key
                    ),
                ),
            )
            .fetchone()
        )

        if not row:
            return None

        try:
            return json.loads(
                row[
                    "value_json"
                ]
                or "null"
            )

        except Exception:
            return None

    finally:
        conn.close()


ensure_schema()
