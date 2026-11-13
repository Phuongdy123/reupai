from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import wave
from functools import lru_cache
from pathlib import Path
from typing import Callable


# =========================
# LOAD WHISPER MODEL
# =========================

WHISPER_MODEL = os.getenv("REUP_WHISPER_MODEL", "small").strip() or "small"
WHISPER_DEVICE = os.getenv("REUP_WHISPER_DEVICE", "auto").strip().lower() or "auto"


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


WHISPER_BEAM_SIZE = _positive_int("REUP_WHISPER_BEAM_SIZE", 3)
_CUDA_DISABLED_FOR_SESSION = False
_LONG_AUDIO_THRESHOLD_SECONDS = 60 * 60
_CHUNK_SECONDS = 10 * 60
_CHUNK_OVERLAP_SECONDS = 2


def _cpu_threads() -> int:
    """Leave capacity for the Local Engine and browser while transcribing."""
    configured = _positive_int("REUP_WHISPER_CPU_THREADS", 0)
    if configured:
        return configured
    return min(8, max(4, (os.cpu_count() or 4) - 2))


@lru_cache(maxsize=1)
def _ensure_native_runtime() -> None:
    """Keep a broken native import from terminating the video job process."""
    with tempfile.TemporaryDirectory(prefix="reupai-whisper-check-") as scratch:
        report_path = Path(scratch) / "result.json"
        if getattr(sys, "frozen", False):
            command = [sys.executable, "--check-whisper", str(report_path)]
        else:
            command = [
                sys.executable, "-c",
                "import ctranslate2; from faster_whisper import WhisperModel",
            ]
        try:
            completed = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                timeout=90,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RuntimeError(
                "Không thể kiểm tra thư viện nhận diện giọng nói Whisper trên máy này. "
                f"Chi tiết: {type(error).__name__}: {error}"
            ) from error
        if completed.returncode == 0:
            return
        detail = ""
        if report_path.is_file():
            try:
                report = json.loads(report_path.read_text(encoding="utf-8"))
                detail = str(report.get("error", ""))[:320]
            except (OSError, ValueError):
                pass
        if not detail:
            detail = (completed.stderr or "").strip()[-320:]
        if not detail:
            detail = f"tiến trình kiểm tra dừng với mã {completed.returncode}"
        raise RuntimeError(
            "Whisper/CTranslate2 không nạp được thư viện hệ thống. "
            "Hãy cài lại bản ReupAI đầy đủ và gửi nhật ký nếu lỗi tiếp diễn. "
            f"Chi tiết: {detail}"
        )


@lru_cache(maxsize=1)
def _whisper_model_class():
    _ensure_native_runtime()
    try:
        from faster_whisper import WhisperModel
    except (ImportError, OSError) as error:
        raise RuntimeError(
            "Whisper/CTranslate2 không nạp được sau bước kiểm tra độc lập. "
            f"Chi tiết: {type(error).__name__}: {error}"
        ) from error
    return WhisperModel


def _create_model():
    """Prefer CUDA when its libraries are usable, then safely fall back to CPU."""
    WhisperModel = _whisper_model_class()
    if _CUDA_DISABLED_FOR_SESSION:
        return _cpu_model()
    cpu_options = {
        "device": "cpu",
        "compute_type": "int8",
        "cpu_threads": _cpu_threads(),
        "num_workers": 1,
    }
    if WHISPER_DEVICE in {"cpu", "none"}:
        print(f"Whisper: {WHISPER_MODEL} / CPU / {_cpu_threads()} threads")
        return WhisperModel(WHISPER_MODEL, **cpu_options)

    if WHISPER_DEVICE in {"auto", "cuda", "gpu"}:
        try:
            model = WhisperModel(
                WHISPER_MODEL,
                device="cuda",
                compute_type="float16",
                num_workers=1,
            )
            print(f"Whisper: {WHISPER_MODEL} / NVIDIA CUDA / float16")
            return model
        except Exception as error:
            if WHISPER_DEVICE in {"cuda", "gpu"}:
                print(f"Whisper CUDA khong kha dung, chuyen sang CPU: {error}")
            else:
                print("Whisper CUDA khong kha dung, dung CPU toi uu.")

    print(f"Whisper: {WHISPER_MODEL} / CPU / {_cpu_threads()} threads")
    return WhisperModel(WHISPER_MODEL, **cpu_options)


