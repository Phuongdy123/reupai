from faster_whisper import WhisperModel
import os


# =========================
# LOAD WHISPER MODEL
# =========================

model = WhisperModel(
    "small",
    device="cpu",
    compute_type="int8"
)


# =========================
# TRANSCRIBE AUDIO
# =========================

def transcribe(audio_path: str):
    print("Dang nhan dien audio...")

    segments, info = model.transcribe(
        audio_path,
        beam_size=5
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