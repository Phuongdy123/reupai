import os
from functools import lru_cache

from faster_whisper import WhisperModel


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


def _cpu_threads() -> int:
    """Leave capacity for the Local Engine and browser while transcribing."""
    configured = _positive_int("REUP_WHISPER_CPU_THREADS", 0)
    if configured:
        return configured
    return min(8, max(4, (os.cpu_count() or 4) - 2))


def _create_model() -> WhisperModel:
    """Prefer CUDA when its libraries are usable, then safely fall back to CPU."""
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
def _model() -> WhisperModel:
    # Delay the model load until a transcription job actually needs it. This
    # keeps the local engine responsive and lets Gemini preflight fail fast.
    return _create_model()


# =========================
# TRANSCRIBE AUDIO
# =========================

def transcribe(audio_path: str):
    print("Dang nhan dien audio...")

    segments, info = _model().transcribe(
        audio_path,
        beam_size=WHISPER_BEAM_SIZE,
    )

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