@lru_cache(maxsize=1)
def _model():
    # Delay the model load until a transcription job actually needs it. This
    # keeps the local engine responsive and lets Gemini preflight fail fast.
    return _create_model()


@lru_cache(maxsize=1)
def _cpu_model():
    return _whisper_model_class()(
        WHISPER_MODEL,
        device="cpu",
        compute_type="int8",
        cpu_threads=_cpu_threads(),
        num_workers=1,
    )


def _is_cuda_runtime_error(error: Exception) -> bool:
    value = str(error).lower()
    return any(token in value for token in (
        "cublas", "cudnn", "cudart", "cuda driver", "cuda error",
        "libcuda", "nvidia driver", "no cuda",
    ))


def _run_transcription(model, audio, language: str | None = None):
    """Materialize segments while the CUDA fallback guard is still active."""
    options = {"beam_size": WHISPER_BEAM_SIZE}
    if language:
        options["language"] = language
    segments, info = model.transcribe(audio, **options)
    return list(segments), info


def _transcribe_once(audio, language: str | None = None):
    global _CUDA_DISABLED_FOR_SESSION
    model = _model()
    try:
        return _run_transcription(model, audio, language)
    except Exception as error:
        # CUDA can fail only when the first audio window is decoded. Retry that
        # window on CPU; already completed long-audio windows are retained.
        if WHISPER_DEVICE not in {"auto", "cuda", "gpu"} or not _is_cuda_runtime_error(error):
            raise
        print(f"Whisper CUDA loi ({error}); chuyen sang CPU toi uu.")
        _CUDA_DISABLED_FOR_SESSION = True
        _model.cache_clear()
        return _run_transcription(_cpu_model(), audio, language)


def _chunkable_wav_duration(audio_path: str) -> float | None:
    """Return a duration only for the PCM format produced by the pipeline."""
    try:
        with wave.open(audio_path, "rb") as source:
            if (source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getcomptype()) != (1, 2, 16000, "NONE"):
                return None
            return source.getnframes() / 16000
    except (OSError, EOFError, wave.Error):
        return None


def _transcribe_long_wav(
    audio_path: str,
    duration: float,
    on_progress: Callable[[float, float], None] | None,
    source_language: str | None = None,
) -> list[dict]:
    """Bound decode memory by transcribing ten-minute audio windows."""
    import numpy as np

    chunk_frames = _CHUNK_SECONDS * 16000
    overlap_frames = _CHUNK_OVERLAP_SECONDS * 16000
    results: list[dict] = []
    language: str | None = source_language
    with wave.open(audio_path, "rb") as source:
        total_frames = source.getnframes()
        for core_start in range(0, total_frames, chunk_frames):
            core_end = min(total_frames, core_start + chunk_frames)
            read_start = max(0, core_start - overlap_frames)
            read_end = min(total_frames, core_end + overlap_frames)
            source.setpos(read_start)
            raw = source.readframes(read_end - read_start)
            if len(raw) != (read_end - read_start) * 2:
                raise RuntimeError("Không đọc đủ dữ liệu âm thanh cho Whisper.")
            pcm = np.frombuffer(raw, dtype="<i2")
            processed = core_end / 16000
            if not np.any(pcm):
                print(f"Whisper: {processed:.0f}/{duration:.0f} giay; bo qua khoang im lang")
                if on_progress:
                    on_progress(processed, duration)
                continue
            audio = pcm.astype(np.float32) / 32768.0
            segments, info = _transcribe_once(audio, language)
            if not language and segments and (getattr(info, "language_probability", 0) or 0) >= 0.6:
                language = info.language
            read_offset = read_start / 16000
            floor = core_start / 16000
            ceiling = core_end / 16000
            for segment in segments:
                start = read_offset + segment.start
                end = read_offset + segment.end
                midpoint = (start + end) / 2
                # Assign overlapping speech to exactly one core window.
                if not floor <= midpoint < ceiling:
                    continue
                text = segment.text.strip()
                if not text:
                    continue
                start = max(0.0, min(duration, start))
                if results:
                    start = max(start, results[-1]["end"])
                end = min(duration, end)
                if end <= start:
                    continue
                results.append({"start": start, "end": end, "text": text})
            print(f"Whisper: {processed:.0f}/{duration:.0f} giay; {len(results)} doan loi thoai")
            if on_progress:
                on_progress(processed, duration)
    return results


