import hashlib
import json
import threading
import uuid
from datetime import datetime
from pathlib import Path

from services.source_db import get_connection


ACTIVE_JOB_STATUSES = ("queued", "processing", "stopping")
_schema_lock = threading.Lock()
_schema_ready = False


class ActiveJobExists(RuntimeError):
    def __init__(self, job):
        self.job = dict(job)
        super().__init__("Video này đã có job đang chạy.")


def canonical_job_config(config) -> tuple[str, str]:
    """Return an immutable JSON snapshot and its stable fingerprint."""
    payload = config if isinstance(config, dict) else {}
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return encoded, hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def ensure_job_schema():
    """Create/migrate the local job tables without destroying user data."""
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        conn = get_connection()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_key TEXT UNIQUE,
                    platform_video_id TEXT NOT NULL,
                    channel_key TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    stage TEXT,
                    progress INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT,
                    source_path TEXT,
                    output_path TEXT,
                    created_by INTEGER,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    started_at TEXT,
                    completed_at TEXT,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    config_json TEXT,
                    config_fingerprint TEXT,
                    request_url TEXT
                )
                """
            )
            columns = {
                row["name"]
                for row in conn.execute("PRAGMA table_info(jobs)").fetchall()
            }
            additions = {
                "config_json": "TEXT",
                "config_fingerprint": "TEXT",
                "request_url": "TEXT",
            }
            for name, sql_type in additions.items():
                if name not in columns:
                    conn.execute(f"ALTER TABLE jobs ADD COLUMN {name} {sql_type}")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS video_files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform_video_id TEXT NOT NULL,
                    job_id INTEGER,
                    file_type TEXT NOT NULL,
                    path TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(platform_video_id, file_type, path),
                    FOREIGN KEY(job_id) REFERENCES jobs(id)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_video ON jobs(platform_video_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_jobs_fingerprint "
                "ON jobs(platform_video_id, mode, config_fingerprint)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_video_files_video "
                "ON video_files(platform_video_id)"
            )
            conn.commit()
            _schema_ready = True
        finally:
            conn.close()


def now():
    return datetime.now().isoformat(
        timespec="seconds"
    )


def clamp_percent(value):
    try:
        value = int(
            float(
                value
            )
        )
    except Exception:
        value = 0

    return max(
        0,
        min(
            value,
            100,
        ),
    )


def create_job(
    *,
    platform_video_id: str,
    channel_key: str,
    mode: str,
    created_by=None,
    source_path=None,
    config=None,
    request_url=None,
):
    job_key = (
        f"{platform_video_id}:"
        f"{mode}:"
        f"{uuid.uuid4().hex[:12]}"
    )

    ensure_job_schema()
    config_json, config_fingerprint = canonical_job_config(config)
    conn = get_connection()

    try:
        # Serialize the duplicate check and insert across threads/processes.
        # The in-memory guard in server.py remains useful for a fast response,
        # while this transaction is the authoritative protection.
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            """
            SELECT id, job_key, platform_video_id, channel_key, mode,
                   status, stage, progress, created_at, updated_at
            FROM jobs
            WHERE platform_video_id = ?
              AND status IN ('queued', 'processing', 'stopping')
            ORDER BY id DESC
            LIMIT 1
            """,
            (platform_video_id,),
        ).fetchone()
        if existing:
            conn.rollback()
            raise ActiveJobExists(existing)
        cursor = conn.execute(
            """
            INSERT INTO jobs (
                job_key,
                platform_video_id,
                channel_key,
                mode,
                status,
                stage,
                progress,
                source_path,
                created_by,
                created_at,
                updated_at,
                config_json,
                config_fingerprint,
                request_url
            )
            VALUES (
                ?, ?, ?, ?,
                'queued',
                'queued',
                0,
                ?, ?, ?, ?, ?, ?, ?
            )
            """,
            (
                job_key,
                platform_video_id,
                channel_key,
                mode,
                str(source_path)
                if source_path
                else None,
                created_by,
                now(),
                now(),
                config_json,
                config_fingerprint,
                str(request_url or ""),
            ),
        )

        job_id = (
            cursor.lastrowid
        )

        conn.commit()

        return {
            "id":
                job_id,

            "job_key":
                job_key,

            "config_fingerprint":
                config_fingerprint,
        }

    finally:
        conn.close()


def mark_job_started(
    job_id: int,
):
    conn = get_connection()

    try:
        conn.execute(
            """
            UPDATE jobs
            SET
                status = 'processing',
                stage = 'starting',
                progress = CASE
                    WHEN progress < 1
                    THEN 1
                    ELSE progress
                END,
                started_at = COALESCE(
                    started_at,
                    ?
                ),
                updated_at = ?
            WHERE id = ?
            """,
            (
                now(),
                now(),
                int(
                    job_id
                ),
            ),
        )

        conn.commit()

    finally:
        conn.close()


def update_job_progress(
    job_id: int,
    *,
    status=None,
    stage=None,
    progress=None,
):
    fields = []
    params = []

    if status:
        fields.append(
            "status = ?"
        )
        params.append(
            str(
                status
            )
        )

    if stage:
        fields.append(
            "stage = ?"
        )
        params.append(
            str(
                stage
            )
        )

    if progress is not None:
        fields.append(
            "progress = ?"
        )
        params.append(
            clamp_percent(
                progress
            )
        )

    fields.append(
        "updated_at = ?"
    )
    params.append(
        now()
    )

    params.append(
        int(
            job_id
        )
    )

    conn = get_connection()

    try:
        conn.execute(
            f"""
            UPDATE jobs
            SET {", ".join(fields)}
            WHERE id = ?
            """,
            tuple(
                params
            ),
        )

        conn.commit()

    finally:
        conn.close()


def complete_job(
    job_id: int,
    *,
    output_path=None,
):
    conn = get_connection()

    try:
        conn.execute(
            """
            UPDATE jobs
            SET
                status = 'completed',
                stage = 'completed',
                progress = 100,
                output_path = ?,
                error_message = NULL,
                completed_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                str(
                    output_path
                )
                if output_path
                else None,
                now(),
                now(),
                int(
                    job_id
                ),
            ),
        )

        conn.commit()

    finally:
        conn.close()


