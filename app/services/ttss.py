import os
import re
import json
import time
import asyncio
import subprocess

import edge_tts
from pydub import AudioSegment


# =========================================================
# CONFIG
# =========================================================
# =========================================================
# CONFIG - HORIZONTAL VIDEO
# =========================================================

INPUT_SRT = "app/output/horizontal_vietnamese.srt"

VIDEO_FILE = "app/downloads/horizontal_test.mp4"

TTS_FOLDER = "app/temp/tts_horizontal"

OUTPUT_AUDIO = "app/output/horizontal_vietnamese_voice.wav"

MANIFEST_FILE = "app/output/horizontal_tts_manifest.json"


# Voice chinh
VOICE = "vi-VN-HoaiMyNeural"

# Edge TTS co the bi NoAudioReceived tam thoi.
# Neu voice nu loi, tu dong thu voice nam.
FALLBACK_VOICES = [
    "vi-VN-NamMinhNeural",
]

# Preset narrator
RATE = "+6%"
PITCH = "-2Hz"

# So lan thu cho MOI voice Edge.
EDGE_RETRIES_PER_VOICE = 3

# Cho giua cac lan retry.
EDGE_RETRY_WAITS = [
    2,
    5,
    10,
]

# Neu tat ca Edge voice deu loi, thu gTTS neu da cai.
ENABLE_GTTS_FALLBACK = True


# =========================================================
# TIME UTILS
# =========================================================

def srt_time_to_ms(time_text: str):

    hours, minutes, rest = time_text.split(":")

    seconds, milliseconds = rest.split(",")

    total_ms = (
        int(hours) * 3600000
        + int(minutes) * 60000
        + int(seconds) * 1000
        + int(milliseconds)
    )

    return total_ms


# =========================================================
# READ SRT
# =========================================================

def read_srt(file_path):

    if not os.path.exists(file_path):
        raise FileNotFoundError(
            f"Khong tim thay file: {file_path}"
        )

    with open(
        file_path,
        "r",
        encoding="utf-8-sig"
    ) as file:

        content = file.read()

    blocks = re.split(
        r"\n\s*\n",
        content.strip()
    )

    results = []

    for block in blocks:

        lines = block.strip().splitlines()

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

        start, end = lines[1].split(
            " --> ",
            1
        )

        text = " ".join(
            line.strip()
            for line in lines[2:]
        )

        start_ms = srt_time_to_ms(
            start.strip()
        )

        end_ms = srt_time_to_ms(
            end.strip()
        )

        results.append({
            "id": subtitle_id,
            "start": start.strip(),
            "end": end.strip(),
            "start_ms": start_ms,
            "end_ms": end_ms,
            "duration_ms": end_ms - start_ms,
            "text": text
        })

    return results


# =========================================================
# GET VIDEO DURATION
# =========================================================

def get_video_duration_ms(
    video_path
):

    if not os.path.exists(video_path):
        return None

    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        video_path
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=True
    )

    seconds = float(
        result.stdout.strip()
    )

    return int(
        seconds * 1000
    )


# =========================================================
# GET AUDIO DURATION
# =========================================================

def get_audio_duration(
    audio_path
):

    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        audio_path
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=True
    )

    return float(
        result.stdout.strip()
    )


# =========================================================
# TTS HELPERS
# =========================================================

def clean_tts_text(
    text
):
    value = str(
        text
        or ""
    )

    # Loai bo mot so ky tu vo hinh co the lam request TTS loi.
    value = (
        value
        .replace("\u200b", "")
        .replace("\u200c", "")
        .replace("\u200d", "")
        .replace("\ufeff", "")
        .replace("\x00", "")
    )

    value = re.sub(
        r"\s+",
        " ",
        value
    ).strip()

    if not value:
        raise ValueError(
            "TTS text rong."
        )

    return value


def remove_bad_audio(
    path
):
    try:
        if os.path.exists(
            path
        ):
            os.remove(
                path
            )
    except OSError:
        pass


def audio_file_ok(
    path
):
    if (
        not os.path.exists(
            path
        )
        or os.path.getsize(
            path
        ) < 512
    ):
        return False

    try:
        duration = (
            get_audio_duration(
                path
            )
        )

        return (
            duration > 0.05
        )

    except Exception:
        return False


# =========================================================
# EDGE TTS
# =========================================================

async def generate_edge_tts_once(
    text,
    output_path,
    voice
):

    communicate = edge_tts.Communicate(
        text=text,
        voice=voice,
        rate=RATE,
        pitch=PITCH
    )

    await communicate.save(
        output_path
    )


