import argparse

import base64



import hashlib



import json



import os



import re



import shutil



import subprocess



import sys



from datetime import datetime



from pathlib import Path











# =========================================================



# PROJECT PATHS



# =========================================================







APP_DIR = Path(__file__).resolve().parent
if APP_DIR.name.lower() == "core" and (APP_DIR.parent / "services").exists():
    APP_DIR = APP_DIR.parent



PROJECT_ROOT = APP_DIR.parent

try:
    from runtime_paths import get_channels_dir, get_jobs_dir
except ImportError:  # pragma: no cover - standalone legacy invocation
    get_channels_dir = lambda: APP_DIR / "channels"
    get_jobs_dir = lambda: APP_DIR / "jobs"











def configure_project_root():



    global APP_DIR, PROJECT_ROOT







    candidate = Path(__file__).resolve().parent

    # The implementation lives in app/core while runtime paths stay under app/.
    if candidate.name.lower() == "core" and (candidate.parent / "services").exists():
        candidate = candidate.parent







    if candidate.name.lower() == "app":



        APP_DIR = candidate



        PROJECT_ROOT = candidate.parent



    else:



        cwd = Path.cwd().resolve()







        if (cwd / "app" / "services").exists():



            PROJECT_ROOT = cwd



            APP_DIR = cwd / "app"



        else:



            PROJECT_ROOT = candidate.parent



            APP_DIR = candidate







    os.chdir(PROJECT_ROOT)







    if str(APP_DIR) not in sys.path:



        sys.path.insert(0, str(APP_DIR))











configure_project_root()











# Tranh loi Paddle oneDNN tren Windows CPU



os.environ.setdefault(



    "PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT",



    "0",



)







os.environ.setdefault(



    "FLAGS_use_mkldnn",



    "0",



)











# =========================================================



# HELPERS



# =========================================================











def rel(path: Path) -> str:



    path = Path(path).resolve()







    try:



        return path.relative_to(PROJECT_ROOT.resolve()).as_posix()



    except ValueError:



        return str(path)











def file_ok(path: Path) -> bool:



    path = Path(path)



    return path.exists() and path.is_file() and path.stat().st_size > 0











def run(command, *, quiet=False):



    print("\n$", " ".join(str(x) for x in command))







    kwargs = {



        "cwd": str(PROJECT_ROOT),



        "check": True,



    }







    if quiet:



        kwargs["stdout"] = subprocess.DEVNULL



        kwargs["stderr"] = subprocess.DEVNULL







    subprocess.run(command, **kwargs)











def require_command(name: str):



    if shutil.which(name) is None:



        raise RuntimeError(f"Khong tim thay '{name}' trong PATH.")











def detect_platform(
    url: str,
) -> str:

    value = (
        str(url)
        .strip()
        .lower()
    )

    if (
        "bilibili.com"
        in value
        or "b23.tv"
        in value
    ):
        return "bilibili"

    if (
        "douyin.com"
        in value
    ):
        return "douyin"

    return "unknown"


def get_job_id(url: str) -> str:

    match = re.search(
        r"\b(BV[0-9A-Za-z]+)\b",
        url,
    )

    if match:
        return match.group(1)

    patterns = [
        r"douyin\.com/video/(\d{10,25})",
        r"[?&]modal_id=(\d{10,25})",
        r"[?&]vid=(\d{10,25})",
    ]

    for pattern in patterns:
        match = re.search(
            pattern,
            url,
        )

        if match:
            return match.group(1)

    digest = hashlib.sha1(
        url.encode(
            "utf-8"
        )
    ).hexdigest()[:12]

    return (
        f"job_{digest}"
    )


def normalize_channel_key(channel: str | None) -> str | None:



    if channel is None:



        return None







    channel = channel.strip()







    if not channel:



        return None







    if not re.fullmatch(r"[A-Za-z0-9_-]+", channel):



        raise ValueError(



            "Channel key khong hop le. Chi dung chu, so, dau _ hoac -."



        )







    return channel











def resolve_existing_path(value: str | Path) -> Path:



    path = Path(value)







    if not path.is_absolute():



        path = PROJECT_ROOT / path







    return path.resolve()











def find_source_video(job_dir: Path):



    preferred = job_dir / "source.mp4"







    if file_ok(preferred):



        return preferred







    for ext in ("mp4", "mkv", "webm", "mov"):



        path = job_dir / f"source.{ext}"







        if file_ok(path):



            return path







    return None











def save_json(path: Path, data: dict):



    path.parent.mkdir(parents=True, exist_ok=True)







    with open(path, "w", encoding="utf-8") as file:



        json.dump(data, file, ensure_ascii=False, indent=2)











def save_job_info(job_dir: Path, data: dict):



    save_json(job_dir / "job.json", data)











def write_progress(



    job_dir: Path,



    *,



    stage: str,



    percent: int,



    status: str,



    message: str,



    mode: str,



):



    save_json(



        job_dir / "progress.json",



        {



            "stage": stage,



            "percent": int(max(0, min(100, percent))),



            "status": status,



            "message": message,



            "mode": mode,



            "updated_at": datetime.now().isoformat(timespec="seconds"),



        },



    )











