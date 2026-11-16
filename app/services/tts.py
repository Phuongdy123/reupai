import atexit
import asyncio
import ctypes
import gc
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from pydub import AudioSegment


# FFmpeg/ffprobe run hundreds of times in a long voiceover job.  A detached
# Windows child must not depend on a terminal pipe that may be closed while the
# job is still running.
MEDIA_CREATIONFLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

try:
    import edge_tts
except Exception:
    edge_tts = None


# =========================================================
# CONFIG
# =========================================================

INPUT_SRT = "app/output/vietnamese.srt"
VIDEO_FILE = "app/downloads/test2.mp4"
TTS_FOLDER = "app/temp/tts"
OUTPUT_AUDIO = "app/output/vietnamese_voice.wav"
MANIFEST_FILE = "app/output/tts_manifest.json"


# =========================================================
# REUP AI TTS PROVIDER
# =========================================================
#
# Primary:
#   VieNeu-TTS v3 Turbo, local ONNX/CPU
#
# Voice presets:
#   hai_dang -> Hải Đăng (default)
#   truc_ly  -> Trúc Ly
#
# Can override before launching Reup AI:
#   set REUP_TTS_VOICE=hai_dang
#   set REUP_TTS_VOICE=truc_ly
#
# Optional:
#   set REUP_VIENEU_BACKEND=onnx
#   set REUP_TTS_EDGE_FALLBACK=1
# =========================================================

TTS_PROVIDER = (
    os.getenv(
        "REUP_TTS_PROVIDER",
        "vieneu",
    )
    .strip()
    .lower()
)

VIENEU_BACKEND = (
    os.getenv(
        "REUP_VIENEU_BACKEND",
        "onnx",
    )
    .strip()
    .lower()
    or "onnx"
)

try:
    # ONNX Runtime defaults to half the logical cores (capped at eight).  The
    # turbo mode below runs two independent engines, so four threads each keeps
    # the i5-12450H busy without oversubscribing it.
    VIENEU_THREADS = int(os.getenv("REUP_VIENEU_THREADS", "0"))
except ValueError:
    VIENEU_THREADS = 0

def _available_memory_gb():
    """Return currently available physical RAM, or zero when it cannot be read."""
    try:
        if os.name == "nt":
            class _MemoryStatus(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]
            status = _MemoryStatus()
            status.dwLength = ctypes.sizeof(_MemoryStatus)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return status.ullAvailPhys / (1024 ** 3)
        else:
            available_pages = os.sysconf("SC_AVPHYS_PAGES")
            page_size = os.sysconf("SC_PAGE_SIZE")
            return available_pages * page_size / (1024 ** 3)
    except (AttributeError, OSError, ValueError):
        pass
    return 0.0


def _auto_tts_workers():
    """Use two ONNX sessions only when CPU and free RAM leave room for them."""
    if (os.cpu_count() or 1) >= 8 and _available_memory_gb() >= 8:
        return 2
    return 1


_tts_workers_setting = os.getenv("REUP_TTS_ONNX_WORKERS", "auto").strip().lower()
if _tts_workers_setting == "auto":
    TTS_ONNX_WORKERS = _auto_tts_workers()
else:
    try:
        TTS_ONNX_WORKERS = max(1, min(int(_tts_workers_setting), 2))
    except ValueError:
        TTS_ONNX_WORKERS = _auto_tts_workers()

try:
    VIENEU_TEMPERATURE = float(
        os.getenv(
            "REUP_VIENEU_TEMPERATURE",
            "0.8",
        )
    )
except ValueError:
    VIENEU_TEMPERATURE = 0.8

EDGE_FALLBACK_ENABLED = (
    os.getenv(
        "REUP_TTS_EDGE_FALLBACK",
        "1",
    )
    .strip()
    .lower()
    in {
        "1",
        "true",
        "yes",
        "on",
    }
)

VOICE_ALIASES = {
    "hai_dang": "Hải Đăng",
    "hai dang": "Hải Đăng",
    "hải đăng": "Hải Đăng",
    "truc_ly": "Trúc Ly",
    "truc ly": "Trúc Ly",
    "trúc ly": "Trúc Ly",
    "hoai_my": "vi-VN-HoaiMyNeural",
    "nam_minh": "vi-VN-NamMinhNeural",
}

EDGE_VOICE_PROFILES = {
    "vi-VN-HoaiMyNeural": ("vi-VN-HoaiMyNeural", "+0Hz", "+0%"),
    "vi-VN-NamMinhNeural": ("vi-VN-NamMinhNeural", "+0Hz", "+0%"),
    "hoai_my_tram": ("vi-VN-HoaiMyNeural", "-6Hz", "+4%"),
    "nam_minh_tram": ("vi-VN-NamMinhNeural", "-6Hz", "+4%"),
    "hoai_my_shorts": ("vi-VN-HoaiMyNeural", "+8Hz", "+8%"),
    "nam_minh_shorts": ("vi-VN-NamMinhNeural", "+8Hz", "+8%"),
}


