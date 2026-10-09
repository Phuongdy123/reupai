import getpass
import sys
from pathlib import Path

from pwdlib import PasswordHash


APP_DIR = Path(__file__).resolve().parent.parent

if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from services.source_db import get_connection


password_hash = PasswordHash.recommended()


def migrate_v12():
    conn = get_connection()

    try:
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_login_at TEXT
            )
        """)

        cursor.execute("""
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
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
        """)

        cursor.execute("""
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
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                channel_key TEXT,
                voice TEXT,
                original_volume REAL NOT NULL DEFAULT 0.15,
                voice_volume REAL NOT NULL DEFAULT 1.0,
                font_size INTEGER,
                blur_enabled INTEGER NOT NULL DEFAULT 1,
                config_json TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                platform_video_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'favorite',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, platform_video_id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """)

        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_jobs_video "
            "ON jobs(platform_video_id)"
        )

        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_jobs_status "
            "ON jobs(status)"
        )

        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_video_files_video "
            "ON video_files(platform_video_id)"
        )

        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_favorites_video "
            "ON favorites(platform_video_id)"
        )

        conn.commit()

    finally:
        conn.close()


def create_or_update_admin():
    print()
    print("==================================")
    print("CREATE V12 ADMIN")
    print("==================================")

    username = input(
        "Username [admin]: "
    ).strip() or "admin"

    while True:
        password = getpass.getpass(
            "Password: "
        )

        if len(password) < 8:
            print(
                "Password phải có ít nhất 8 ký tự."
            )
            continue

        confirm = getpass.getpass(
            "Confirm password: "
        )

        if password != confirm:
            print(
                "Password xác nhận không khớp."
            )
            continue

        break

    hashed = password_hash.hash(
        password
    )

    conn = get_connection()

    try:
        existing = conn.execute(
            """
            SELECT id
            FROM users
            WHERE username = ?
            LIMIT 1
            """,
            (
                username,
            ),
        ).fetchone()

        if existing:
            conn.execute(
                """
                UPDATE users
                SET
                    password_hash = ?,
                    role = 'admin',
                    enabled = 1
                WHERE id = ?
                """,
                (
                    hashed,
                    existing["id"],
                ),
            )

            print(
                f"Đã cập nhật admin: {username}"
            )

        else:
            conn.execute(
                """
                INSERT INTO users (
                    username,
                    password_hash,
                    role,
                    enabled
                )
                VALUES (?, ?, 'admin', 1)
                """,
                (
                    username,
                    hashed,
                ),
            )

            print(
                f"Đã tạo admin: {username}"
            )

        conn.commit()

    finally:
        conn.close()


def print_tables():
    conn = get_connection()

    try:
        rows = conn.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            ORDER BY name
            """
        ).fetchall()

        print()
        print("Database tables:")

        for row in rows:
            print(
                " -",
                row["name"],
            )

    finally:
        conn.close()


def print_admins():
    conn = get_connection()

    try:
        rows = conn.execute(
            """
            SELECT id, username, role, enabled, created_at
            FROM users
            ORDER BY id
            """
        ).fetchall()

        print()
        print("Users:")

        for row in rows:
            print(
                f" - id={row['id']} "
                f"username={row['username']} "
                f"role={row['role']} "
                f"enabled={row['enabled']}"
            )

    finally:
        conn.close()


def main():
    migrate_v12()

    print()
    print("V12 database migration: OK")

    create_or_update_admin()

    print_tables()
    print_admins()

    print()
    print("==================================")


if __name__ == "__main__":
    main()
    print("REUP AI V12 DATABASE READY")
    print("==================================")