def generate_gtts(
    text,
    output_path
):
    """
    Fallback cuoi khi Edge TTS tam thoi khong tra audio.
    Can:
        pip install -U gTTS
    """

    try:
        from gtts import gTTS

    except ImportError as error:
        raise RuntimeError(
            "Tat ca Edge TTS voice deu loi va chua cai gTTS. "
            "Hay chay: "
            "venv\\Scripts\\python.exe -m pip install -U gTTS"
        ) from error

    remove_bad_audio(
        output_path
    )

    print(
        "[TTS FALLBACK] "
        "Dang thu Google gTTS..."
    )

    tts = gTTS(
        text=text,
        lang="vi",
        slow=False
    )

    tts.save(
        output_path
    )

    if not audio_file_ok(
        output_path
    ):
        remove_bad_audio(
            output_path
        )

        raise RuntimeError(
            "gTTS khong tao duoc audio hop le."
        )

    print(
        "[TTS OK] Provider: gTTS"
    )


def generate_tts(
    text,
    output_path
):

    text = clean_tts_text(
        text
    )

    voices = []

    for voice in [
        VOICE,
        *FALLBACK_VOICES,
    ]:
        if (
            voice
            and voice not in voices
        ):
            voices.append(
                voice
            )

    errors = []

    for voice_index, voice in enumerate(
        voices,
        start=1
    ):

        print(
            f"[TTS] Edge voice "
            f"{voice_index}/{len(voices)}: "
            f"{voice}"
        )

        for attempt in range(
            1,
            EDGE_RETRIES_PER_VOICE + 1
        ):

            remove_bad_audio(
                output_path
            )

            try:

                asyncio.run(
                    generate_edge_tts_once(
                        text,
                        output_path,
                        voice
                    )
                )

                if not audio_file_ok(
                    output_path
                ):
                    raise RuntimeError(
                        "Edge TTS tao file rong "
                        "hoac audio khong hop le."
                    )

                print(
                    f"[TTS OK] Edge: {voice}"
                )

                return

            except Exception as error:

                remove_bad_audio(
                    output_path
                )

                error_name = (
                    type(error).__name__
                )

                error_text = (
                    str(error)
                )

                errors.append(
                    f"{voice}: "
                    f"{error_name}: "
                    f"{error_text}"
                )

                print(
                    f"[TTS WARN] "
                    f"{voice} "
                    f"lan {attempt}/"
                    f"{EDGE_RETRIES_PER_VOICE}: "
                    f"{error_name}: "
                    f"{error_text}"
                )

                if (
                    attempt
                    < EDGE_RETRIES_PER_VOICE
                ):

                    wait_index = min(
                        attempt - 1,
                        len(
                            EDGE_RETRY_WAITS
                        ) - 1
                    )

                    wait_time = (
                        EDGE_RETRY_WAITS[
                            wait_index
                        ]
                    )

                    print(
                        f"Thu lai sau "
                        f"{wait_time}s..."
                    )

                    time.sleep(
                        wait_time
                    )

        print(
            f"[TTS] Voice {voice} "
            "khong dung duoc -> "
            "thu voice tiep theo."
        )

    if ENABLE_GTTS_FALLBACK:

        try:

            generate_gtts(
                text,
                output_path
            )

            return

        except Exception as error:

            errors.append(
                "gTTS: "
                + type(error).__name__
                + ": "
                + str(error)
            )

            print(
                "[TTS WARN] "
                "gTTS fallback loi: "
                + str(error)
            )

    raise RuntimeError(
        "Khong tao duoc TTS sau tat ca fallback. "
        + " | ".join(
            errors[-6:]
        )
    )


# =========================================================
# BUILD ATEMPO FILTER
# =========================================================

def build_atempo_filter(
    speed_ratio
):

    filters = []

    ratio = speed_ratio

    # FFmpeg atempo moi filter
    # hoat dong tot trong range 0.5 - 2.0

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

    # Neu TTS da ngan hon slot
    # khong can tang/giảm toc
    if (
        original_duration
        <= target_duration_seconds
    ):

        command = [
            "ffmpeg",
            "-y",
            "-i",
            input_file,
            "-ar",
            "44100",
            "-ac",
            "2",
            output_file
        ]

        subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True
        )

        return {
            "original_duration":
                original_duration,

            "final_duration":
                get_audio_duration(
                    output_file
                ),

            "speed":
                1.0
        }

    # ===============================================
    # TTS dai hon slot
    # phai tang toc
    # ===============================================

    speed_ratio = (
        original_duration
        / target_duration_seconds
    )

    atempo_filter = (
        build_atempo_filter(
            speed_ratio
        )
    )

    command = [
        "ffmpeg",
        "-y",
        "-i",
        input_file,
        "-filter:a",
        atempo_filter,
        "-ar",
        "44100",
        "-ac",
        "2",
        output_file
    ]

    subprocess.run(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True
    )

    final_duration = (
        get_audio_duration(
            output_file
        )
    )

    return {
        "original_duration":
            original_duration,

        "final_duration":
            final_duration,

        "speed":
            speed_ratio
    }