def normalize_voice_name(value):
    raw = str(value or "").strip()

    if not raw:
        return "Trúc Ly"

    return VOICE_ALIASES.get(
        raw.lower(),
        raw,
    )


VOICE = normalize_voice_name(
    os.getenv(
        "REUP_TTS_VOICE",
        "Trúc Ly",
    )
)

# Edge fallback only. VieNeu remains primary.
EDGE_VOICE = "vi-VN-NamMinhNeural"
EDGE_RATE = "+0%"
EDGE_PITCH = "+0Hz"

MAX_RETRIES = 3

# Existing timing behavior is preserved.
# We only lower the warning threshold so very large atempo changes are visible.
COMFORT_SPEED_WARNING = 1.22

# Toc do doc co ban. 1.00 = toc do goc 1.0x.
try:
    BASE_TTS_SPEED = float(
        os.getenv("REUP_TTS_SPEED", "1.00")
    )
except ValueError:
    BASE_TTS_SPEED = 1.00

BASE_TTS_SPEED = max(0.5, min(BASE_TTS_SPEED, 2.0))


# =========================================================
# VIENEU ENGINE - LAZY SINGLETON
# =========================================================

_VIENEU_ENGINE = None
_VIENEU_VOICE_IDS = None
_PARALLEL_VIENEU = threading.local()
_PARALLEL_VIENEU_ENGINES = []
_PARALLEL_VIENEU_LOCK = threading.Lock()


def _close_vieneu():
    global _VIENEU_ENGINE

    engine = _VIENEU_ENGINE

    _VIENEU_ENGINE = None

    engines = [engine] if engine is not None else []
    with _PARALLEL_VIENEU_LOCK:
        engines.extend(_PARALLEL_VIENEU_ENGINES)
        _PARALLEL_VIENEU_ENGINES.clear()

    for item in engines:
        try:
            item.close()
        except Exception:
            pass


atexit.register(
    _close_vieneu
)


def _create_vieneu_engine():
    """Create one local VieNeu engine with the configured ONNX thread budget."""
    try:
        from vieneu import Vieneu
    except Exception as error:
        raise RuntimeError(
            "Chua cai VieNeu-TTS. "
            "Chay: venv\\Scripts\\python.exe -m pip install -U vieneu"
        ) from error

    kwargs = {"backend": VIENEU_BACKEND}
    # Divide a bounded CPU budget between ONNX engines. This avoids each
    # concurrent model independently claiming half of all logical processors.
    workers = TTS_ONNX_WORKERS if _parallel_onnx_enabled() else 1
    thread_budget = VIENEU_THREADS or min(8, max(4, (os.cpu_count() or 4) - 2))
    kwargs["threads"] = max(1, thread_budget // workers)
    return Vieneu(**kwargs)


def _get_vieneu_engine():
    global _VIENEU_ENGINE
    global _VIENEU_VOICE_IDS

    if _VIENEU_ENGINE is not None:
        return _VIENEU_ENGINE

    print(
        "\n[VieNeu] Dang load v3 Turbo..."
    )

    print(
        f"[VieNeu] Backend: {VIENEU_BACKEND}"
    )

    _VIENEU_ENGINE = _create_vieneu_engine()

    try:
        voices = (
            _VIENEU_ENGINE
            .list_preset_voices()
        )

        _VIENEU_VOICE_IDS = {
            item[1]
            if (
                isinstance(
                    item,
                    (list, tuple),
                )
                and len(item) >= 2
            )
            else str(item)
            for item in voices
        }

    except Exception:
        _VIENEU_VOICE_IDS = None

    if (
        _VIENEU_VOICE_IDS
        and VOICE
        not in _VIENEU_VOICE_IDS
    ):
        available = ", ".join(
            sorted(
                _VIENEU_VOICE_IDS
            )
        )

        raise RuntimeError(
            f"VieNeu khong co voice '{VOICE}'. "
            f"Available: {available}"
        )

    print(
        f"[VieNeu] Voice: {VOICE}"
    )

    print(
        "[VieNeu] Ready."
    )

    return _VIENEU_ENGINE


def _get_parallel_vieneu_engine():
    """Return one ONNX engine per worker thread; sessions must not be shared."""
    engine = getattr(_PARALLEL_VIENEU, "engine", None)
    if engine is None:
        engine = _create_vieneu_engine()
        _PARALLEL_VIENEU.engine = engine
        with _PARALLEL_VIENEU_LOCK:
            _PARALLEL_VIENEU_ENGINES.append(engine)
    return engine


def set_voice(
    voice_name
):
    global VOICE

    resolved = normalize_voice_name(
        voice_name
    )

    VOICE = resolved

    return VOICE


# =========================================================
# TIME UTILS
# =========================================================

def srt_time_to_ms(
    time_text: str
):
    hours, minutes, rest = (
        time_text.split(":")
    )

    seconds, milliseconds = (
        rest.split(",")
    )

    return (
        int(hours) * 3600000
        + int(minutes) * 60000
        + int(seconds) * 1000
        + int(milliseconds)
    )


# =========================================================
# READ SRT
# =========================================================

def read_srt(
    file_path
):
    if not os.path.exists(
        file_path
    ):
        raise FileNotFoundError(
            f"Khong tim thay file: {file_path}"
        )

    with open(
        file_path,
        "r",
        encoding="utf-8-sig",
    ) as file:
        content = file.read()

    blocks = re.split(
        r"\n\s*\n",
        content.strip(),
    )

    results = []

    for block in blocks:
        lines = (
            block.strip()
            .splitlines()
        )

        if len(lines) < 3:
            continue

        try:
            subtitle_id = int(
                lines[0].strip()
            )
        except ValueError:
            continue

        if " --> " not in lines[1]:
            continue

        start, end = (
            lines[1].split(
                " --> ",
                1,
            )
        )

        text = " ".join(
            line.strip()
            for line in lines[2:]
        )

        start_ms = (
            srt_time_to_ms(
                start.strip()
            )
        )

        end_ms = (
            srt_time_to_ms(
                end.strip()
            )
        )

        results.append(
            {
                "id":
                    subtitle_id,

                "start":
                    start.strip(),

                "end":
                    end.strip(),

                "start_ms":
                    start_ms,

                "end_ms":
                    end_ms,

                "duration_ms":
                    end_ms
                    - start_ms,

                "text":
                    text,
            }
        )

    return results


# =========================================================
# DURATION HELPERS
# =========================================================

def get_video_duration_ms(
    video_path
):
    if not os.path.exists(
        video_path
    ):
        return None

    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        video_path,
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=True,
        stdin=subprocess.DEVNULL,
        creationflags=MEDIA_CREATIONFLAGS,
    )

    seconds = float(
        result.stdout.strip()
    )

    return int(
        seconds * 1000
    )