# =========================
# TRANSCRIBE AUDIO
# =========================

def transcribe(
    audio_path: str,
    *,
    on_progress: Callable[[float, float], None] | None = None,
    language: str | None = None,
):
    print("Dang nhan dien audio...")

    duration = _chunkable_wav_duration(audio_path)
    if duration is not None and duration > _LONG_AUDIO_THRESHOLD_SECONDS:
        return _transcribe_long_wav(audio_path, duration, on_progress, language)

    segments, info = _transcribe_once(audio_path, language)
    if on_progress:
        total = duration or getattr(info, "duration", 0) or 0
        if total > 0:
            on_progress(total, total)

    print(f"Language detected: {info.language}")
    print(
        f"Language probability: "
        f"{info.language_probability:.2f}"
    )

    results = []

    for segment in segments:

        text = segment.text.strip()

        # bỏ segment rỗng
        if not text:
            continue

        print(
            f"{segment.start:.2f} --> "
            f"{segment.end:.2f} | "
            f"{text}"
        )

        results.append({
            "start": segment.start,
            "end": segment.end,
            "text": text
        })

    return results


# =========================
# FORMAT TIME CHO SRT
# =========================

def format_srt_time(seconds: float):

    total_milliseconds = round(
        seconds * 1000
    )

    hours = (
        total_milliseconds
        // 3_600_000
    )

    minutes = (
        total_milliseconds
        % 3_600_000
        // 60_000
    )

    secs = (
        total_milliseconds
        % 60_000
        // 1000
    )

    milliseconds = (
        total_milliseconds
        % 1000
    )

    return (
        f"{hours:02}:"
        f"{minutes:02}:"
        f"{secs:02},"
        f"{milliseconds:03}"
    )


# =========================
# SAVE SRT
# =========================

def save_srt(
    segments,
    output_path: str
):

    # tự tạo thư mục output nếu chưa tồn tại
    output_dir = os.path.dirname(
        output_path
    )

    if output_dir:
        os.makedirs(
            output_dir,
            exist_ok=True
        )

    with open(
        output_path,
        "w",
        encoding="utf-8-sig"
    ) as file:

        for index, segment in enumerate(
            segments,
            start=1
        ):

            start_time = format_srt_time(
                segment["start"]
            )

            end_time = format_srt_time(
                segment["end"]
            )

            text = segment["text"]

            file.write(
                f"{index}\n"
            )

            file.write(
                f"{start_time} --> "
                f"{end_time}\n"
            )

            file.write(
                f"{text}\n\n"
            )

    print(
        f"\nDa tao subtitle: "
        f"{output_path}"
    )


# =========================
# MAIN
# =========================

if __name__ == "__main__":

    print(
        "\n===== BAT DAU WHISPER =====\n"
    )

    audio_path = "app/temp/horizontal_test.wav"
    output_path = "app/output/horizontal_chinese.srt"

    if not os.path.exists(audio_path):
        print(
            f"Khong tim thay audio: {audio_path}"
        )
        exit()

    results = transcribe(
        audio_path
    )

    print(
        "\n===== KET QUA ====="
    )

    print(
        f"Tong segments: {len(results)}"
    )

    if results:

        save_srt(
            results,
            output_path
        )

    else:

        print(
            "Khong co subtitle de xuat."
        )

    print(
        "\n===== BAT DAU WHISPER =====\n"
    )

    audio_path = (
        "app/temp/test2.wav"
    )

    output_path = (
        "app/output/chinese.srt"
    )

    # kiểm tra audio tồn tại
    if not os.path.exists(
        audio_path
    ):

        print(
            f"Khong tim thay audio: "
            f"{audio_path}"
        )

        exit()

    # Whisper
    results = transcribe(
        audio_path
    )

    print(
        "\n===== KET QUA ====="
    )

    print(
        f"Tong segments: "
        f"{len(results)}"
    )

    # Xuất SRT
    if results:

        save_srt(
            results,
            output_path
        )

    else:

        print(
            "Khong co subtitle de xuat."
        )
