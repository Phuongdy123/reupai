"""Windows desktop entrypoint for the packaged ReupAI Local Engine."""

from __future__ import annotations

import json
import multiprocessing
import os
import runpy
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))


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
    _prepare_environment()
    if _dispatch_child_mode():
        return 0
    return run_desktop()


if __name__ == "__main__":
    raise SystemExit(main())
