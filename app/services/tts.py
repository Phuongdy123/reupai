import atexit
import asyncio
import json
import os
import re
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

try:
    # CPU/ONNX inference is serialized inside one VieNeu engine.  Two engines
    # use more RAM but can synthesize separate subtitle lines concurrently.
    TTS_ONNX_WORKERS = int(os.getenv("REUP_TTS_ONNX_WORKERS", "1"))
except ValueError:
    TTS_ONNX_WORKERS = 1

TTS_ONNX_WORKERS = max(1, min(TTS_ONNX_WORKERS, 2))

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
EDGE_RATE = "+10%"
EDGE_PITCH = "+0Hz"

MAX_RETRIES = 3

# Existing timing behavior is preserved.
# We only lower the warning threshold so very large atempo changes are visible.
COMFORT_SPEED_WARNING = 1.22

# Toc do doc co ban. 1.10 = nhanh hon 10%.
try:
    BASE_TTS_SPEED = float(
        os.getenv("REUP_TTS_SPEED", "1.10")
    )
except ValueError:
    BASE_TTS_SPEED = 1.10

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
    if VIENEU_THREADS > 0:
        # In Turbo mode each worker owns a separate ONNX runtime. Divide the
        # configured CPU budget between them so REUP_VIENEU_THREADS=8 means
        # two engines x four threads, instead of oversubscribing sixteen.
        workers = TTS_ONNX_WORKERS if _parallel_onnx_enabled() else 1
        kwargs["threads"] = max(1, VIENEU_THREADS // workers)
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

    communicate = (
        edge_tts.Communicate(
            text=text,
            voice=EDGE_VOICE,
            rate=EDGE_RATE,
            pitch=EDGE_PITCH,
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
    provider = (
        TTS_PROVIDER
    )

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
                and EDGE_FALLBACK_ENABLED
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

    value = (
        VOICE.lower()
        .replace(
            " ",
            "_",
        )
    )

    value = re.sub(
        r"[^a-z0-9_]+",
        "",
        value,
    )

    return (
        value
        or "voice"
    )


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


def _parallel_onnx_enabled():
    return (
        TTS_PROVIDER == "vieneu"
        and VIENEU_BACKEND == "onnx"
        and TTS_ONNX_WORKERS > 1
    )


def _generate_parallel_raw_tts(pending):
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

    # The default remains one engine.  Turbo is opt-in through engine.env so
    # existing installations preserve their current memory footprint.
    if _parallel_onnx_enabled():
        pending = []
        for index, subtitle in enumerate(subtitles, start=1):
            subtitle_id = subtitle["id"]
            raw_wav, _ = _tts_file_paths(subtitle_id, voice_slug)
            if not (os.path.isfile(raw_wav) and os.path.getsize(raw_wav) > 44):
                pending.append((index, subtitle_id, subtitle["text"], raw_wav))
        _generate_parallel_raw_tts(pending)

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

        fit_info = None
        if reuse_fitted and raw_existed and os.path.isfile(fitted_wav) and os.path.getsize(fitted_wav) > 44:
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

        save_json(
            manifest,
            MANIFEST_FILE,
        )

    return manifest


# =========================================================
# BUILD FULL TIMELINE
# =========================================================

def build_voice_timeline(
    manifest,
    total_duration_ms
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

    timeline = (
        AudioSegment.silent(
            duration=
                total_duration_ms,
            frame_rate=44100,
        )
        .set_channels(2)
        .set_sample_width(2)
    )

    for index, item in enumerate(
        manifest,
        start=1,
    ):
        audio = (
            AudioSegment
            .from_file(
                item[
                    "audio_file"
                ]
            )
        )

        start_ms = (
            item[
                "start_ms"
            ]
        )

        print(
            f"Overlay "
            f"{index}/{len(manifest)} "
            f"tai "
            f"{start_ms / 1000:.2f}s"
        )

        timeline = (
            timeline.overlay(
                audio,
                position=
                    start_ms,
            )
        )

    output_dir = os.path.dirname(
        OUTPUT_AUDIO
    )

    if output_dir:
        os.makedirs(
            output_dir,
            exist_ok=True,
        )

    timeline.export(
        OUTPUT_AUDIO,
        format="wav",
    )

    print(
        "\nDa tao voice timeline:"
    )

    print(
        OUTPUT_AUDIO
    )


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