def remove_file(path: Path):



    try:



        if path.exists() and path.is_file():



            path.unlink()



    except OSError:



        pass











def clear_directory(path: Path):



    if not path.exists():



        return







    for child in path.iterdir():



        try:



            if child.is_dir():



                shutil.rmtree(child)



            else:



                child.unlink()



        except OSError:



            pass











# =========================================================



# STEP 1 - SOURCE VIDEO



# =========================================================











def build_ytdlp_command(
    url: str,
    output_template: str,
    *,
    use_browser_cookies=False,
    reliable=False,
):

    from services.download_config import ytdlp_performance_args

    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--continue",
        "--retries",
        "20",
        "--fragment-retries",
        "20",
        "--retry-sleep",
        "1",
        "--socket-timeout",
        "30",
    ]

    if reliable:
        # Một số máy chủ Bilibili trả response rất ngắn khi dùng chunk HTTP
        # hoặc nhiều fragment đồng thời. Profile này ưu tiên hoàn tất file.
        command.extend(["--concurrent-fragments", "1"])
    else:
        command.extend(ytdlp_performance_args())

    if use_browser_cookies:

        command.extend([
            "--cookies-from-browser",
            os.getenv(
                "REUP_COOKIE_BROWSER",
                "chrome",
            ),
        ])

    command.extend([
        "-f",
        "bv*[height<=720]+ba/b" if reliable else "bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "-o",
        output_template,
        url,
    ])

    return command


def download_video(
    url: str,
    job_dir: Path,
    force=False,
) -> Path:

    existing = (
        find_source_video(
            job_dir
        )
    )

    if existing and not force:

        print(
            "\n[SKIP] Video da ton tai:"
        )

        print(
            rel(
                existing
            )
        )

        return existing

    print(
        "\n=============================="
    )

    print(
        "1. DOWNLOAD VIDEO"
    )

    print(
        "=============================="
    )

    platform = (
        detect_platform(
            url
        )
    )

    print(
        "Platform:",
        platform
    )

    # Douyin hien co the fail o yt-dlp web detail API.
    # Dung Playwright session de lay media URL that.
    if platform == "douyin":

        from services.sources.douyin import (
            download_video as
                douyin_download_video
        )

        output_path = (
            job_dir
            / "source.mp4"
        )

        douyin_download_video(
            url,
            output_path,
        )

        if not file_ok(
            output_path
        ):
            raise RuntimeError(
                "Douyin downloader "
                "khong tao duoc source.mp4."
            )

        print(
            "\nOK:",
            rel(
                output_path
            )
        )

        return output_path

    output_template = str(
        job_dir
        / "source.%(ext)s"
    )

    attempts = (
        [(True, False), (False, False), (False, True)]
        if platform == "douyin"
        else [(False, False), (False, True), (True, True)]
    )

    last_error = None

    for use_cookies, reliable in attempts:

        command = (
            build_ytdlp_command(
                url,
                output_template,
                use_browser_cookies=
                    use_cookies,
                reliable=reliable,
            )
        )

        print(
            "\n[yt-dlp] cookies:",
            use_cookies,
            "reliable:",
            reliable,
        )

        try:

            run(
                command
            )

            last_error = None
            break

        except subprocess.CalledProcessError as error:

            last_error = error

            print(
                "[yt-dlp] lan nay loi, "
                "thu fallback..."
            )

    if last_error is not None:
        raise last_error

    source = (
        find_source_video(
            job_dir
        )
    )

    if not source:

        raise RuntimeError(
            "Khong tim thay source video "
            "sau khi download."
        )

    print(
        "\nOK:",
        rel(
            source
        )
    )

    return source


def get_source_video(



    url: str,



    job_dir: Path,



    source_file: str | None,



    force=False,



) -> Path:



    if source_file:



        source = resolve_existing_path(source_file)







        if not file_ok(source):



            raise FileNotFoundError(f"Khong tim thay --source-file: {source}")







        print("\n==============================")



        print("1. USE EXISTING VIDEO")



        print("==============================")



        print(rel(source))



        return source







    return download_video(url, job_dir, force=force)











# =========================================================



# STEP 2 - EXTRACT AUDIO



# =========================================================











def extract_audio(source_video: Path, audio_path: Path, force=False):



    if file_ok(audio_path) and not force:



        print("\n[SKIP] Audio da ton tai:")



        print(rel(audio_path))



        return







    print("\n==============================")



    print("2. EXTRACT AUDIO")



    print("==============================")







    run(



        [



            "ffmpeg",



            "-y",



            "-i",



            rel(source_video),



            "-vn",



            "-ac",



            "1",



            "-ar",



            "16000",



            "-c:a",



            "pcm_s16le",



            rel(audio_path),



        ]



    )







    if not file_ok(audio_path):



        raise RuntimeError("Khong tao duoc source_16k.wav.")











# =========================================================



# STEP 3 - WHISPER



# =========================================================