# =========================================================
# SAVE JSON
# =========================================================

def save_json(
    data,
    output_path
):

    os.makedirs(
        os.path.dirname(
            output_path
        ),
        exist_ok=True
    )

    with open(
        output_path,
        "w",
        encoding="utf-8"
    ) as file:

        json.dump(
            data,
            file,
            ensure_ascii=False,
            indent=2
        )


# =========================================================
# CREATE ALL TTS CLIPS
# =========================================================

def create_tts_clips(
    subtitles
):

    os.makedirs(
        TTS_FOLDER,
        exist_ok=True
    )

    manifest = []

    total = len(
        subtitles
    )

    for index, subtitle in enumerate(
        subtitles,
        start=1
    ):

        subtitle_id = (
            subtitle["id"]
        )

        print(
            "\n=============================="
        )

        print(
            f"TTS {index}/{total} "
            f"- ID {subtitle_id}"
        )

        print(
            subtitle["text"]
        )

        raw_mp3 = os.path.join(
            TTS_FOLDER,
            f"{subtitle_id:04d}_raw.mp3"
        )

        fitted_wav = os.path.join(
            TTS_FOLDER,
            f"{subtitle_id:04d}.wav"
        )

        # ===============================================
        # RESUME:
        # neu file da co thi khong tao lai TTS
        # ===============================================

        if not audio_file_ok(
            raw_mp3
        ):

            # Neu lan truoc tao file rong/corrupt,
            # xoa di de tao lai.
            remove_bad_audio(
                raw_mp3
            )

            print(
                "Dang tao voice..."
            )

            generate_tts(
                subtitle["text"],
                raw_mp3
            )

        else:

            print(
                "Raw TTS hop le da ton tai -> skip"
            )

        target_seconds = (
            subtitle["duration_ms"]
            / 1000
        )

        # ===============================================
        # FIT DURATION
        # ===============================================

        fit_info = fit_audio(
            raw_mp3,
            fitted_wav,
            target_seconds
        )

        speed = fit_info[
            "speed"
        ]

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

        # cảnh báo nếu phải tăng quá nhanh
        warning = None

        if speed > 1.35:

            warning = (
                "TTS qua dai. "
                "Nen rut gon cau bang AI."
            )

            print(
                "CANH BAO: "
                + warning
            )

        manifest.append({
            **subtitle,
            "raw_audio": raw_mp3,
            "audio_file": fitted_wav,
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
                warning
        })

        # save sau tung cau
        save_json(
            manifest,
            MANIFEST_FILE
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

    # Tao track im lang bang duration video
    timeline = AudioSegment.silent(
        duration=total_duration_ms,
        frame_rate=44100
    )

    timeline = (
        timeline
        .set_channels(2)
        .set_sample_width(2)
    )

    for index, item in enumerate(
        manifest,
        start=1
    ):

        audio = AudioSegment.from_file(
            item["audio_file"]
        )

        start_ms = (
            item["start_ms"]
        )

        print(
            f"Overlay "
            f"{index}/{len(manifest)} "
            f"tai "
            f"{start_ms / 1000:.2f}s"
        )

        timeline = timeline.overlay(
            audio,
            position=start_ms
        )

    os.makedirs(
        os.path.dirname(
            OUTPUT_AUDIO
        ),
        exist_ok=True
    )

    timeline.export(
        OUTPUT_AUDIO,
        format="wav"
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
        f"Voice: {VOICE}"
    )

    print(
        f"Rate: {RATE}"
    )

    print(
        f"Pitch: {PITCH}"
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

    # ===============================================
    # TTS TUNG CAU
    # ===============================================

    manifest = create_tts_clips(
        subtitles
    )

    # ===============================================
    # LAY DURATION VIDEO
    # ===============================================

    video_duration = (
        get_video_duration_ms(
            VIDEO_FILE
        )
    )

    if video_duration is None:

        video_duration = (
            subtitles[-1]["end_ms"]
            + 1000
        )

    print(
        f"\nVideo duration: "
        f"{video_duration / 1000:.2f}s"
    )

    # ===============================================
    # BUILD FULL AUDIO
    # ===============================================

    build_voice_timeline(
        manifest,
        video_duration
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