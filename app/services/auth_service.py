import hashlib
import os
import secrets
import smtplib
import time
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

from pwdlib import PasswordHash
from dotenv import load_dotenv

from services.source_db import get_connection

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

password_hash = PasswordHash.recommended()

VERIFICATION_TTL_SECONDS = 10 * 60
MAX_VERIFICATION_ATTEMPTS = 5


def now():
    return datetime.now().isoformat(timespec="seconds")


def get_user_by_username(username: str):
    conn = get_connection()
    try:
        row = conn.execute(
            """
            SELECT *
            FROM users
            WHERE lower(username) = lower(?)
            LIMIT 1
            """,
            (username.strip(),),
        ).fetchone()

        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_id(user_id: int):
    conn = get_connection()
    try:
        row = conn.execute(
            """
            SELECT
                id,
                username,
                email,
                role,
                enabled,
                email_verified,
                created_at,
                last_login_at
            FROM users
            WHERE id = ?
            LIMIT 1
            """,
            (int(user_id),),
        ).fetchone()

        return dict(row) if row else None
    finally:
        conn.close()


def authenticate_user(username: str, password: str):
    user = get_user_by_username(username)

    if not user:
        return None

    if not bool(user.get("enabled", 0)):
        return None

    if user.get("role") != "admin" and not bool(user.get("email_verified", 0)):
        return None

    try:
        valid = password_hash.verify(
            password,
            user["password_hash"],
        )
    except Exception:
        valid = False

    if not valid:
        return None

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE users
            SET last_login_at = ?
            WHERE id = ?
            """,
            (now(), user["id"]),
        )
        conn.commit()
    finally:
        conn.close()

    user.pop("password_hash", None)
    return user


def get_user_by_email(email: str):
    conn = get_connection()
    try:
        row = conn.execute(
            """
            SELECT * FROM users
            WHERE lower(email) = lower(?)
            LIMIT 1
            """,
            (email.strip(),),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_user(username: str, email: str, password: str):
    username = username.strip()
    email = email.strip().lower()
    hashed = password_hash.hash(password)
    conn = get_connection()
    try:
        cursor = conn.execute(
            """
            INSERT INTO users (
                username, email, password_hash, role,
                enabled, email_verified
            ) VALUES (?, ?, ?, 'user', 1, 0)
            """,
            (username, email, hashed),
        )
        conn.commit()
        return get_user_by_id(cursor.lastrowid)
    finally:
        conn.close()


def issue_email_code(user_id: int):
    code = f"{secrets.randbelow(1_000_000):06d}"
    digest = hashlib.sha256(code.encode("utf-8")).hexdigest()
    now_ts = time.time()
    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE email_verification_codes
            SET consumed_at = ?
            WHERE user_id = ? AND consumed_at IS NULL
            """,
            (now_ts, int(user_id)),
        )
        conn.execute(
            """
            INSERT INTO email_verification_codes
                (user_id, code_hash, expires_at)
            VALUES (?, ?, ?)
            """,
            (int(user_id), digest, now_ts + VERIFICATION_TTL_SECONDS),
        )
        conn.commit()
    finally:
        conn.close()
    return code


def verify_email_code(user_id: int, code: str):
    digest = hashlib.sha256(code.strip().encode("utf-8")).hexdigest()
    now_ts = time.time()
    conn = get_connection()
    try:
        row = conn.execute(
            """
            SELECT id, code_hash, expires_at, attempts
            FROM email_verification_codes
            WHERE user_id = ? AND consumed_at IS NULL
            ORDER BY id DESC LIMIT 1
            """,
            (int(user_id),),
        ).fetchone()
        if not row or row["expires_at"] < now_ts:
            return False
        if int(row["attempts"]) >= MAX_VERIFICATION_ATTEMPTS:
            return False
        conn.execute(
            "UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?",
            (row["id"],),
        )
        if not secrets.compare_digest(row["code_hash"], digest):
            conn.commit()
            return False
        conn.execute(
            "UPDATE email_verification_codes SET consumed_at = ? WHERE id = ?",
            (now_ts, row["id"]),
        )
        conn.execute(
            "UPDATE users SET email_verified = 1 WHERE id = ?",
            (int(user_id),),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def send_verification_email(email: str, code: str):
    host = os.getenv("REUP_SMTP_HOST", "").strip()
    if not host:
        # Local engine fallback: keep the flow usable before deployment.
        print(f"[EMAIL DEV] Verification code for {email}: {code}")
        return "dev-log"

    port = int(os.getenv("REUP_SMTP_PORT", "587"))
    username = os.getenv("REUP_SMTP_USER", "").strip()
    password = os.getenv("REUP_SMTP_PASSWORD", "")
    sender = os.getenv("REUP_SMTP_FROM", username or "no-reply@reupai.local")
    message = EmailMessage()
    message["Subject"] = "Mã xác minh tài khoản Reup AI"
    message["From"] = sender
    message["To"] = email
    message.set_content(
        f"Mã xác minh Reup AI của bạn là: {code}\n"
        "Mã có hiệu lực trong 10 phút."
    )
    with smtplib.SMTP(host, port, timeout=15) as smtp:
        smtp.starttls()
        if username:
            smtp.login(username, password)
        smtp.send_message(message)
    return "smtp"


def ensure_default_admin():
    """Create the first local admin once, without changing existing users."""
    conn = get_connection()
    try:
        username = os.getenv("REUP_ADMIN_USERNAME", "admin").strip() or "admin"
        password = os.getenv("REUP_ADMIN_PASSWORD", "").strip()
        email = os.getenv("REUP_ADMIN_EMAIL", "admin@reupai.local").strip().lower()
        named_admin = conn.execute(
            "SELECT id, role FROM users WHERE lower(username) = lower(?) LIMIT 1",
            (username,),
        ).fetchone()
        if named_admin and named_admin["role"] == "admin":
            return
        exists = conn.execute(
            "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
        ).fetchone()
        if exists:
            return
        if not password or password.startswith("replace-with-"):
            raise RuntimeError(
                "REUP_ADMIN_PASSWORD must be set before creating the first local admin."
            )
        conn.execute(
            """
            INSERT OR IGNORE INTO users
                (username, email, password_hash, role, enabled, email_verified)
            VALUES (?, ?, ?, 'admin', 1, 1)
            """,
            (username, email, password_hash.hash(password)),
        )
        conn.commit()
    finally:
        conn.close()