def transcribe_audio(audio_path: Path, chinese_srt: Path, force=False):



    if file_ok(chinese_srt) and not force:



        print("\n[SKIP] Chinese SRT da ton tai:")



        print(rel(chinese_srt))



        return







    print("\n==============================")



    print("3. WHISPER -> CHINESE SRT")



    print("==============================")







    from services import transcriber







    segments = transcriber.transcribe(rel(audio_path))







    if not segments:



        raise RuntimeError("Whisper khong tao duoc subtitle.")







    transcriber.save_srt(segments, rel(chinese_srt))







    if not file_ok(chinese_srt):



        raise RuntimeError("Khong tao duoc chinese.srt.")











# =========================================================



# STEP 4 - GEMINI TRANSLATION



# =========================================================











def translate_srt(



    job_id: str,



    chinese_srt: Path,



    vietnamese_srt: Path,



    checkpoint_path: Path,



    debug_path: Path,



    force=False,



):



    if file_ok(vietnamese_srt) and not force:



        print("\n[SKIP] Vietnamese SRT da ton tai:")



        print(rel(vietnamese_srt))



        return







    if force:



        remove_file(vietnamese_srt)



        remove_file(checkpoint_path)



        remove_file(debug_path)

    if not file_ok(chinese_srt) or not chinese_srt.read_text(encoding="utf-8").strip():
        vietnamese_srt.write_text("", encoding="utf-8")
        print("\n[SKIP] Chinese SRT rong, bo qua dich.")
        return







    print("\n==============================")



    print("4. GEMINI AI: TRUNG -> VIET")



    print("==============================")







    from services import translator







    if hasattr(translator, "JOB_NAME"):



        translator.JOB_NAME = job_id







    if hasattr(translator, "INPUT_SRT"):



        translator.INPUT_SRT = rel(chinese_srt)







    if hasattr(translator, "OUTPUT_SRT"):



        translator.OUTPUT_SRT = rel(vietnamese_srt)







    translator.CHECKPOINT_FILE = rel(checkpoint_path)







    if hasattr(translator, "DEBUG_FILE"):



        translator.DEBUG_FILE = rel(debug_path)







    subtitles = translator.read_srt(rel(chinese_srt))







    if not subtitles:



        raise RuntimeError("Chinese SRT rong.")







    if hasattr(translator, "get_file_hash"):



        source_hash = translator.get_file_hash(rel(chinese_srt))



        translated = translator.translate_all(subtitles, source_hash)



    else:



        translated = translator.translate_all(subtitles)







    if len(translated) != len(subtitles):



        raise RuntimeError("So cau dich khong khop source.")







    translator.save_srt(translated, rel(vietnamese_srt))







    if hasattr(translator, "save_json"):



        translator.save_json(translated, rel(debug_path))







    if not file_ok(vietnamese_srt):



        raise RuntimeError("Khong tao duoc vietnamese.srt.")











# =========================================================



# STEP 5 - EDGE TTS



# =========================================================











def create_voice(



    source_video: Path,



    vietnamese_srt: Path,



    voice_path: Path,



    tts_dir: Path,



    manifest_path: Path,



    force=False,

    voice_name=None,

    speed=None,



):



    if file_ok(voice_path) and not force:



        print("\n[SKIP] Voice da ton tai:")



        print(rel(voice_path))



        return







    if force:



        remove_file(voice_path)



        remove_file(manifest_path)



        clear_directory(tts_dir)







    print("\n==============================")



    print("5. EDGE TTS")



    print("==============================")







    from services import tts







    tts.INPUT_SRT = rel(vietnamese_srt)



    tts.VIDEO_FILE = rel(source_video)



    tts.TTS_FOLDER = rel(tts_dir)



    tts.OUTPUT_AUDIO = rel(voice_path)



    tts.MANIFEST_FILE = rel(manifest_path)

    if voice_name:
        tts.set_voice(voice_name)

    if speed is not None:
        tts.BASE_TTS_SPEED = max(0.5, min(float(speed), 2.0))







    subtitles = tts.read_srt(rel(vietnamese_srt))







    if not subtitles:



        raise RuntimeError("Vietnamese SRT rong.")







    manifest = tts.create_tts_clips(subtitles)



    video_duration = tts.get_video_duration_ms(rel(source_video))







    if video_duration is None:



        video_duration = subtitles[-1]["end_ms"] + 1000







    tts.build_voice_timeline(manifest, video_duration)







    if not file_ok(voice_path):



        raise RuntimeError("Khong tao duoc voice.wav.")











# =========================================================



# STEP 6 - AUTO DETECT SUBTITLE REGION



# =========================================================











def detect_subtitle_region(



    source_video: Path,



    region_path: Path,



    preview_image: Path,



    force=False,



):



    if file_ok(region_path) and not force:



        print("\n[SKIP] Subtitle region da ton tai:")



        print(rel(region_path))







        with open(region_path, "r", encoding="utf-8") as file:



            return json.load(file)







    print("\n==============================")



    print("6. AUTO SUBTITLE DETECTOR")



    print("==============================")







    from services import subtitle_detector as detector







    if hasattr(detector, "VIDEO_PATH"):



        detector.VIDEO_PATH = rel(source_video)







    if hasattr(detector, "OUTPUT_JSON"):



        detector.OUTPUT_JSON = rel(region_path)







    if hasattr(detector, "OUTPUT_PREVIEW"):



        detector.OUTPUT_PREVIEW = rel(preview_image)







    result = detector.detect_subtitle_region(rel(source_video))







    if isinstance(result, tuple):



        region, preview_frame = result



    else:



        region = result



        preview_frame = None







    save_json(region_path, region)







    if preview_frame is not None and hasattr(detector, "save_preview"):



        detector.save_preview(preview_frame, region)







    return region