def get_audio_duration(
    audio_path
):
    # VieNeu and FFmpeg clips are PCM WAV. Reading their header avoids
    # launching ffprobe twice for every subtitle in a long job.
    if str(audio_path).lower().endswith(".wav"):
        try:
            with wave.open(str(audio_path), "rb") as wav:
                frame_rate = wav.getframerate()
                if frame_rate > 0 and wav.getnframes() > 0:
                    return wav.getnframes() / frame_rate
        except (OSError, EOFError, wave.Error):
            pass
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        audio_path,
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=True,
        stdin=subprocess.DEVNULL,
        creationflags=MEDIA_CREATIONFLAGS,
    )

    return float(
        result.stdout.strip()
    )


# =========================================================
# VIENEU LOCAL TTS
# =========================================================

def generate_vieneu_tts(
    text,
    output_path,
    engine=None,
):
    engine = engine or _get_vieneu_engine()

    audio = engine.infer(
        text=str(text).strip(),
        voice=VOICE,
        temperature=
            VIENEU_TEMPERATURE,
    )

    if audio is None or len(audio) == 0:
        raise RuntimeError(
            "VieNeu tra ve audio rong."
        )

    output = Path(
        output_path
    )

    output.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    engine.save(
        audio,
        str(output),
    )

    if (
        not output.exists()
        or output.stat().st_size <= 0
    ):
        raise RuntimeError(
            "VieNeu khong tao duoc WAV."
        )


# =========================================================
# EDGE FALLBACK
# =========================================================

async def _generate_edge_mp3_once(
    text,
    output_path
):
    if edge_tts is None:
        raise RuntimeError(
            "edge-tts chua duoc cai."
        )

    profile = EDGE_VOICE_PROFILES.get(VOICE)
    edge_voice, edge_pitch, edge_rate = profile or (EDGE_VOICE, EDGE_PITCH, EDGE_RATE)
    communicate = (
        edge_tts.Communicate(
            text=text,
            voice=edge_voice,
            rate=edge_rate,
            pitch=edge_pitch,
        )
    )

    await communicate.save(
        output_path
    )


def generate_edge_fallback(
    text,
    output_wav
):
    output_wav = str(
        output_wav
    )

    temp_mp3 = (
        output_wav
        + ".edge.mp3"
    )

    try:
        asyncio.run(
            _generate_edge_mp3_once(
                text,
                temp_mp3,
            )
        )

        subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-y",
                "-i",
                temp_mp3,
                "-ar",
                "48000",
                "-ac",
                "1",
                output_wav,
            ],
            stdout=
                subprocess.DEVNULL,
            stderr=
                subprocess.DEVNULL,
            check=True,
            stdin=subprocess.DEVNULL,
            creationflags=MEDIA_CREATIONFLAGS,
        )

    finally:
        try:
            if os.path.exists(
                temp_mp3
            ):
                os.remove(
                    temp_mp3
                )
        except OSError:
            pass


