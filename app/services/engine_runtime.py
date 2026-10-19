"""Runtime guard and diagnostics for the loopback Local Engine."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from importlib.util import find_spec
from pathlib import Path
from typing import Any

from dotenv import dotenv_values

from runtime_paths import get_config_dir, get_runtime_root


_lock_handle = None
DEFAULT_MIN_FREE_DISK_BYTES = 2 * 1024 * 1024 * 1024


def suppress_child_console_windows() -> None:
    """Keep command-line child tools invisible for the packaged Windows app.

    The Local Engine is a windowed executable, but ffmpeg, ffprobe, yt-dlp and
    pipeline workers are console applications.  Windows otherwise creates a
    short-lived cmd window for each child.  Patching ``subprocess.Popen`` once
    also covers ``subprocess.run`` without changing pipeline behaviour.
    """
    if os.name != "nt" or getattr(subprocess, "_reupai_no_console", False):
        return

    original_popen = subprocess.Popen
    no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    class HiddenPopen(original_popen):
        def __init__(self, *args, **kwargs):
            flags = int(kwargs.get("creationflags", 0) or 0)
            kwargs["creationflags"] = flags | no_window
            super().__init__(*args, **kwargs)

    # asyncio.windows_utils subclasses subprocess.Popen during import, so this
    # must remain a class rather than a function wrapper.
    subprocess.Popen = HiddenPopen
    subprocess._reupai_no_console = True


def bundled_resource(*parts: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
    return base.joinpath(*parts)


def python_module_command(module: str, *arguments: str) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--python-module", module, *arguments]
    return [sys.executable, "-m", module, *arguments]


def pipeline_command(*arguments: str) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--pipeline", *arguments]
    pipeline_file = Path(__file__).resolve().parents[1] / "pipeline.py"
    return [sys.executable, str(pipeline_file), *arguments]


def acquire_instance_lock() -> None:
    """Ensure only one Local Engine process owns this runtime directory."""
    global _lock_handle
    if _lock_handle is not None:
        return

    lock_path = get_config_dir() / "local_engine.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(lock_path, "a+b")
    if lock_path.stat().st_size == 0:
        handle.write(b"0")
        handle.flush()
    handle.seek(0)
    try:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (OSError, IOError) as error:
        handle.close()
        raise RuntimeError(
            "Một Local Engine khác đang sử dụng thư mục dữ liệu này."
        ) from error

    _lock_handle = handle


def release_instance_lock() -> None:
    global _lock_handle
    handle = _lock_handle
    _lock_handle = None
    if handle is None:
        return
    try:
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()


def _bounded_positive_int(value: object, default: int) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    return max(0, parsed)


def _module_available(name: str) -> bool:
    try:
        return find_spec(name) is not None
    except (ImportError, AttributeError, ValueError):
        return False


def _sea_g2p_dictionary_available() -> bool:
    try:
        spec = find_spec("sea_g2p")
        return bool(spec and spec.origin and (Path(spec.origin).parent / "sea_g2p.bin").is_file())
    except (ImportError, AttributeError, OSError, ValueError):
        return False


def runtime_diagnostics() -> dict[str, Any]:
    """Return safe, actionable readiness data for the Local Engine UI.

    This deliberately reports only boolean configuration state.  API keys and
    other secrets never leave the local process, while the website can tell a
    customer what needs fixing before they start a long render.
    """
    root = get_runtime_root()
    usage = shutil.disk_usage(root)
    config_path = get_config_dir() / "engine.env"
    try:
        config_values = dotenv_values(config_path)
    except (OSError, UnicodeError):
        config_values = {}
    minimum_free_bytes = _bounded_positive_int(
        os.getenv("REUP_MIN_FREE_DISK_BYTES"),
        DEFAULT_MIN_FREE_DISK_BYTES,
    )
    tools = {
        name: bool(shutil.which(name))
        for name in ("ffmpeg", "ffprobe")
    }
    dependencies = {
        # yt-dlp is bundled as a Python module rather than an executable.
        "yt_dlp": _module_available("yt_dlp"),
        "playwright": _module_available("playwright"),
    }
    components = {
        "ocr": all(_module_available(name) for name in ("paddle", "paddlex", "paddleocr")),
        "vietnamese_tts": all(_module_available(name) for name in ("vieneu", "vieneu_utils", "sea_g2p")) and _sea_g2p_dictionary_available(),
    }
    api_key_configured = bool(
        (os.getenv("GEMINI_API_KEY") or "").strip()
        or (config_values.get("GEMINI_API_KEY") or "").strip()
    )
    try:
        from services.gemini_oauth import status as gemini_oauth_status
        oauth = gemini_oauth_status()
    except Exception:
        oauth = {"configured": False, "connected": False, "connecting": False, "error": None}
    gemini_configured = api_key_configured or bool(oauth.get("connected"))
    return {
        "platform": platform.system(),
        "platform_release": platform.release(),
        "python": platform.python_version(),
        "cpu_count": os.cpu_count() or 1,
        "tools": tools,
        "dependencies": dependencies,
        "components": components,
        "configuration": {
            "config_path": str(config_path),
            "gemini_api_key_configured": api_key_configured,
            "gemini_oauth": oauth,
        },
        "readiness": {
            "media": all(tools.values()) and all(dependencies.values()),
            "translation": gemini_configured,
            "ocr": components["ocr"],
            "voice": components["vietnamese_tts"] and gemini_configured,
            "storage": usage.free >= minimum_free_bytes,
        },
        "storage": {
            "total_bytes": usage.total,
            "used_bytes": usage.used,
            "free_bytes": usage.free,
            "minimum_free_bytes": minimum_free_bytes,
        },
        "runtime_mode": (
            "production"
            if root != Path(__file__).resolve().parents[1]
            else "development"
        ),
    }