def fail_job(
    job_id: int,
    *,
    message: str,
    stage="failed",
):
    conn = get_connection()

    try:
        conn.execute(
            """
            UPDATE jobs
            SET
                status = 'failed',
                stage = ?,
                error_message = ?,
                completed_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                str(
                    stage
                ),
                str(
                    message
                )[:4000],
                now(),
                now(),
                int(
                    job_id
                ),
            ),
        )

        conn.commit()

    finally:
        conn.close()


def register_video_file(
    *,
    platform_video_id: str,
    file_type: str,
    path,
    job_id=None,
):
    ensure_job_schema()
    path = Path(
        path
    )

    if (
        not path.exists()
        or not path.is_file()
    ):
        return None

    size = (
        path
        .stat()
        .st_size
    )

    conn = get_connection()

    try:
        existing = conn.execute(
            """
            SELECT id
            FROM video_files
            WHERE
                platform_video_id = ?
                AND file_type = ?
                AND path = ?
            LIMIT 1
            """,
            (
                platform_video_id,
                file_type,
                str(
                    path
                ),
            ),
        ).fetchone()

        if existing:
            conn.execute(
                """
                UPDATE video_files
                SET
                    job_id = COALESCE(
                        ?,
                        job_id
                    ),
                    size_bytes = ?
                WHERE id = ?
                """,
                (
                    job_id,
                    size,
                    existing[
                        "id"
                    ],
                ),
            )

            file_id = (
                existing[
                    "id"
                ]
            )

        else:
            cursor = conn.execute(
                """
                INSERT INTO video_files (
                    platform_video_id,
                    job_id,
                    file_type,
                    path,
                    size_bytes,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    platform_video_id,
                    job_id,
                    file_type,
                    str(
                        path
                    ),
                    size,
                    now(),
                ),
            )

            file_id = (
                cursor.lastrowid
            )

        conn.commit()

        return file_id

    finally:
        conn.close()