# =========================================================
# GENERATE ONE TTS CLIP
# =========================================================

def generate_tts(
    text,
    output_path,
    engine=None,
):
    provider = "edge" if VOICE in EDGE_VOICE_PROFILES else TTS_PROVIDER

    if provider not in {
        "vieneu",
        "edge",
    }:
        raise ValueError(
            f"TTS provider khong hop le: "
            f"{provider}"
        )

    last_error = None

    for attempt in range(
        1,
        MAX_RETRIES + 1,
    ):
        try:
            if provider == "vieneu":
                generate_vieneu_tts(
                    text,
                    output_path,
                    engine=engine,
                )
            else:
                generate_edge_fallback(
                    text,
                    output_path,
                )

            if (
                os.path.exists(
                    output_path
                )
                and os.path.getsize(
                    output_path
                ) > 0
            ):
                return

            raise RuntimeError(
                "TTS file rong."
            )

        except Exception as error:
            last_error = error

            print(
                f"TTS {provider} loi "
                f"{attempt}/{MAX_RETRIES}: "
                f"{error}"
            )

            if (
                provider == "vieneu"
                and _edge_fallback_allowed()
            ):
                print(
                    "[TTS] Thu Edge-TTS fallback..."
                )

                try:
                    generate_edge_fallback(
                        text,
                        output_path,
                    )

                    if (
                        os.path.exists(
                            output_path
                        )
                        and os.path.getsize(
                            output_path
                        ) > 0
                    ):
                        return

                except Exception as fallback_error:
                    print(
                        "[TTS] Edge fallback loi: "
                        + str(
                            fallback_error
                        )
                    )

            if attempt >= MAX_RETRIES:
                raise last_error

            wait_time = (
                attempt * 2
            )

            print(
                f"Thu lai sau "
                f"{wait_time}s..."
            )

            time.sleep(
                wait_time
            )


# =========================================================
# BUILD ATEMPO FILTER
# =========================================================

def build_atempo_filter(
    speed_ratio
):
    filters = []
    ratio = float(
        speed_ratio
    )

    while ratio > 2.0:
        filters.append(
            "atempo=2.0"
        )
        ratio /= 2.0

    while ratio < 0.5:
        filters.append(
            "atempo=0.5"
        )
        ratio /= 0.5

    filters.append(
        f"atempo={ratio:.6f}"
    )

    return ",".join(
        filters
    )


# =========================================================
# FIT AUDIO TO SUBTITLE SLOT
# =========================================================

def fit_audio(
    input_file,
    output_file,
    target_duration_seconds
):
    original_duration = (
        get_audio_duration(
            input_file
        )
    )

    # Toc do CO DINH.
    # Khong tu tang toc de ep cau dai vao subtitle slot.
    speed_ratio = BASE_TTS_SPEED

    atempo_filter = (
        build_atempo_filter(
            speed_ratio
        )
    )

    partial_output = str(output_file) + ".partial.wav"
    command = [
        "ffmpeg",
        "-nostdin",
        "-y",
        "-i",
        input_file,
        "-filter:a",
        atempo_filter,
        "-ar",
        "44100",
        "-ac",
        "2",
        partial_output,
    ]

    for attempt in range(3):
        try:
            if os.path.exists(partial_output):
                os.remove(partial_output)
            subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=True,
                creationflags=MEDIA_CREATIONFLAGS,
            )
            if not os.path.isfile(partial_output) or os.path.getsize(partial_output) <= 44:
                raise RuntimeError("FFmpeg tao WAV rong.")
            os.replace(partial_output, output_file)
            break
        except (OSError, subprocess.CalledProcessError, RuntimeError) as error:
            if attempt == 2:
                try:
                    os.remove(partial_output)
                except FileNotFoundError:
                    pass
                detail = (
                    (error.stderr or "").strip()[-500:]
                    if isinstance(error, subprocess.CalledProcessError)
                    else str(error)
                )
                raise RuntimeError(
                    f"FFmpeg khong xu ly duoc clip TTS sau 3 lan: {detail}"
                ) from error
            time.sleep(0.5 * (attempt + 1))

    final_duration = (
        get_audio_duration(
            output_file
        )
    )

    overflow_seconds = max(
        0.0,
        final_duration
        - max(
            float(target_duration_seconds),
            0.0,
        ),
    )

    return {
        "original_duration": original_duration,
        "final_duration": final_duration,
        "speed": speed_ratio,
        "overflow_seconds": overflow_seconds,
    }


# =========================================================
# JSON
# =========================================================

def save_json(
    data,
    output_path
):
    directory = os.path.dirname(
        output_path
    )

    if directory:
        os.makedirs(
            directory,
            exist_ok=True,
        )

    with open(
        output_path,
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            data,
            file,
            ensure_ascii=False,
            indent=2,
        )


