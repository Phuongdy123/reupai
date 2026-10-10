import sqlite3
from pathlib import Path
from datetime import datetime

from runtime_paths import (
    APP_DIR,
    get_channels_dir,
    get_data_dir,
)

APP_DIR = Path(__file__).resolve().parent.parent

DATA_DIR = get_data_dir()

DB_PATH = DATA_DIR / "reup.db"

CHANNELS_DIR = get_channels_dir()


def now():
    return datetime.now().isoformat(
        timespec="seconds"
    )


def get_connection():

    DATA_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    conn = sqlite3.connect(
        DB_PATH
    )

    conn.row_factory = (
        sqlite3.Row
    )

    return conn


def init_db():

    conn = get_connection()

    cursor = conn.cursor()

    # Authentication is kept in the same local database so every browser
    # session can resolve its own user_id without depending on the cloud.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            enabled INTEGER NOT NULL DEFAULT 1,
            email_verified INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_login_at TEXT
        )
    """)

    user_columns = {
        row["name"]
        for row in cursor.execute(
            "PRAGMA table_info(users)"
        ).fetchall()
    }

    if "email" not in user_columns:
        cursor.execute(
            "ALTER TABLE users ADD COLUMN email TEXT"
        )

    if "email_verified" not in user_columns:
        cursor.execute(
            "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0"
        )

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS email_verification_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            code_hash TEXT NOT NULL,
            expires_at REAL NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            consumed_at REAL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_email_codes_user
        ON email_verification_codes(user_id, expires_at)
    """)

    # =====================================
    # CHANNELS
    # =====================================

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS channels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            channel_key TEXT NOT NULL UNIQUE,

            name TEXT NOT NULL,

            enabled INTEGER NOT NULL DEFAULT 1,

            created_at TEXT NOT NULL
        )
    """)

    # =====================================
    # SOURCES
    # =====================================

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            platform TEXT NOT NULL,

            name TEXT NOT NULL,

            profile_url TEXT NOT NULL,

            cover_url TEXT NOT NULL DEFAULT '',

            channel_key TEXT NOT NULL,

            source_type TEXT NOT NULL DEFAULT 'public',

            enabled INTEGER NOT NULL DEFAULT 1,

            auto_process INTEGER NOT NULL DEFAULT 0,

            process_mode TEXT NOT NULL DEFAULT 'new',

            min_views INTEGER NOT NULL DEFAULT 0,

            last_checked_at TEXT,

            last_video_id TEXT,

            created_at TEXT NOT NULL,

            UNIQUE(
                platform,
                profile_url,
                channel_key
            )
        )
    """)

    source_columns = {
        row["name"]
        for row in cursor.execute(
            "PRAGMA table_info(sources)"
        ).fetchall()
    }

    if "cover_url" not in source_columns:
        cursor.execute(
            "ALTER TABLE sources ADD COLUMN cover_url TEXT NOT NULL DEFAULT ''"
        )

    # =====================================
    # SOURCE VIDEOS
    # =====================================

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS source_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            source_id INTEGER NOT NULL,

            platform_video_id TEXT NOT NULL,

            url TEXT NOT NULL,

            title TEXT,

            cover_url TEXT,

            published_at TEXT,

            play_count INTEGER DEFAULT 0,

            like_count INTEGER DEFAULT 0,

            comment_count INTEGER DEFAULT 0,

            share_count INTEGER DEFAULT 0,

            hot_score REAL DEFAULT 0,

            status TEXT NOT NULL DEFAULT 'new',

            job_id TEXT,

            first_seen_at TEXT NOT NULL,

            updated_at TEXT NOT NULL,

            UNIQUE(
                source_id,
                platform_video_id
            ),

            FOREIGN KEY(source_id)
                REFERENCES sources(id)
        )
    """)

    # Cache the latest sync result by normalized profile URL so channels
    # remain usable without being added to the tracked-sources list.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS source_sync_cache (
            profile_key TEXT PRIMARY KEY,
            platform TEXT NOT NULL,
            profile_url TEXT NOT NULL,
            videos_json TEXT NOT NULL DEFAULT '[]',
            total INTEGER,
            has_more INTEGER NOT NULL DEFAULT 1,
            checked_at REAL NOT NULL
        )
    """)

    conn.commit()

    conn.close()

    print(
        f"Database ready: {DB_PATH}"
    )


def create_channel(
    channel_key,
    name
):

    channel_key = (
        channel_key
        .strip()
        .lower()
        .replace(" ", "_")
    )

    conn = get_connection()

    try:

        conn.execute(
            """
            INSERT INTO channels (
                channel_key,
                name,
                created_at
            )
            VALUES (?, ?, ?)
            """,
            (
                channel_key,
                name,
                now()
            )
        )

        conn.commit()

    except sqlite3.IntegrityError:

        print(
            "Channel da ton tai."
        )

    finally:

        conn.close()

    job_dir = (
        CHANNELS_DIR
        / channel_key
        / "jobs"
    )

    job_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    return channel_key


def list_channels():

    conn = get_connection()

    rows = conn.execute(
        """
        SELECT *
        FROM channels
        ORDER BY id
        """
    ).fetchall()

    conn.close()

    return [
        dict(row)
        for row in rows
    ]


