"""Windows desktop entrypoint for the packaged ReupAI Local Engine."""

from __future__ import annotations

import json
import multiprocessing
import os
import runpy
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime, timezone
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

CHILD_MODES = {"--pipeline", "--python-module", "--check-config", "--check-voice", "--check-media"}


def _is_child_mode() -> bool:
    return len(sys.argv) > 1 and sys.argv[1] in CHILD_MODES


def _failure_log_path() -> Path:
    """Find a writable log location even when normal startup has failed."""
    root_override = os.getenv("REUP_DATA_DIR", "").strip()
    if root_override:
        root = Path(root_override).expanduser()
    else:
        local_app_data = os.getenv("LOCALAPPDATA", "").strip()
        root = Path(local_app_data) / "ReupAI" if local_app_data else Path.home() / "AppData" / "Local" / "ReupAI"
    try:
        log_dir = root / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir / "startup-failure.log"
    except OSError:
        return Path.cwd() / "ReupAI-startup-failure.log"


def _redact_sensitive_text(value: str) -> str:
    """Keep accidental API-key text out of customer-facing support logs."""
    import re

    return re.sub(
        r"(?im)(GEMINI_API_KEY\s*[=:]\s*)[^\s'\"]+",
        r"\1[redacted]",
        value,
    )


def _record_unhandled_error(error: Exception) -> Path:
    path = _failure_log_path()
    summary = _redact_sensitive_text(str(error))
    detail = _redact_sensitive_text("".join(traceback.format_exception(type(error), error, error.__traceback__)))
    try:
        with path.open("a", encoding="utf-8") as log_file:
            log_file.write(
                f"\n[{datetime.now(timezone.utc).isoformat()}] {type(error).__name__}: {summary}\n{detail}\n"
            )
    except OSError:
        pass
    return path


def _show_startup_error(error: Exception, log_path: Path) -> None:
    """Show one useful Windows message instead of a PyInstaller traceback dialog."""
    if os.name != "nt":
        return
    message = (
        "ReupAI Local Engine không thể khởi động.\n\n"
        f"Lý do: {type(error).__name__}: {_redact_sensitive_text(str(error))}\n\n"
        f"Nhật ký: {log_path}"
    )
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, message, "ReupAI Local Engine", 0x10)
    except Exception:
        pass