# =========================================================
# CACHE NAME
# =========================================================

def _safe_voice_slug():
    if VOICE == "Hải Đăng":
        return "hai_dang"

    if VOICE == "Trúc Ly":
        return "truc_ly"

    import unicodedata

    normalized = unicodedata.normalize("NFKD", VOICE).encode("ascii", "ignore").decode("ascii")
    value = normalized.replace("đ", "d").replace("Đ", "D").lower().replace(" ", "_")
    value = re.sub(r"[^a-z0-9_]+", "", value)
    return value or "voice"


def _tts_file_paths(subtitle_id, voice_slug):
    raw_wav = os.path.join(
        TTS_FOLDER,
        (
            f"{subtitle_id:04d}"
            f"_raw_"
            f"{TTS_PROVIDER}_"
            f"{voice_slug}.wav"
        ),
    )
    fitted_wav = os.path.join(
        TTS_FOLDER,
        f"{subtitle_id:04d}.wav",
    )
    return raw_wav, fitted_wav


def _is_offline_mode():
    return str(os.getenv("REUP_OFFLINE_MODE", "")).strip().lower() in {"1", "true", "yes", "on"}


def _is_stability_mode():
    return str(os.getenv("REUP_STABILITY_MODE", "")).strip().lower() in {"1", "true", "yes", "on"} or _is_offline_mode()


def _edge_fallback_allowed():
    if _is_offline_mode():
        return False
    env_flag = os.getenv("REUP_TTS_EDGE_FALLBACK")
    if env_flag is not None:
        return env_flag.strip().lower() in {"1", "true", "yes", "on"}
    return EDGE_FALLBACK_ENABLED


def _parallel_onnx_enabled():
    if _is_stability_mode():
        return False
    workers_env = os.getenv("REUP_TTS_ONNX_WORKERS", "").strip()
    if workers_env == "1":
        return False
    return (
        TTS_PROVIDER == "vieneu"
        and VIENEU_BACKEND == "onnx"
        and TTS_ONNX_WORKERS > 1
    )


def _generate_parallel_raw_tts(pending, on_progress=None):
    """Generate independent subtitle lines concurrently with separate ONNX engines.

    Each worker owns an engine because the ONNX engine serializes its sessions.
    Two workers are intentionally the maximum: this uses extra RAM while keeping
    the CPU and laptop thermals stable for the rest of the pipeline.
    """
    if not pending:
        return

    total = len(pending)
    print(
        f"\n[TTS Turbo] Tao {total} cau bang {TTS_ONNX_WORKERS} ONNX engines "
        f"({VIENEU_THREADS or 'auto'} luong/engine)."
    )

    def run_one(text, output_path):
        generate_tts(
            text,
            output_path,
            engine=_get_parallel_vieneu_engine(),
        )
        return output_path

    with ThreadPoolExecutor(max_workers=TTS_ONNX_WORKERS) as executor:
        futures = {
            executor.submit(run_one, text, output_path): (index, subtitle_id)
            for index, subtitle_id, text, output_path in pending
        }
        completed = 0
        for future in as_completed(futures):
            index, subtitle_id = futures[future]
            future.result()
            completed += 1
            if on_progress is not None:
                on_progress("raw", completed, total)
            print(
                f"[TTS Turbo] {completed}/{total} xong "
                f"(subtitle {index}, ID {subtitle_id})."
            )


# =========================================================
# CREATE ALL TTS CLIPS
# =========================================================