def default_region_without_subtitle(source_video: Path) -> dict:
    """Return a valid layout when Whisper/OCR finds no subtitle."""
    width, height = 1920, 1080
    try:
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height", "-of", "csv=p=0",
                str(source_video),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        values = [int(value) for value in (probe.stdout or '').strip().split(',')]
        if len(values) == 2 and values[0] > 0 and values[1] > 0:
            width, height = values
    except (OSError, ValueError):
        pass
    return {
        "video": {"width": width, "height": height},
        # The renderer also uses this box to lay out Vietnamese subtitles.
        # Keep a usable bottom text area even though its blur is disabled.
        "blur": {
            "x": int(width * 0.07), "y": int(height * 0.80),
            "width": int(width * 0.86), "height": max(2, int(height * 0.10)),
        },
        "blur_enabled": False,
        "subtitle": {"x": width // 2, "y": int(height * 0.82), "position_percent": 82},
        "detected": {"method": "no_subtitle_fallback", "confidence": 0.0},
    }


def resolve_subtitle_region(
    source_video: Path, region_path: Path, preview_image: Path,
    *, config=None, no_subtitle=False, force=False,
) -> dict:
    """Resolve current selection separately from the cached automatic detection."""
    from services.subtitle_detector import SubtitleRegionNotFound

    config = config if isinstance(config, dict) else {}
    selected = config.get("blur_region")
    preset = config.get("blur_preset")
    has_selection = isinstance(selected, dict)
    if has_selection or preset in {"top", "bottom", "center"}:
        region = default_region_without_subtitle(source_video)
        region["blur_enabled"] = True
        region["detected"] = {"method": "manual_subtitle_region"}
        if has_selection:
            region["blur"] = {key: float(selected[key]) for key in ("x", "y", "width", "height")}
        else:
            width, height = region["video"]["width"], region["video"]["height"]
            box_height = max(2, int(height * 0.22))
            region["blur"] = {
                "x": 0, "y": {"top": 0, "bottom": height - box_height,
                              "center": (height - box_height) // 2}[preset],
                "width": width, "height": box_height,
            }
    elif no_subtitle:
        region = default_region_without_subtitle(source_video)
    else:
        # Never use the previous job's effective/manual selection as OCR cache.
        auto_path = region_path.with_name("subtitle_region_auto.json")
        try:
            region = detect_subtitle_region(source_video, auto_path, preview_image, force=force)
        except SubtitleRegionNotFound as error:
            region = default_region_without_subtitle(source_video)
            region["detected"] = {
                "method": "ocr_not_detected", "confidence": 0.0, "reason": error.reason,
            }
            region["warnings"] = [
                "OCR chưa xác định được vùng phụ đề gốc; video vẫn được xuất với "
                "Vietsub/Voice, chưa làm mờ phụ đề gốc. Có thể chọn vùng mờ sub thủ công rồi xử lý lại."
            ]
            print(f"[WARNING] {error}")
            print("[WARNING] Continuing without automatic subtitle blur. Select a manual region to cover the original text.")
        if region.get("blur_enabled", True):
            region = protect_auto_subtitle_from_top_watermark(region)

    save_json(region_path, region)
    return region


def protect_auto_subtitle_from_top_watermark(region: dict) -> dict:
    """Keep automatic subtitle placement away from fixed top logos/watermarks."""
    if not isinstance(region, dict):
        return region
    video = region.get("video") or {}
    try:
        width = int(float(video.get("width") or 0))
        height = int(float(video.get("height") or 0))
    except (TypeError, ValueError):
        return region
    if width <= 0 or height <= 0:
        return region
    blur = region.get("blur") or {}
    subtitle = region.get("subtitle") or {}
    try:
        blur_center_y = float(blur.get("y", 0)) + float(blur.get("height", 0)) / 2
        subtitle_y = float(subtitle.get("y", 0))
    except (TypeError, ValueError):
        return region
    # OCR frequently locks onto a persistent logo in the top band. Real
    # subtitles in this app are rendered in the lower band by default.
    if blur_center_y >= height * 0.35 and subtitle_y >= height * 0.35:
        return region
    # Chỉ chừa một khoảng đệm nhỏ quanh subtitle, không phủ toàn chiều ngang
    # như vùng watermark/logo ở đầu video.
    box_width = max(160, int(width * 0.72))
    box_x = max(0, int((width - box_width) / 2))
    box_height = max(80, int(height * 0.16))
    box_y = max(0, int(height * 0.78))
    detected = dict(region.get("detected") or {})
    detected.update({
        "auto_guard": "bottom_after_top_watermark",
        "original_blur": blur,
    })
    return {
        **region,
        "blur": {"x": box_x, "y": box_y, "width": box_width, "height": box_height},
        "subtitle": {
            "x": width // 2,
            "y": box_y + box_height // 2,
            "position_percent": round((box_y + box_height / 2) * 100 / height, 2),
        },
        "detected": detected,
    }











# =========================================================



# STEP 7A - VOICEOVER RENDERER



# =========================================================











def render_voiceover(

    source_video: Path,

    voice_path: Path,

    vietnamese_srt: Path,

    region_path: Path,

    ass_path: Path,

    output_path: Path,

    region: dict,

    preview_seconds=None,

    original_volume=0.15,

    voice_volume=1.0,

    font_size=None,

    aspect_ratio=None,

    logo_size=None,

    logo_x=None,

    logo_y=None,

    logo_mode="default",

    logo_text=None,

    logo_path=None,

    blur_intervals=None,

    music_path=None,

    music_volume=0.12,
    auto_brand_blur=False,
    
    

    force=False,

):

    if file_ok(output_path) and not force:

        print("\n[SKIP] Final voiceover da ton tai:")

        print(rel(output_path))

        return



    print("\n==============================")

    print("7. FINAL RENDER - VOICEOVER GPU")

    print("==============================")



    from services import final_renderer as renderer



    renderer.VIDEO_PATH = rel(source_video)

    renderer.VOICE_PATH = rel(voice_path)

    renderer.SRT_PATH = rel(vietnamese_srt)

    renderer.REGION_PATH = rel(region_path)

    renderer.ASS_PATH = rel(ass_path)

    renderer.OUTPUT_PATH = rel(output_path)



    renderer.ORIGINAL_VOLUME = original_volume

    renderer.VOICE_VOLUME = voice_volume

    renderer.FONT_SIZE_OVERRIDE = font_size
    renderer.OUTPUT_ASPECT_RATIO = aspect_ratio
    renderer.LOGO_SIZE_OVERRIDE = logo_size
    renderer.LOGO_X_OVERRIDE = logo_x
    renderer.LOGO_Y_OVERRIDE = logo_y
    renderer.LOGO_MODE = logo_mode or "default"
    renderer.LOGO_TEXT = logo_text
    renderer.LOGO_PATH_OVERRIDE = logo_path
    renderer.BLUR_INTERVALS = blur_intervals or []
    renderer.MUSIC_PATH = music_path
    renderer.MUSIC_VOLUME = music_volume
    renderer.AUTO_BRAND_BLUR_ENABLED = bool(auto_brand_blur)

    renderer.PREVIEW_SECONDS = preview_seconds

    renderer.RENDER_MODE = "voiceover"



    renderer.create_ass(region)

    renderer.render_final(region)



    if not file_ok(output_path):

        raise RuntimeError(

            "Final renderer khong tao duoc voiceover video."

        )







# =========================================================



# STEP 7B - SUBTITLE ONLY RENDERER



# =========================================================











def render_subtitle_only(

    source_video: Path,

    vietnamese_srt: Path,

    region_path: Path,

    ass_path: Path,

    output_path: Path,

    region: dict,

    preview_seconds=None,

    font_size=None,

    aspect_ratio=None,

    logo_size=None,

    logo_x=None,

    logo_y=None,

    logo_mode="default",

    logo_text=None,

    logo_path=None,

    blur_intervals=None,

    music_path=None,

    music_volume=0.12,
    auto_brand_blur=False,

    force=False,

):

    if file_ok(output_path) and not force:

        print("\n[SKIP] Final subtitle video da ton tai:")

        print(rel(output_path))

        return



    print("\n==============================")

    print("7. FINAL RENDER - VIETSUB GPU")

    print("==============================")



    from services import final_renderer as renderer



    renderer.VIDEO_PATH = rel(source_video)

    renderer.SRT_PATH = rel(vietnamese_srt)

    renderer.REGION_PATH = rel(region_path)

    renderer.ASS_PATH = rel(ass_path)

    renderer.OUTPUT_PATH = rel(output_path)

    renderer.PREVIEW_SECONDS = preview_seconds

    renderer.FONT_SIZE_OVERRIDE = font_size
    renderer.OUTPUT_ASPECT_RATIO = aspect_ratio
    renderer.LOGO_SIZE_OVERRIDE = logo_size
    renderer.LOGO_X_OVERRIDE = logo_x
    renderer.LOGO_Y_OVERRIDE = logo_y
    renderer.LOGO_MODE = logo_mode or "default"
    renderer.LOGO_TEXT = logo_text
    renderer.LOGO_PATH_OVERRIDE = logo_path
    renderer.BLUR_INTERVALS = blur_intervals or []
    renderer.MUSIC_PATH = music_path
    renderer.MUSIC_VOLUME = music_volume
    renderer.AUTO_BRAND_BLUR_ENABLED = bool(auto_brand_blur)

    renderer.RENDER_MODE = "subtitle"



    renderer.create_ass(region)

    renderer.render_final(region)



    if not file_ok(output_path):

        raise RuntimeError(

            "Final renderer khong tao duoc Vietsub video."

        )







# =========================================================



# PIPELINE



# =========================================================











def pipeline(



    url: str,



    *,



    channel=None,



    mode="voiceover",



    source_file=None,



    force=False,



    preview_seconds=None,



    original_volume=0.15,



    voice_volume=1.0,

    config=None,



):



    require_command("ffmpeg")

    config = config if isinstance(config, dict) else {}
    # Cấu hình từ hộp xử lý có thể thay đổi giữa các lần chạy. Khi có config,
    # luôn render lại thành phẩm nhưng vẫn tái sử dụng video/subtitle trung gian.
    render_force = bool(force or config)
    preview_seconds = config.get("preview_seconds", preview_seconds)
    original_volume = float(config.get("original_volume", original_volume))
    voice_volume = float(config.get("voice_volume", voice_volume))



    require_command("ffprobe")







    mode = str(mode).strip().lower()







    if mode not in {"subtitle", "voiceover"}:



        raise ValueError("mode chi nhan 'subtitle' hoac 'voiceover'.")







    if preview_seconds is not None and preview_seconds <= 0:



        raise ValueError("--preview phai lon hon 0.")







    job_id = get_job_id(url)



    channel_key = normalize_channel_key(channel)







    if channel_key:



        jobs_root = get_channels_dir() / channel_key / "jobs"



    else:



        jobs_root = get_jobs_dir()







    job_dir = jobs_root / job_id



    tts_dir = job_dir / "tts"







    job_dir.mkdir(parents=True, exist_ok=True)



    tts_dir.mkdir(parents=True, exist_ok=True)

    if config.get("logo_data"):
        try:
            _header, encoded = str(config["logo_data"]).split(",", 1)
            logo_bytes = base64.b64decode(encoded)
            suffix = Path(str(config.get("logo_filename") or "logo.png")).suffix or ".png"
            uploaded_logo = job_dir / f"custom_logo{suffix.lower()}"
            uploaded_logo.write_bytes(logo_bytes)
            config = {
                **config,
                "logo_mode": "custom",
                "logo_path": str(uploaded_logo),
            }
        except Exception as error:
            raise RuntimeError(f"Logo tuy chon khong hop le: {error}") from error

    def valid_music_file(path: Path) -> bool:
            if not file_ok(path):
                return False
            try:
                probe = subprocess.run(
                    [
                        "ffprobe", "-v", "error",
                        "-select_streams", "a:0",
                        "-show_entries", "stream=codec_type",
                        "-of", "csv=p=0",
                        str(path),
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    text=True,
                    check=False,
                )
                return probe.returncode == 0 and "audio" in (probe.stdout or "")
            except OSError:
                # If ffprobe is unavailable, let FFmpeg perform the final validation.
                return file_ok(path)

    music_path = None
    music_data = str(config.get("music_data") or "").strip()
    if music_data:
        try:
            _header, encoded = music_data.split(",", 1)
            music_bytes = base64.b64decode(encoded)
            suffix = Path(str(config.get("music_filename") or "background_music.m4a")).suffix or ".m4a"
            uploaded_music = job_dir / f"background_upload{suffix.lower()}"
            uploaded_music.write_bytes(music_bytes)
            if valid_music_file(uploaded_music):
                music_path = uploaded_music
            else:
                raise RuntimeError("Tệp audio/video trên máy không hợp lệ hoặc không có stream âm thanh.")
        except Exception as error:
            raise RuntimeError(f"Audio/video tải lên không hợp lệ: {error}") from error

    music_url = str(config.get("music_url") or "").strip()
    if music_url and music_path is None:
        music_path = next(
            (
                candidate
                for candidate in sorted(job_dir.glob("background_music.*"))
                if valid_music_file(candidate)
            ),
            job_dir / "background_music.m4a",
        )
        if not valid_music_file(music_path):
            for stale in job_dir.glob("background_music.*"):
                if stale.exists() and not valid_music_file(stale):
                    try:
                        stale.unlink()
                    except OSError:
                        pass
            music_template = str(job_dir / "background_music.%(ext)s")
            music_command = [
                sys.executable, "-m", "yt_dlp",
                "--no-playlist", "--no-warnings",
                "-x", "--audio-format", "m4a",
                "-o", music_template, music_url,
            ]
            subprocess.run(music_command, cwd=str(PROJECT_ROOT), check=True)
            candidates = [
                candidate
                for candidate in sorted(job_dir.glob("background_music.*"))
                if valid_music_file(candidate)
            ]
            if candidates:
                music_path = candidates[0]
    config = {
        **config,
        "music_path": str(music_path) if music_path and valid_music_file(music_path) else None,
    }







    audio_path = job_dir / "source_16k.wav"



    chinese_srt = job_dir / "chinese.srt"



    vietnamese_srt = job_dir / "vietnamese.srt"



    translation_checkpoint = job_dir / "translation_checkpoint.json"



    translation_debug = job_dir / "translation_debug.json"



    voice_path = job_dir / "voice.wav"



    tts_manifest = job_dir / "tts_manifest.json"



    region_path = job_dir / "subtitle_region.json"



    region_preview = job_dir / "subtitle_region_preview.jpg"







    if mode == "subtitle":



        ass_path = job_dir / "final_sub.ass"







        if preview_seconds:



            output_path = job_dir / f"preview_sub_{int(preview_seconds)}s.mp4"



        else:



            output_path = job_dir / "final_sub.mp4"



    else:



        ass_path = job_dir / "final_voice.ass"







        if preview_seconds:



            output_path = job_dir / f"preview_voice_{int(preview_seconds)}s.mp4"



        else:



            output_path = job_dir / "final_voice.mp4"







    print("\n========================================")



    print("REUP AI PIPELINE")



    print("========================================")



    print(f"Job     : {job_id}")



    print(f"URL     : {url}")



    print(f"Channel : {channel_key or 'default'}")



    print(f"Mode    : {mode}")



    print(f"Dir     : {rel(job_dir)}")







    base_job = {



        "job_id": job_id,



        "url": url,



        "channel": channel_key,



        "mode": mode,



        "status": "running",



    }







    save_job_info(job_dir, base_job)



    write_progress(



        job_dir,



        stage="starting",



        percent=1,



        status="running",



        message="Bat dau pipeline.",



        mode=mode,



    )







    try:



        # 1. SOURCE



        write_progress(



            job_dir,



            stage="source",



            percent=5,



            status="running",



            message="Dang chuan bi video nguon.",



            mode=mode,



        )







        source_video = get_source_video(



            url,



            job_dir,



            source_file,



            force=force,



        )







        save_job_info(



            job_dir,



            {



                **base_job,



                "source_video": rel(source_video),



            },



        )







        # 2. AUDIO



        write_progress(



            job_dir,



            stage="extract_audio",



            percent=15,



            status="running",



            message="Dang tach audio 16k.",



            mode=mode,



        )







        extract_audio(source_video, audio_path, force=force)







        # 3. WHISPER



        write_progress(



            job_dir,



            stage="whisper",



            percent=30,



            status="running",



            message="Dang nhan dien loi thoai bang Whisper.",



            mode=mode,



        )







        no_subtitle = False
        try:
            transcribe_audio(audio_path, chinese_srt, force=force)
        except RuntimeError as error:
            if "subtitle" not in str(error).lower() and "frame" not in str(error).lower():
                raise
            no_subtitle = True
            print(f"[SKIP] Khong tim thay subtitle: {error}")
            chinese_srt.write_text("", encoding="utf-8")
            vietnamese_srt.write_text("", encoding="utf-8")







        # 4. GEMINI



        write_progress(



            job_dir,



            stage="translate",



            percent=50,



            status="running",



            message="Dang dich Trung -> Viet bang Gemini AI.",



            mode=mode,



        )







        translate_srt(



            job_id,



            chinese_srt,



            vietnamese_srt,



            translation_checkpoint,



            translation_debug,



            force=force,



        )







        # 5. TTS - chi voiceover moi chay



        if mode == "voiceover" and not no_subtitle:



            write_progress(



                job_dir,



                stage="tts",



                percent=68,



                status="running",



                message="Dang tao giong Viet bang Edge-TTS.",



                mode=mode,



            )







            create_voice(



                source_video,



                vietnamese_srt,



                voice_path,



                tts_dir,



                tts_manifest,



                force=force,



                voice_name=config.get("voice"),



                speed=config.get("tts_speed"),



            )



        else:



            print("\n[SKIP] TTS - khong co subtitle de tao giong Viet." if mode == "voiceover" else "\n[SKIP] TTS - mode subtitle chi tao Vietsub.")







        # 6. SUB DETECTOR



        write_progress(



            job_dir,



            stage="detect_subtitle",



            percent=78 if mode == "voiceover" else 70,



            status="running",



            message="Dang tim vi tri subtitle goc.",



            mode=mode,



        )







        region = resolve_subtitle_region(
            source_video, region_path, region_preview,
            config=config, no_subtitle=no_subtitle, force=force,
        )

        # Vùng mờ subtitle và vùng mờ tùy chỉnh là hai lớp độc lập. Trước đây
        # vùng tùy chỉnh bị ghi đè bởi blur_region của subtitle nên chọn trên
        # giao diện nhưng render ra không đúng. Chuyển vùng tùy chỉnh thành
        # interval toàn thời lượng nếu người dùng chưa nhập khoảng riêng.
        effective_blur_intervals = [
            dict(item)
            for item in (config.get("blur_intervals") or [])
            if isinstance(item, dict)
        ]
        custom_only = config.get("custom_blur_region")
        if isinstance(custom_only, dict) and not effective_blur_intervals:
            effective_blur_intervals.append({
                **custom_only,
                "start": 0,
                "end": 86400,
            })
        # 7. RENDER



        write_progress(



            job_dir,



            stage="render",



            percent=90,



            status="running",



            message=(



                "Dang render Vietsub + long tieng."



                if mode == "voiceover"



                else "Dang render Vietsub AI."



            ),



            mode=mode,



        )







        if mode == "voiceover" and not no_subtitle:



            render_voiceover(



                source_video,



                voice_path,



                vietnamese_srt,



                region_path,



                ass_path,



                output_path,



                region,



                preview_seconds=preview_seconds,



                original_volume=original_volume,



                voice_volume=voice_volume,

                font_size=config.get("subtitle_font_size"),

                aspect_ratio=config.get("aspect_ratio"),

                logo_size=config.get("logo_size"),

                logo_x=config.get("logo_x"),

                logo_y=config.get("logo_y"),

                logo_mode=config.get("logo_mode", "default"),

                logo_text=config.get("logo_text"),

                logo_path=config.get("logo_path"),

                blur_intervals=effective_blur_intervals,

                music_path=config.get("music_path"),

                music_volume=float(config.get("music_volume", 0.12)),
                auto_brand_blur=bool(config.get("auto_brand_blur", False)),



                force=render_force,



            )



        else:



            render_subtitle_only(



                source_video,



                vietnamese_srt,



                region_path,



                ass_path,



                output_path,



                region,



                preview_seconds=preview_seconds,

                font_size=config.get("subtitle_font_size"),

                aspect_ratio=config.get("aspect_ratio"),

                logo_size=config.get("logo_size"),

                logo_x=config.get("logo_x"),

                logo_y=config.get("logo_y"),

                logo_mode=config.get("logo_mode", "default"),

                logo_text=config.get("logo_text"),

                logo_path=config.get("logo_path"),

                blur_intervals=effective_blur_intervals,

                music_path=config.get("music_path"),

                music_volume=float(config.get("music_volume", 0.12)),
                auto_brand_blur=bool(config.get("auto_brand_blur", False)),



                force=render_force,



            )







        completed_job = {



            "job_id": job_id,



            "url": url,



            "channel": channel_key,



            "mode": mode,



            "source_video": rel(source_video),



            "audio": rel(audio_path),



            "chinese_srt": rel(chinese_srt),



            "vietnamese_srt": rel(vietnamese_srt),



            "subtitle_region": rel(region_path),



            "subtitle_preview": rel(region_preview),



            "ass": rel(ass_path),



            "final_video": rel(output_path),



            "status": "completed",
            "warnings": region.get("warnings", []),



        }







        if mode == "voiceover" and not no_subtitle:



            completed_job["voice"] = rel(voice_path)



            completed_job["tts_manifest"] = rel(tts_manifest)







        save_job_info(job_dir, completed_job)







        write_progress(



            job_dir,



            stage="completed",



            percent=100,



            status="completed",



            message="Xu ly hoan tat." + (" " + " ".join(region["warnings"]) if region.get("warnings") else ""),



            mode=mode,



        )







        print("\n========================================")



        print("PIPELINE HOAN THANH")



        print("========================================")



        print(f"Mode  : {mode}")



        print(f"Final : {rel(output_path)}")



        print(f"Job   : {rel(job_dir)}")







        return output_path







    except Exception as error:



        write_progress(



            job_dir,



            stage="failed",



            percent=0,



            status="failed",



            message=f"{type(error).__name__}: {error}",



            mode=mode,



        )







        failed_job = {



            **base_job,



            "status": "failed",



            "error_type": type(error).__name__,



            "error": str(error),



        }







        save_job_info(job_dir, failed_job)



        raise











# =========================================================



# CLI



# =========================================================











def parse_args():



    parser = argparse.ArgumentParser(



        description="URL/video da tai -> Vietsub AI / Voiceover AI pipeline"



    )







    parser.add_argument(



        "url",



        help="Video URL Bilibili hoac Douyin",



    )







    parser.add_argument(



        "--channel",



        type=str,



        default=None,



        help=(



            "Channel key, vi du: 2d_animation, 3d_animation, comedy. "



            "Neu bo qua thi dung app/jobs/."



        ),



    )







    parser.add_argument(



        "--mode",



        choices=["subtitle", "voiceover"],



        default="voiceover",



        help=(



            "subtitle = Vietsub AI + giu audio goc; "



            "voiceover = Vietsub AI + Edge-TTS + mix audio."



        ),



    )







    parser.add_argument(



        "--source-file",



        type=str,



        default=None,



        help=(



            "Dung video da tai san, vi du "



            "app/downloads/demo/BVxxxx/source.mp4. "



            "Neu co thi bo qua yt-dlp."



        ),



    )







    parser.add_argument(



        "--force",



        action="store_true",



        help="Chay lai cac stage da co output.",



    )







    parser.add_argument(



        "--preview",



        type=float,



        default=None,



        metavar="SECONDS",



        help="Chi render preview N giay.",



    )







    parser.add_argument(



        "--original-volume",



        type=float,



        default=0.15,



        help="Am luong audio goc o mode voiceover. Mac dinh 0.15",



    )







    parser.add_argument(



        "--voice-volume",



        type=float,



        default=1.0,



        help="Am luong voice Viet o mode voiceover. Mac dinh 1.0",



    )







    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="JSON cau hinh tuy chinh cho job web.",
    )

    return parser.parse_args()











# =========================================================



# RUN



# =========================================================











def main():



    args = parse_args()

    config = {}
    if args.config:
        with open(args.config, "r", encoding="utf-8") as config_file:
            config = json.load(config_file)







    try:



        pipeline(



            args.url,



            channel=args.channel,



            mode=args.mode,



            source_file=args.source_file,



            force=args.force,



            preview_seconds=args.preview,



            original_volume=args.original_volume,



            voice_volume=args.voice_volume,

            config=config,



        )







    except KeyboardInterrupt:



        print("\nDa dung pipeline.")



        raise SystemExit(130)







    except Exception as error:



        print("\n========================================")



        print("PIPELINE LOI")



        print("========================================")



        print(type(error).__name__ + ": " + str(error))



        raise


if __name__ == "__main__":
    main()