def update_source_video_state(
    *,
    platform_video_id: str,
    status: str,
    job_id=None,
):
    conn = get_connection()

    try:
        conn.execute(
            """
            UPDATE source_videos
            SET
                status = ?,
                job_id = ?,
                updated_at = ?
            WHERE platform_video_id = ?
            """,
            (
                status,
                str(
                    job_id
                )
                if job_id
                is not None
                else None,
                now(),
                platform_video_id,
            ),
        )

        conn.commit()

    finally:
        conn.close()


def list_active_jobs(
    limit=20,
    created_by=None,
):
    ensure_job_schema()
    conn = get_connection()

    try:
        where_owner = ""
        params = []
        if created_by is not None:
            where_owner = " AND created_by = ?"
            params.append(int(created_by))
        params.append(int(limit))
        rows = conn.execute(
            f"""
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
                updated_at
                ,config_fingerprint
            FROM jobs
            WHERE status IN (
                'queued',
                'processing',
                'stopping'
            ){where_owner}
            ORDER BY id DESC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()

        return [
            dict(
                row
            )
            for row in rows
        ]

    finally:
        conn.close()


def file_stats():
    ensure_job_schema()
    conn = get_connection()

    try:
        row = conn.execute(
            """
            SELECT
                COUNT(
                    DISTINCT CASE
                        WHEN file_type = 'source'
                        THEN platform_video_id
                    END
                ) AS downloaded,

                COUNT(
                    DISTINCT CASE
                        WHEN file_type IN (
                            'final_sub',
                            'final_voice'
                        )
                        THEN
                            platform_video_id
                            || ':'
                            || file_type
                    END
                ) AS outputs,

                COALESCE(
                    SUM(size_bytes),
                    0
                ) AS storage_bytes
            FROM video_files
            """
        ).fetchone()

        if not row:
            return {
                "downloaded":
                    0,
                "outputs":
                    0,
                "storage_bytes":
                    0,
            }

        return {
            "downloaded":
                int(
                    row[
                        "downloaded"
                    ]
                    or 0
                ),

            "outputs":
                int(
                    row[
                        "outputs"
                    ]
                    or 0
                ),

            "storage_bytes":
                int(
                    row[
                        "storage_bytes"
                    ]
                    or 0
                ),
        }

    finally:
        conn.close()


def recover_interrupted_jobs():
    """Close jobs orphaned by a previous Engine process.

    The pipeline has stage caches but is not transactionally resumable yet.
    Marking the old execution as ``interrupted`` prevents it from appearing
    active forever. A new request can safely reuse valid stage outputs while
    receiving a fresh immutable configuration snapshot.
    """
    ensure_job_schema()
    conn = get_connection()

    try:
        conn.execute(
            """
            UPDATE source_videos
            SET status = 'interrupted', updated_at = ?
            WHERE platform_video_id IN (
                SELECT platform_video_id
                FROM jobs
                WHERE status IN ('queued', 'processing', 'stopping')
            )
            """,
            (now(),),
        )
        cursor = conn.execute(
            """
            UPDATE jobs
            SET
                status = 'interrupted',
                stage = 'interrupted',
                error_message =
                    'Local Engine đã khởi động lại trước khi job hoàn tất. Có thể chạy lại job để tiếp tục từ cache hợp lệ.',
                completed_at = ?,
                updated_at = ?
            WHERE status IN (
                'queued',
                'processing',
                'stopping'
            )
            """,
            (
                now(),
                now(),
            ),
        )

        conn.commit()

        return int(
            cursor.rowcount
            or 0
        )

    finally:
        conn.close()