def create_tts_clips(
    subtitles,
    reuse_fitted=False,
    on_progress=None,
):
    os.makedirs(
        TTS_FOLDER,
        exist_ok=True,
    )

    manifest = []

    total = len(
        subtitles
    )

    voice_slug = (
        _safe_voice_slug()
    )

    # Auto mode enables two workers only when the CPU and free-memory budget
    # can support them; REUP_TTS_ONNX_WORKERS=1 keeps a low-memory fallback.
    if _parallel_onnx_enabled():
        pending = []
        for index, subtitle in enumerate(subtitles, start=1):
            subtitle_id = subtitle["id"]
            raw_wav, _ = _tts_file_paths(subtitle_id, voice_slug)
            if not (os.path.isfile(raw_wav) and os.path.getsize(raw_wav) > 44):
                pending.append((index, subtitle_id, subtitle["text"], raw_wav))
        _generate_parallel_raw_tts(pending, on_progress=on_progress)
    elif TTS_PROVIDER == "edge" and len(subtitles) > 1:
        pending_edge = []
        for subtitle in subtitles:
            raw_wav, _ = _tts_file_paths(subtitle["id"], voice_slug)
            if not (os.path.isfile(raw_wav) and os.path.getsize(raw_wav) > 44):
                pending_edge.append((subtitle["text"], raw_wav))
        if pending_edge:
            from concurrent.futures import ThreadPoolExecutor
            workers = 6 if os.getenv("REUP_BOOST_GPU", "").strip() == "1" else 4
            with ThreadPoolExecutor(max_workers=min(workers, len(pending_edge))) as pool:
                list(pool.map(lambda item: generate_edge_fallback(item[0], item[1]), pending_edge))

    fit_cache = {}
    if not _is_stability_mode() and len(subtitles) > 1:
        from collections import Counter
        id_counts = Counter(item["id"] for item in subtitles)
        fit_pending = []
        for subtitle in subtitles:
            subtitle_id = subtitle["id"]
            if id_counts[subtitle_id] != 1:
                continue
            raw_wav, fitted_wav = _tts_file_paths(subtitle_id, voice_slug)
            if not (os.path.isfile(raw_wav) and os.path.getsize(raw_wav) > 44):
                continue
            if reuse_fitted and os.path.isfile(fitted_wav) and os.path.getsize(fitted_wav) > 44:
                continue
            fit_pending.append((subtitle_id, raw_wav, fitted_wav, subtitle["duration_ms"] / 1000.0))
        if len(fit_pending) > 1:
            workers = min(6, max(2, os.cpu_count() or 4), len(fit_pending))
            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {
                    executor.submit(fit_audio, r_wav, f_wav, tgt_s): sid
                    for sid, r_wav, f_wav, tgt_s in fit_pending
                }
                for future in as_completed(futures):
                    fit_cache[futures[future]] = future.result()

    for index, subtitle in enumerate(
        subtitles,
        start=1,
    ):
        subtitle_id = (
            subtitle[
                "id"
            ]
        )

        print(
            "\n=============================="
        )

        print(
            f"TTS {index}/{total} "
            f"- ID {subtitle_id}"
        )

        print(
            f"Provider: "
            f"{TTS_PROVIDER}"
        )

        print(
            f"Voice: {VOICE}"
        )

        print(
            subtitle[
                "text"
            ]
        )

        raw_wav, fitted_wav = _tts_file_paths(subtitle_id, voice_slug)

        raw_existed = os.path.isfile(raw_wav) and os.path.getsize(raw_wav) > 44
        if not raw_existed:
            print(
                "Dang tao voice..."
            )

            generate_tts(
                subtitle[
                    "text"
                ],
                raw_wav,
            )

        else:
            print("Raw TTS da ton tai -> skip")

        target_seconds = (
            subtitle[
                "duration_ms"
            ]
            / 1000.0
        )

        fit_info = fit_cache.get(subtitle_id)
        if fit_info is None and reuse_fitted and raw_existed and os.path.isfile(fitted_wav) and os.path.getsize(fitted_wav) > 44:
            try:
                original_duration = get_audio_duration(raw_wav)
                final_duration = get_audio_duration(fitted_wav)
                fit_info = {
                    "original_duration": original_duration,
                    "final_duration": final_duration,
                    "speed": BASE_TTS_SPEED,
                    "overflow_seconds": max(0.0, final_duration - max(target_seconds, 0.0)),
                }
                print("Fitted TTS da ton tai -> skip FFmpeg")
            except (OSError, subprocess.CalledProcessError, ValueError):
                fit_info = None
        if fit_info is None:
            fit_info = fit_audio(raw_wav, fitted_wav, target_seconds)

        speed = (
            fit_info[
                "speed"
            ]
        )

        print(
            f"Slot: "
            f"{target_seconds:.2f}s"
        )

        print(
            f"TTS: "
            f"{fit_info['original_duration']:.2f}s"
        )

        print(
            f"Final: "
            f"{fit_info['final_duration']:.2f}s"
        )

        print(
            f"Speed: "
            f"{speed:.2f}x"
        )

        warning = None

        overflow_seconds = float(
            fit_info.get(
                "overflow_seconds",
                0.0,
            )
        )

        if overflow_seconds > 0.05:
            warning = (
                f"Cau thoai dai hon slot {overflow_seconds:.2f}s. "
                "Giu nguyen toc do 1.10x, khong tu tang toc."
            )

            print(
                "CANH BAO: "
                + warning
            )

        manifest.append(
            {
                **subtitle,

                "tts_provider":
                    TTS_PROVIDER,

                "tts_voice":
                    VOICE,

                "tts_backend":
                    (
                        VIENEU_BACKEND
                        if TTS_PROVIDER
                        == "vieneu"
                        else "edge"
                    ),

                "raw_audio":
                    raw_wav,

                "audio_file":
                    fitted_wav,

                "original_audio_duration":
                    fit_info[
                        "original_duration"
                    ],

                "final_audio_duration":
                    fit_info[
                        "final_duration"
                    ],

                "speed":
                    speed,

                "warning":
                    warning,
            }
        )

        # Fitted WAV files are independently reusable after interruption.
        # Persist the growing manifest in batches to avoid quadratic writes
        # for multi-hour videos with thousands of subtitle lines.
        if index % 25 == 0 or index == total:
            save_json(manifest, MANIFEST_FILE)
        if on_progress is not None:
            on_progress("clips", index, total)

    return manifest


