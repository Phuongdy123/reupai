"""Disk-space checks for source downloads and their temporary media files."""

from __future__ import annotations

import errno
import os
import shutil
from pathlib import Path


_MIB = 1024 * 1024
_DEFAULT_RESERVE_BYTES = 512 * _MIB


class DownloadStorageError(RuntimeError):
    """The destination cannot safely hold the current source download."""


def download_reserve_bytes() -> int:
    """Keep some space for Windows, ffmpeg, and SQLite during a download."""
    try:
        configured = int(os.getenv("REUP_MIN_FREE_DOWNLOAD_BYTES", str(_DEFAULT_RESERVE_BYTES)))
    except (TypeError, ValueError):
        configured = _DEFAULT_RESERVE_BYTES
    return max(128 * _MIB, configured)


def ensure_download_space(
    destination: Path,
    *,
    expected_bytes: int = 0,
    operation: str = "tải video",
) -> None:
    """Check the actual destination volume before writing an estimated payload."""
    reserve = download_reserve_bytes()
    required = reserve + max(0, expected_bytes)
    available = shutil.disk_usage(destination).free
    if available >= required:
        return
    raise DownloadStorageError(
        f"Không đủ dung lượng trống trên ổ {destination.anchor or destination} để {operation}. "
        f"Còn {available // _MIB} MB; cần ít nhất {required // _MIB} MB "
        "(bao gồm dung lượng dự phòng). Hãy giải phóng dung lượng rồi thử lại."
    )


def is_disk_full_error(error: BaseException) -> bool:
    if isinstance(error, DownloadStorageError):
        return True
    if isinstance(error, OSError) and (
        error.errno == errno.ENOSPC or getattr(error, "winerror", None) in {39, 112}
    ):
        return True
    message = str(error).lower()
    return any(
        marker in message
        for marker in ("no space left on device", "disk is full", "not enough space on the disk")
    )
