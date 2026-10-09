import uuid
from datetime import datetime
from pathlib import Path

from services.source_db import get_connection


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
):
    job_key = (
        f"{platform_video_id}:"
        f"{mode}:"
        f"{uuid.uuid4().hex[:12]}"
    )

    conn = get_connection()

    try:
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
                updated_at
            )
            VALUES (
                ?, ?, ?, ?,
                'queued',
                'queued',
                0,
                ?, ?, ?, ?
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
            FROM jobs
            WHERE status IN (
                'queued',
                'processing'
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
    conn = get_connection()

    try:
        cursor = conn.execute(
            """
            UPDATE jobs
            SET
                status = 'failed',
                stage = 'interrupted',
                error_message =
                    'Server đã khởi động lại trước khi job hoàn tất.',
                completed_at = ?,
                updated_at = ?
            WHERE status IN (
                'queued',
                'processing'
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