# =========================================================
# BUILD FULL TIMELINE
# =========================================================

def _timeline_manifest_signature(manifest, duration_ms: int, output_suffix: str) -> str:
    hasher = hashlib.sha256()
    hasher.update(f"v1|{duration_ms}|{output_suffix}|{VOICE}|{BASE_TTS_SPEED:.3f}|{len(manifest)}".encode("utf-8"))
    for item in manifest:
        audio_file = str(item.get("audio_file") or "")
        size = 0
        try:
            size = os.path.getsize(audio_file)
        except OSError:
            pass
        hasher.update(f"|{item.get('start_ms')}:{size}:{item.get('final_audio_duration')}".encode("utf-8"))
    return hasher.hexdigest()


def build_voice_timeline(
    manifest,
    total_duration_ms,
    on_progress=None,
):
    print(
        "\n=============================="
    )

    print(
        "DANG GHEP VOICE TIMELINE"
    )

    print(
        "=============================="
    )

    # Overlaying each line onto a full-length AudioSegment copies the entire
    # timeline per line. Assemble 30s windows inside 10-minute resumable
    # checkpoint blocks so multi-hour/multi-dozen-hour jobs resume cleanly and
    # use FLAC when >3.8 GB PCM would exceed WAV's 4 GB RIFF limit.
    duration_ms = max(0, int(total_duration_ms))
    output_path = Path(OUTPUT_AUDIO)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    window_ms = 30_000
    windows_per_block = 20  # 10 minutes per checkpoint block
    block_ms = window_ms * windows_per_block
    window_count = max(1, (duration_ms + window_ms - 1) // window_ms) if duration_ms else 1
    window_clips = [[] for _ in range(window_count)]
    for item in manifest:
        audio_path = str(item["audio_file"])
        start_ms = max(0, int(item["start_ms"]))
        duration_seconds = item.get("final_audio_duration")
        if duration_seconds is None:
            duration_seconds = get_audio_duration(audio_path)
        clip_duration_ms = max(0, int(round(float(duration_seconds) * 1000)))
        if clip_duration_ms and start_ms < duration_ms:
            clip_end = min(duration_ms, start_ms + clip_duration_ms)
            for window_index in range(start_ms // window_ms, (clip_end - 1) // window_ms + 1):
                if window_index < window_count:
                    window_clips[window_index].append((start_ms, clip_end, audio_path))

    chunk_dir = output_path.with_name(f"{output_path.stem}.timeline_chunks")
    meta_path = chunk_dir / "checkpoint.json"
    signature = _timeline_manifest_signature(manifest, duration_ms, output_path.suffix.lower())
    reuse_chunks = False
    if meta_path.is_file():
        try:
            saved = json.loads(meta_path.read_text(encoding="utf-8"))
            reuse_chunks = isinstance(saved, dict) and saved.get("signature") == signature
        except (OSError, ValueError):
            reuse_chunks = False
    if not reuse_chunks and chunk_dir.exists():
        shutil.rmtree(chunk_dir, ignore_errors=True)
    chunk_dir.mkdir(parents=True, exist_ok=True)
    if not reuse_chunks:
        try:
            tmp_meta = chunk_dir / "checkpoint.json.tmp"
            tmp_meta.write_text(json.dumps({"signature": signature, "duration_ms": duration_ms}), encoding="utf-8")
            os.replace(tmp_meta, meta_path)
        except OSError:
            pass

    block_files: list[Path] = []
    block_starts = list(range(0, duration_ms, block_ms)) or [0]
    for block_index, block_start in enumerate(block_starts):
        block_end = min(duration_ms, block_start + block_ms)
        block_path = chunk_dir / f"block_{block_index:05d}.wav"
        block_tmp = chunk_dir / f"block_{block_index:05d}.tmp.wav"
        expected_frames = max(0, int(round((block_end - block_start) * 44.1)))
        min_valid_bytes = 44 + max(0, expected_frames * 4 - 4096)
        if reuse_chunks and block_path.is_file() and block_path.stat().st_size >= min_valid_bytes:
            block_files.append(block_path)
            if on_progress is not None:
                on_progress("timeline", block_end, duration_ms)
            print(f"[CHECKPOINT] Bo qua block voice da hoan thanh: {block_end / 1000:.0f}/{duration_ms / 1000:.0f}s")
            continue

        try:
            with wave.open(str(block_tmp), "wb") as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(44100)
                first_w = block_start // window_ms
                last_w = max(first_w, (max(block_start + 1, block_end) - 1) // window_ms)
                for window_index in range(first_w, min(window_count, last_w + 1)):
                    window_start = window_index * window_ms
                    window_end = min(block_end, window_start + window_ms)
                    if window_end <= window_start:
                        continue
                    timeline = (
                        AudioSegment.silent(
                            duration=window_end - window_start,
                            frame_rate=44100,
                        )
                        .set_channels(2)
                        .set_sample_width(2)
                    )
                    for clip_start, clip_end, audio_path in window_clips[window_index]:
                        audio = AudioSegment.from_file(audio_path)
                        audio = audio.set_frame_rate(44100).set_channels(2).set_sample_width(2)
                        clip_offset = max(0, window_start - clip_start)
                        clip_limit = min(len(audio), window_end - clip_start)
                        if clip_limit <= clip_offset:
                            continue
                        timeline = timeline.overlay(
                            audio[clip_offset:clip_limit],
                            position=max(0, clip_start - window_start),
                        )
                    output.writeframes(timeline.raw_data)
                    if on_progress is not None:
                        on_progress("timeline", window_end, duration_ms)
                    print(
                        f"Voice timeline: {window_end / 1000:.0f}/"
                        f"{duration_ms / 1000:.0f}s"
                    )
            os.replace(block_tmp, block_path)
            block_files.append(block_path)
            gc.collect()
        except Exception:
            block_tmp.unlink(missing_ok=True)
            raise

    estimated_pcm_bytes = int(duration_ms / 1000.0 * 44100 * 4)
    use_ffmpeg_concat = output_path.suffix.lower() != ".wav" or estimated_pcm_bytes >= 3_800_000_000
    temporary_path = output_path.with_name(f"{output_path.stem}.tmp{output_path.suffix}")
    try:
        if use_ffmpeg_concat:
            if output_path.suffix.lower() == ".wav" and estimated_pcm_bytes >= 3_800_000_000:
                print("[WARN] Timeline vuot 3.8 GB cho chuan WAV -> dong goi FLAC de khong bi loi 4GB.")
                output_path = output_path.with_suffix(".flac")
                temporary_path = output_path.with_name(f"{output_path.stem}.tmp.flac")
            concat_list = chunk_dir / "concat.txt"
            concat_list.write_text(
                "".join(f"file '{path.resolve().as_posix()}'\n" for path in block_files),
                encoding="utf-8",
            )
            codec_args = (
                ["-c:a", "flac", "-compression_level", "3"]
                if output_path.suffix.lower() == ".flac"
                else ["-c:a", "aac", "-b:a", "192k"]
            )
            result = subprocess.run(
                [
                    "ffmpeg", "-y", "-nostdin",
                    "-f", "concat", "-safe", "0", "-i", str(concat_list),
                    *codec_args,
                    str(temporary_path),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
                creationflags=MEDIA_CREATIONFLAGS,
            )
            if result.returncode != 0:
                raise RuntimeError("Ghep voice timeline FLAC that bai: " + (result.stderr or "")[-400:])
        else:
            with wave.open(str(temporary_path), "wb") as final_wav:
                final_wav.setnchannels(2)
                final_wav.setsampwidth(2)
                final_wav.setframerate(44100)
                for block_path in block_files:
                    with wave.open(str(block_path), "rb") as part_wav:
                        while True:
                            frames = part_wav.readframes(65536)
                            if not frames:
                                break
                            final_wav.writeframes(frames)
        os.replace(temporary_path, output_path)
        shutil.rmtree(chunk_dir, ignore_errors=True)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise

    print(
        "\nDa tao voice timeline:"
    )

    print(
        output_path
    )
    return str(output_path)


# =========================================================
# MAIN
# =========================================================

if __name__ == "__main__":
    print(
        "\n=============================="
    )

    print(
        "BAT DAU VIETNAMESE TTS"
    )

    print(
        "=============================="
    )

    print(
        f"Provider: "
        f"{TTS_PROVIDER}"
    )

    print(
        f"Voice: "
        f"{VOICE}"
    )

    print(
        f"Backend: "
        f"{VIENEU_BACKEND}"
    )

    subtitles = read_srt(
        INPUT_SRT
    )

    print(
        f"\nTong subtitle: "
        f"{len(subtitles)}"
    )

    if not subtitles:
        raise RuntimeError(
            "Khong co subtitle."
        )

    manifest = create_tts_clips(
        subtitles
    )

    video_duration = (
        get_video_duration_ms(
            VIDEO_FILE
        )
    )

    if video_duration is None:
        video_duration = (
            subtitles[-1][
                "end_ms"
            ]
            + 1000
        )

    print(
        f"\nVideo duration: "
        f"{video_duration / 1000:.2f}s"
    )

    build_voice_timeline(
        manifest,
        video_duration,
    )

    print(
        "\n=============================="
    )

    print(
        "HOAN THANH TTS"
    )

    print(
        "=============================="
    )