def _running_engine() -> bool:
    """Return whether a healthy Engine already owns the loopback port."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:17888/api/health", timeout=1.5) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
        return bool(payload.get("ok") and payload.get("engine") == "ReupAI")
    except (OSError, ValueError, urllib.error.URLError):
        return False


def _port_is_busy() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 17888), timeout=0.8):
            return True
    except OSError:
        return False


def _configure_utf8_streams() -> None:
    """Keep the frozen app and its pipeline child modes safe for Vietnamese/CJK logs."""
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


def _prepare_environment() -> None:
    _configure_utf8_streams()
    os.environ["REUP_ENV"] = "production"
    from runtime_paths import get_runtime_root

    runtime_root = get_runtime_root()
    config_dir = runtime_root / "config"
    logs_dir = runtime_root / "logs"
    config_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    from dotenv import dotenv_values, load_dotenv

    config_path = config_dir / "engine.env"
    os.environ["REUP_ENGINE_CONFIG_PATH"] = str(config_path.resolve())
    if not config_path.exists():
        config_path.write_text(
            "# ReupAI Local Engine settings\n"
            "REUP_ENGINE_ALLOWED_ORIGINS=https://www.reupai.cloud,https://reupai.cloud\n"
            "REUP_MAX_PARALLEL_DOWNLOADS=1\n"
            "REUP_MAX_PARALLEL_PIPELINES=1\n"
            "REUP_MIN_FREE_DISK_BYTES=2147483648\n"
            "# REUP_BROWSER_CHANNEL=auto\n"
            "# GEMINI_API_KEY=\n",
            encoding="utf-8",
        )
    # Read the file directly before dotenv as well. In frozen child processes,
    # a blank inherited environment variable must never hide this local config.
    for key, value in dotenv_values(config_path).items():
        if value is not None:
            os.environ[key] = value
    load_dotenv(config_path, override=True)

    bundle_root = Path(getattr(sys, "_MEIPASS", APP_DIR.parent))
    binary_dir = bundle_root / "bin"
    if binary_dir.is_dir():
        os.environ["PATH"] = str(binary_dir) + os.pathsep + os.environ.get("PATH", "")

    # ffmpeg, ffprobe, yt-dlp and the isolated pipeline are console programs.
    # The desktop engine itself is windowed, so suppress the brief cmd flashes
    # they would otherwise create on every operation.
    from services.engine_runtime import suppress_child_console_windows

    suppress_child_console_windows()

    # Patches are local files only.  The browser and Local Engine HTTP API have
    # no route that writes this directory.
    from patch_loader import apply_runtime_patches

    apply_runtime_patches()


def _dispatch_child_mode() -> bool:
    if len(sys.argv) < 2:
        return False
    mode = sys.argv[1]
    if mode == "--check-config":
        from dotenv import dotenv_values
        from runtime_paths import get_config_dir, get_logs_dir

        config_path = get_config_dir() / "engine.env"
        output_path = (
            Path(sys.argv[2])
            if len(sys.argv) > 2
            else get_logs_dir() / "config-check.json"
        )
        diagnostic = {
            "config_path": str(config_path.resolve()),
            "config_exists": config_path.is_file(),
            "key_in_file": bool((dotenv_values(config_path).get("GEMINI_API_KEY") or "").strip()),
            "key_in_process": bool(os.getenv("GEMINI_API_KEY", "").strip()),
            "runtime_root": str(config_path.parent.parent.resolve()),
        }
        try:
            from services import translator

            diagnostic["translator_ready"] = bool(translator.API_KEY)
        except Exception as error:
            diagnostic["translator_ready"] = False
            diagnostic["error_type"] = type(error).__name__
        try:
            from paddlex.inference.utils.io.readers import PDFReaderBackend

            PDFReaderBackend()
            diagnostic["ocr_reader_ready"] = True
        except Exception as error:
            diagnostic["ocr_reader_ready"] = False
            diagnostic["ocr_error_type"] = type(error).__name__
        try:
            # PaddleX validates optional OCR packages through distribution
            # metadata.  Importability alone is insufficient in a frozen app.
            from paddlex.inference.models.text_detection.processors import DBPostProcess

            DBPostProcess()
            diagnostic["ocr_postprocess_ready"] = True
        except Exception as error:
            diagnostic["ocr_postprocess_ready"] = False
            diagnostic["ocr_postprocess_error_type"] = type(error).__name__
            diagnostic["ocr_postprocess_error"] = str(error)[:240]
        try:
            from vieneu_utils.phonemize_text import phonemize_text_with_emotions

            diagnostic["tts_phoneme_ready"] = bool(
                phonemize_text_with_emotions("Xin chào.")
            )
        except Exception as error:
            diagnostic["tts_phoneme_ready"] = False
            diagnostic["tts_error_type"] = type(error).__name__
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(diagnostic, ensure_ascii=False, indent=2), encoding="utf-8")
        return True
    if mode == "--check-voice":
        import tempfile

        from runtime_paths import get_logs_dir, get_temp_dir

        output_path = (
            Path(sys.argv[2])
            if len(sys.argv) > 2
            else get_logs_dir() / "voice-check.json"
        )
        temp_dir = get_temp_dir()
        temp_dir.mkdir(parents=True, exist_ok=True)
        result = {"voice_ready": False}
        try:
            from services.tts import generate_vieneu_tts, _close_vieneu

            with tempfile.TemporaryDirectory(dir=temp_dir) as scratch:
                wav_path = Path(scratch) / "voice.wav"
                try:
                    generate_vieneu_tts("Xin chào.", wav_path)
                    result["voice_ready"] = wav_path.is_file() and wav_path.stat().st_size > 0
                finally:
                    _close_vieneu()
        except Exception as error:
            result["error_type"] = type(error).__name__
            result["error_message"] = str(error)[:240]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return True
    if mode == "--check-media":
        import tempfile

        from runtime_paths import get_logs_dir, get_temp_dir

        output_path = (
            Path(sys.argv[2])
            if len(sys.argv) > 2
            else get_logs_dir() / "media-check.json"
        )
        result = {"media_ready": False}
        try:
            from services.tts import fit_audio, get_audio_duration

            temp_dir = get_temp_dir()
            temp_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=temp_dir) as scratch:
                raw = Path(scratch) / "raw.wav"
                fitted = Path(scratch) / "fitted.wav"
                subprocess.run(
                    ["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi",
                     "-i", "sine=frequency=440:duration=0.8", "-y", str(raw)],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    check=True,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                fit_audio(str(raw), str(fitted), 1.0)
                result["media_ready"] = fitted.is_file() and get_audio_duration(str(fitted)) > 0
        except Exception as error:
            result["error_type"] = type(error).__name__
            result["error_message"] = str(error)[:240]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return True
    if mode == "--pipeline":
        sys.argv = ["reupai-pipeline", *sys.argv[2:]]
        from core.pipeline import main

        main()
        return True
    if mode == "--python-module":
        if len(sys.argv) < 3:
            raise SystemExit("Thiếu tên Python module.")
        module = sys.argv[2]
        if module not in {"yt_dlp"}:
            raise SystemExit("Python module không được phép.")
        sys.argv = [module, *sys.argv[3:]]
        runpy.run_module(module, run_name="__main__")
        return True
    return False


def _configure_desktop_log() -> Path:
    from runtime_paths import get_logs_dir

    log_path = get_logs_dir() / "ReupAI-Local-Engine.log"
    log_stream = open(log_path, "a", encoding="utf-8", buffering=1)
    sys.stdout = log_stream
    sys.stderr = log_stream
    return log_path


def _load_icon():
    from PIL import Image
    from services.engine_runtime import bundled_resource

    icon_path = bundled_resource("app", "assets", "lat_chuyen_logo.png")
    return Image.open(icon_path).convert("RGBA")


def run_desktop() -> int:
    log_path = _configure_desktop_log()
    from pystray import Icon, Menu, MenuItem
    import uvicorn
    from local_engine import app
    from runtime_paths import get_logs_dir

    restart_requested = threading.Event()
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=17888,
            log_level="info",
            access_log=False,
        )
    )

    icon: Icon

    def open_web(_icon=None, _item=None):
        webbrowser.open("https://www.reupai.cloud")

    def open_engine(_icon=None, _item=None):
        webbrowser.open("http://127.0.0.1:17888/")

    def open_logs(_icon=None, _item=None):
        os.startfile(str(get_logs_dir()))

    def stop_app(_icon=None, _item=None):
        server.should_exit = True
        icon.stop()

    def restart_app(_icon=None, _item=None):
        restart_requested.set()
        stop_app()

    menu = Menu(
        MenuItem("Mở ReupAI", open_web, default=True),
        MenuItem("Trạng thái Local Engine", open_engine),
        MenuItem("Mở thư mục log", open_logs),
        Menu.SEPARATOR,
        MenuItem("Khởi động lại", restart_app),
        MenuItem("Thoát", stop_app),
    )
    icon = Icon("ReupAI", _load_icon(), "ReupAI Local Engine", menu)

    server_thread = threading.Thread(target=server.run, name="reupai-server", daemon=True)
    server_thread.start()

    def monitor_server():
        server_thread.join()
        if icon.visible:
            icon.stop()

    threading.Thread(target=monitor_server, name="reupai-monitor", daemon=True).start()

    if "--background" not in sys.argv:
        def open_when_ready():
            for _ in range(80):
                if server.started:
                    open_web()
                    return
                if not server_thread.is_alive():
                    return
                time.sleep(0.25)

        threading.Thread(target=open_when_ready, name="reupai-browser", daemon=True).start()

    try:
        icon.run()
    finally:
        server.should_exit = True
        server_thread.join(timeout=15)

    if restart_requested.is_set():
        subprocess.Popen([sys.executable, "--background"], close_fds=True)
    return 0


def main() -> int:
    multiprocessing.freeze_support()
    # Double-clicking the executable while it is already running should open
    # the workspace, not start a second tray process or fail on the port.
    if not _is_child_mode() and _running_engine():
        webbrowser.open("https://www.reupai.cloud")
        return 0
    _prepare_environment()
    if _dispatch_child_mode():
        return 0
    if _port_is_busy():
        raise RuntimeError(
            "Cổng 17888 đang được một ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi mở lại ReupAI."
        )
    return run_desktop()


def run_safely() -> int:
    """Prevent frozen child failures from becoming opaque PyInstaller dialogs."""
    try:
        return main()
    except Exception as error:
        log_path = _record_unhandled_error(error)
        if _is_child_mode():
            # Pipeline workers redirect stderr to the per-job log.  Preserve
            # enough detail there for support while keeping the desktop quiet.
            print(f"[ReupAI] {type(error).__name__}: {error}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
        else:
            _show_startup_error(error, log_path)
        return 1


if __name__ == "__main__":
    raise SystemExit(run_safely())