def add_source(
    platform,
    name,
    profile_url,
    channel_key,
    source_type="public",
    auto_process=False,
    process_mode="new",
    min_views=0,
    cover_url="",
):

    platform = (
        platform
        .strip()
        .lower()
    )

    conn = get_connection()

    channel = conn.execute(
        """
        SELECT id
        FROM channels
        WHERE channel_key = ?
        """,
        (
            channel_key,
        )
    ).fetchone()

    if not channel:

        conn.close()

        raise ValueError(
            f"Channel khong ton tai: "
            f"{channel_key}"
        )

    try:

        cursor = conn.execute(
            """
            INSERT INTO sources (
                platform,
                name,
                profile_url,
                cover_url,
                channel_key,
                source_type,
                auto_process,
                process_mode,
                min_views,
                created_at
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            """,
            (
                platform,
                name,
                profile_url,
                cover_url or "",
                channel_key,
                source_type,
                int(auto_process),
                process_mode,
                int(min_views),
                now()
            )
        )

        conn.commit()

        source_id = (
            cursor.lastrowid
        )

        print(
            f"Da them source ID "
            f"{source_id}"
        )

        return source_id

    except sqlite3.IntegrityError:

        raise ValueError(
            "Source nay da ton tai "
            "trong channel."
        )

    finally:

        conn.close()


def list_sources(
    channel_key=None
):

    conn = get_connection()

    if channel_key:

        rows = conn.execute(
            """
            SELECT *
            FROM sources
            WHERE channel_key = ?
            ORDER BY id DESC
            """,
            (
                channel_key,
            )
        ).fetchall()

    else:

        rows = conn.execute(
            """
            SELECT *
            FROM sources
            ORDER BY id DESC
            """
        ).fetchall()

    conn.close()

    return [
        dict(row)
        for row in rows
    ]


def remove_source(
    source_id
):

    conn = get_connection()

    conn.execute(
        """
        DELETE FROM sources
        WHERE id = ?
        """,
        (
            source_id,
        )
    )

    conn.commit()

    conn.close()


def save_video(
    source_id,
    platform_video_id,
    url,
    title="",
    cover_url="",
    published_at=None,
    play_count=0,
    like_count=0,
    comment_count=0,
    share_count=0
):

    # score tam thoi
    hot_score = (
        play_count
        + like_count * 8
        + comment_count * 15
        + share_count * 20
    )

    conn = get_connection()

    existing = conn.execute(
        """
        SELECT id
        FROM source_videos
        WHERE source_id = ?
        AND platform_video_id = ?
        """,
        (
            source_id,
            platform_video_id
        )
    ).fetchone()

    if existing:

        conn.execute(
            """
            UPDATE source_videos

            SET
                title = ?,
                cover_url = ?,
                published_at = ?,
                play_count = ?,
                like_count = ?,
                comment_count = ?,
                share_count = ?,
                hot_score = ?,
                updated_at = ?

            WHERE id = ?
            """,
            (
                title,
                cover_url,
                published_at,
                play_count,
                like_count,
                comment_count,
                share_count,
                hot_score,
                now(),
                existing["id"]
            )
        )

        video_id = (
            existing["id"]
        )

    else:

        cursor = conn.execute(
            """
            INSERT INTO source_videos (
                source_id,
                platform_video_id,
                url,
                title,
                cover_url,
                published_at,
                play_count,
                like_count,
                comment_count,
                share_count,
                hot_score,
                status,
                first_seen_at,
                updated_at
            )

            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                'new', ?, ?
            )
            """,
            (
                source_id,
                platform_video_id,
                url,
                title,
                cover_url,
                published_at,
                play_count,
                like_count,
                comment_count,
                share_count,
                hot_score,
                now(),
                now()
            )
        )

        video_id = (
            cursor.lastrowid
        )

    conn.commit()

    conn.close()

    return video_id


def list_videos(
    source_id=None,
    status=None,
    order="new"
):

    conn = get_connection()

    sql = """
        SELECT
            source_videos.*,
            sources.name AS source_name,
            sources.platform,
            sources.channel_key

        FROM source_videos

        JOIN sources
        ON sources.id =
           source_videos.source_id
    """

    conditions = []

    params = []

    if source_id:

        conditions.append(
            "source_id = ?"
        )

        params.append(
            source_id
        )

    if status:

        conditions.append(
            "status = ?"
        )

        params.append(
            status
        )

    if conditions:

        sql += (
            " WHERE "
            + " AND ".join(
                conditions
            )
        )

    if order == "hot":

        sql += (
            " ORDER BY "
            "hot_score DESC"
        )

    else:

        sql += (
            " ORDER BY "
            "published_at DESC, "
            "id DESC"
        )

    rows = conn.execute(
        sql,
        params
    ).fetchall()

    conn.close()

    return [
        dict(row)
        for row in rows
    ]


def update_video_status(
    video_id,
    status,
    job_id=None
):

    conn = get_connection()

    conn.execute(
        """
        UPDATE source_videos

        SET
            status = ?,
            job_id = ?,
            updated_at = ?

        WHERE id = ?
        """,
        (
            status,
            job_id,
            now(),
            video_id
        )
    )

    conn.commit()

    conn.close()
