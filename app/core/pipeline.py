import argparse

import base64



import hashlib



import json



import os



import re



import shutil



import subprocess



import sys

from urllib.parse import urlparse



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







    if getattr(sys, "frozen", False):
        # Keep relative bundled resources (for example app/assets) anchored at
        # PyInstaller's immutable application directory. Runtime jobs and
        # outputs still use runtime_paths under %LOCALAPPDATA%\ReupAI.
        PROJECT_ROOT = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        APP_DIR = PROJECT_ROOT
        os.chdir(PROJECT_ROOT)
        if str(APP_DIR) not in sys.path:
            sys.path.insert(0, str(APP_DIR))
        return

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


def stable_fingerprint(payload) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def normalize_music_url(value) -> str:
    """Validate a remote background-music URL before giving it to yt-dlp."""
    url = str(value or "").strip()
    if not url:
        return ""
    if len(url) > 4096:
        raise ValueError("Link nhạc quá dài.")
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Link nhạc phải bắt đầu bằng http:// hoặc https://.")
    return url


def normalize_video_url(value) -> str:
    from services.video_urls import normalize_source_url
    return normalize_source_url(value, resolve_short=True, allow_generic=True)


def normalize_music_volume(value, default: float = 0.25) -> float:
    """Keep user-selected music gain inside the supported 0–200% range."""
    try:
        return max(0.0, min(2.0, float(value)))
    except (TypeError, ValueError):
        return default


def is_youtube_music_url(value: str) -> bool:
    """Return whether a YouTube URL benefits from browser-cookie retry."""
    hostname = (urlparse(value).hostname or "").lower().rstrip(".")
    return hostname == "youtu.be" or hostname == "youtube.com" or hostname.endswith(
        ".youtube.com"
    )


def is_tiktok_music_url(value: str) -> bool:
    """Recognize normal, mobile and short TikTok share links."""
    hostname = (urlparse(value).hostname or "").lower().rstrip(".")
    return hostname == "tiktok.com" or hostname.endswith(".tiktok.com")


def supports_browser_cookie_music_retry(value: str) -> bool:
    """Sites whose public media downloads commonly need browser cookies."""
    return is_youtube_music_url(value) or is_tiktok_music_url(value)


def music_download_command(
    music_template: str,
    music_url: str,
    *,
    use_browser_cookies: bool = False,
) -> list[str]:
    """Build the isolated yt-dlp command used for a remote music track."""
    from services.engine_runtime import python_module_command

    command = python_module_command(
        "yt_dlp",
        "--no-playlist",
        "--no-warnings",
        "--retries",
        "5",
        "--fragment-retries",
        "5",
        "--socket-timeout",
        "30",
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best",
        "-x",
        "--audio-format",
        "m4a",
        "--audio-quality",
        "5",
    )
    if use_browser_cookies:
        command.extend(
            [
                "--cookies-from-browser",
                os.getenv("REUP_COOKIE_BROWSER", "chrome"),
            ]
        )
    command.extend(["-o", music_template, music_url])
    return command


def resolve_music_url_track(job_dir: Path, music_url: str, is_valid_file) -> Path:
    """Return a validated cached/downloaded audio track for one remote URL."""
    url = normalize_music_url(music_url)
    music_key = stable_fingerprint({"url": url})[:16]
    candidates = [
        candidate
        for candidate in sorted(job_dir.glob(f"background_music_{music_key}.*"))
        if is_valid_file(candidate)
    ]
    if candidates:
        return candidates[0]

    for stale in job_dir.glob(f"background_music_{music_key}.*"):
        try:
            stale.unlink(missing_ok=True)
        except OSError:
            pass

    music_template = str(job_dir / f"background_music_{music_key}.%(ext)s")

    def download(*, use_browser_cookies: bool = False):
        return subprocess.run(
            music_download_command(
                music_template,
                url,
                use_browser_cookies=use_browser_cookies,
            ),
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
            timeout=600,
            check=False,
        )

    try:
        result = download()
        # YouTube and TikTok can reject anonymous extractor traffic even for
        # public posts. The first attempt stays cookie-free; if it fails, retry
        # with the same browser profile the normal video downloader uses.
        if result.returncode != 0 and supports_browser_cookie_music_retry(url):
            result = download(use_browser_cookies=True)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Tải nhạc quá 10 phút. Hãy thử link khác hoặc tải tệp nhạc từ máy.") from error
    except OSError as error:
        raise RuntimeError("Không thể khởi chạy trình tải nhạc của Local Engine.") from error

    if result.returncode != 0:
        detail = " ".join((result.stderr or result.stdout or "").splitlines()[-2:]).strip()
        suffix = f" ({detail[:280]})" if detail else ""
        raise RuntimeError(
            "Không tải được nhạc từ liên kết. Hãy kiểm tra link có công khai, "
            "hoặc dùng tệp audio/video trên máy." + suffix
        )

    candidates = [
        candidate
        for candidate in sorted(job_dir.glob(f"background_music_{music_key}.*"))
        if is_valid_file(candidate)
    ]
    if not candidates:
        raise RuntimeError(
            "Link đã tải xong nhưng không tìm thấy stream âm thanh hợp lệ. "
            "Hãy dùng link audio/video khác."
        )
    return candidates[0]


def file_fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def cache_fingerprint_matches(path: Path, expected: str) -> bool:
    try:
        return path.read_text(encoding="utf-8").strip() == expected
    except OSError:
        return False


def write_cache_fingerprint(path: Path, value: str) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(value, encoding="utf-8")
    temporary.replace(path)











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











def detect_platform(url: str) -> str:
    from services.video_urls import source_platform
    return source_platform(url)


def get_job_id(url: str) -> str:
    from services.video_urls import video_identity
    identifier = video_identity(url)
    if identifier:
        return identifier
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    return f"job_{digest}"


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











def _record_stage_checkpoint(job_dir: Path, stage: str, details: dict | None = None) -> None:
    """Persist an atomic per-stage checkpoint ledger for multi-hour resume."""
    path = job_dir / "checkpoints.json"
    existing = {}
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                existing = loaded
        except (OSError, ValueError):
            existing = {}
    stages = existing.get("stages")
    if not isinstance(stages, dict):
        stages = {}
    stages[stage] = {
        "completed_at": datetime.now().isoformat(timespec="seconds"),
        **(details or {}),
    }
    payload = {
        "schema": 1,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "last_stage": stage,
        "stages": stages,
    }
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)


def build_ytdlp_command(
    url: str,
    output_template: str,
    *,
    use_browser_cookies=False,
    reliable=False,
):

    from services.download_config import ytdlp_performance_args
    from services.engine_runtime import python_module_command

    command = python_module_command(
        "yt_dlp",
        "--continue",
        "--retries",
        "30",
        "--fragment-retries",
        "30",
        "--socket-timeout",
        "45",
    )

    # Bilibili can advertise premium 1080p formats to anonymous users, then
    # reject the actual transfer.  This pipeline only needs a stable source
    # for subtitle/voice processing, so consistently request an accessible
    # 720p-or-lower stream and keep resilient retry sleep/access flags.
    command.extend(["--concurrent-fragments", "1"])
    perf_args = ytdlp_performance_args()
    skip_next = False
    for token in perf_args:
        if skip_next:
            skip_next = False
            continue
        if token == "--concurrent-fragments":
            skip_next = True
            continue
        command.append(token)

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
        "bv*[height<=720]+ba/b",
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
    attempted_commands = set()

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

        command_key = tuple(str(part) for part in command)
        if command_key in attempted_commands:
            continue
        attempted_commands.add(command_key)

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
        if platform == "bilibili":
            print("[bilibili] yt-dlp bi chan, thu Chrome/Edge fallback...")
            from services.download_space import (
                DownloadStorageError,
                is_disk_full_error,
            )
            output_path = job_dir / "source.mp4"
            try:
                from services.bilibili_browser import (
                    download_video as browser_download_video,
                )
                browser_download_video(url, output_path)
                print("[bilibili] Chrome/Edge fallback thanh cong.")
                return output_path
            except DownloadStorageError:
                output_path.with_name(
                    f"{output_path.stem}.pending{output_path.suffix}"
                ).unlink(missing_ok=True)
                raise
            except Exception as browser_error:
                output_path.with_name(
                    f"{output_path.stem}.pending{output_path.suffix}"
                ).unlink(missing_ok=True)
                if is_disk_full_error(browser_error):
                    raise DownloadStorageError(
                        "Ổ đĩa đã đầy khi tải Bilibili. Hãy giải phóng dung lượng "
                        "trên ổ lưu job và ổ tạm của Windows rồi thử lại."
                    ) from browser_error
                print("[bilibili] Chrome/Edge fallback loi:", browser_error)
                raise RuntimeError(
                    "Không thể tải video Bilibili bằng trình duyệt: "
                    f"{browser_error}"
                ) from browser_error
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











def check_processing_storage(
    source_video: Path,
    job_dir: Path,
    audio_path: Path,
    mode: str,
    *,
    voice_path: Path | None = None,
    force_audio: bool = False,
    force_voice: bool = False,
    include_voice: bool = True,
    include_audio: bool = True,
    include_render: bool = True,
    preview_seconds: float | None = None,
) -> None:
    """Estimate extra workspace needed before a long video consumes hours of work.

    Exact render size depends on the source codec and selected output format,
    so this is a conservative preflight rather than a hard disk quota.
    """
    try:
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(source_video),
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=20,
        )
        duration_seconds = float((probe.stdout or "").strip())
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return  # The server's baseline free-space guard still applies.
    if not 0 < duration_seconds < 1_000_000:
        return

    source_size = source_video.stat().st_size
    # 16 kHz mono source WAV: 32,000 bytes/s.  Voice timeline retains the
    # existing 44.1 kHz stereo PCM format: 176,400 bytes/s.
    source_audio_bytes = (
        0 if not include_audio or (file_ok(audio_path) and not force_audio)
        else int(duration_seconds * 32_000)
    )
    voice_needed = include_render and include_voice and mode == "voiceover" and (
        force_voice or voice_path is None or not file_ok(voice_path)
    )
    voice_bytes = int(duration_seconds * 176_400) if voice_needed else 0
    # Raw and fitted TTS clips coexist until the job completes. Dense speech
    # can occupy about another timeline's worth of temporary PCM data.
    clip_bytes = int(duration_seconds * 200_000) if voice_needed else 0
    if voice_bytes > 4 * 1024**3 - 128:
        raise RuntimeError(
            "Video quá dài cho định dạng WAV của track lồng tiếng (giới hạn khoảng 6 giờ). "
            "Hãy chia video thành các phần ngắn hơn trước khi xử lý Voice."
        )
    render_duration = (
        min(duration_seconds, preview_seconds)
        if preview_seconds is not None and preview_seconds > 0
        else duration_seconds
    )
    render_bytes = max(
        int(source_size * render_duration / duration_seconds * 2),
        int(render_duration * 1_500_000),
    ) if include_render else 0
    reserve_bytes = 512 * 1024**2
    required = source_audio_bytes + voice_bytes + clip_bytes + render_bytes + reserve_bytes
    free = shutil.disk_usage(job_dir).free
    if free < required:
        raise RuntimeError(
            "Ổ lưu job không đủ dung lượng trống cho video dài. "
            f"Ước tính cần thêm {required / 1024**3:.1f} GB, "
            f"hiện có {free / 1024**3:.1f} GB. "
            "Hãy giải phóng dung lượng hoặc chọn ổ dữ liệu khác rồi chạy lại."
        )


def extract_audio(source_video: Path, audio_path: Path, force=False):



    if file_ok(audio_path) and not force:



        print("\n[SKIP] Audio da ton tai:")



        print(rel(audio_path))



        return







    print("\n==============================")



    print("2. EXTRACT AUDIO")



    print("==============================")







    tmp_audio_path = audio_path.with_name(f"{audio_path.stem}.tmp{audio_path.suffix}")
    remove_file(tmp_audio_path)
    try:
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
                rel(tmp_audio_path),
            ]
        )
        if not file_ok(tmp_audio_path):
            raise RuntimeError("Khong tao duoc source_16k.wav.")
        os.replace(tmp_audio_path, audio_path)
    except Exception:
        remove_file(tmp_audio_path)
        raise

    if not file_ok(audio_path):

        raise RuntimeError("Khong tao duoc source_16k.wav.")











# =========================================================



# STEP 3 - WHISPER



# =========================================================











class NoSpeechDetected(RuntimeError):
    """Whisper completed successfully but found no spoken words."""


def transcribe_audio(audio_path: Path, chinese_srt: Path, force=False, on_progress=None, source_language="auto"):



    if file_ok(chinese_srt) and not force:



        print("\n[SKIP] Phu de da ton tai:")



        print(rel(chinese_srt))



        return







    print("\n==============================")



    print("3. WHISPER -> CHINESE SRT")



    print("==============================")







    from services import transcriber







    partial_checkpoint = chinese_srt.with_name(chinese_srt.stem + ".partial.json")
    # The partial checkpoint carries its own audio/model/language signature, so
    # it is safe to resume even when the job-level settings signature has not
    # been written yet (the first run was interrupted mid-Whisper).
    segments = transcriber.transcribe(
        rel(audio_path), on_progress=on_progress,
        language=None if source_language == "auto" else source_language,
        checkpoint_path=rel(partial_checkpoint),
    )
    # The finished SRT is the final checkpoint; the partial one is now stale.
    remove_file(partial_checkpoint)







    if not segments:



        raise NoSpeechDetected("Whisper khong tim thay loi thoai de tao phu de.")







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

    source_language="auto",



    translation_model="gemini-3.1-flash-lite",
    target_language="vi",

):



    target_language = str(target_language or "vi").strip().lower() or "vi"
    model_path = vietnamese_srt.with_suffix(".model.txt")
    target_lang_path = vietnamese_srt.with_suffix(".target_lang.txt")
    previous_model = model_path.read_text(encoding="utf-8").strip() if model_path.is_file() else ""
    previous_target_lang = target_lang_path.read_text(encoding="utf-8").strip() if target_lang_path.is_file() else "vi"
    if not previous_model and checkpoint_path.is_file():
        # An earlier run stopped mid-translation before the model marker existed;
        # its checkpoint is still valid, so resume instead of translating again.
        previous_model = translation_model
    force = force or previous_model != translation_model or previous_target_lang != target_language
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
        print("\n[SKIP] Transcript rong, bo qua dich.")
        return







    print("\n==============================")



    print("4. GEMINI AI: LOI THOAI -> TIENG VIET")



    print("==============================")







    if source_language != "auto" and source_language == target_language:
        vietnamese_srt.write_bytes(chinese_srt.read_bytes())
        return
    from services import translator
    # Tie the checkpoint to the chosen model and target language immediately, so a stopped run can
    # resume with the same settings rather than being treated as a setting change.
    try:
        model_path.write_text(translation_model, encoding="utf-8")
        target_lang_path.write_text(target_language, encoding="utf-8")
    except OSError:
        pass
    translator.SOURCE_LANGUAGE = source_language
    translator.TARGET_LANGUAGE = target_language







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



        raise RuntimeError("Transcript phụ đề rỗng.")







    if hasattr(translator, "get_file_hash"):



        source_hash = translator.get_file_hash(rel(chinese_srt))
        if target_language != "vi":
            source_hash = f"{source_hash}_{target_language}"



        translated = translator.translate_all(subtitles, source_hash, translation_model=translation_model, target_language=target_language)



    else:



        translated = translator.translate_all(subtitles, translation_model=translation_model, target_language=target_language)







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











    model_path.write_text(translation_model, encoding="utf-8")

def create_voice(



    source_video: Path,



    vietnamese_srt: Path,



    voice_path: Path,



    tts_dir: Path,



    manifest_path: Path,



    force=False,

    voice_name=None,

    speed=None,

    on_progress=None,



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







    manifest = tts.create_tts_clips(
        subtitles, reuse_fitted=not force, on_progress=on_progress,
    )



    video_duration = tts.get_video_duration_ms(rel(source_video))







    if video_duration is None:



        video_duration = subtitles[-1]["end_ms"] + 1000







    actual_voice = tts.build_voice_timeline(
        manifest, video_duration, on_progress=on_progress,
    )
    resolved_voice_path = Path(actual_voice) if actual_voice else voice_path

    if not file_ok(resolved_voice_path):
        raise RuntimeError(f"Khong tao duoc {resolved_voice_path.name}.")

    return resolved_voice_path











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
    if config.get("source_subtitle_mode") == "none" or config.get("disable_main_blur"):
        region = default_region_without_subtitle(source_video)
        region["detected"] = {
            "method": (
                "source_subtitle_disabled"
                if config.get("source_subtitle_mode") == "none"
                else "main_blur_disabled"
            ),
            "confidence": 1.0,
        }
    elif has_selection or preset in {"top", "bottom", "center"}:
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
        if auto_path.is_file() and not force:
            try:
                cached_auto = json.loads(auto_path.read_text(encoding="utf-8"))
                force = (cached_auto.get("detected") or {}).get("algorithm_version") != 3
            except (OSError, ValueError, AttributeError):
                force = True
        try:
            region = detect_subtitle_region(source_video, auto_path, preview_image, force=force)
            region.setdefault("detected", {})["algorithm_version"] = 3
            if force:
                save_json(auto_path, region)
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
    # A top OCR hit is often a fixed watermark. There is no evidence that the
    # original subtitle is at the bottom, so never invent a large blur there.
    # Keep a safe position for the translated subtitle and let the user mark
    # the source-text area manually if the detector could not locate it.
    box_width = max(2, int(width * 0.86))
    box_x = max(0, (width - box_width) // 2)
    box_height = max(2, int(height * 0.10))
    box_y = min(height - box_height, int(height * 0.80))
    detected = dict(region.get("detected") or {})
    detected.update({
        "auto_guard": "top_text_ignored_no_blur",
        "original_blur": blur,
    })
    warnings = list(region.get("warnings") or [])
    warnings.append(
        "OCR chỉ nhận được chữ ở mép trên, có thể là logo hoặc watermark. "
        "ReupAI không tự làm mờ vùng khác để tránh che sai video; "
        "hãy chọn vùng mờ sub thủ công nếu phụ đề gốc còn hiện."
    )
    return {
        **region,
        "blur_enabled": False,
        "blur": {"x": box_x, "y": box_y, "width": box_width, "height": box_height},
        "subtitle": {
            "x": width // 2,
            "y": box_y + box_height // 2,
            "position_percent": round((box_y + box_height / 2) * 100 / height, 2),
        },
        "detected": detected,
        "warnings": warnings,
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
    subtitle_style="minimal",

    aspect_ratio=None,

    logo_size=None,

    logo_x=None,

    logo_y=None,

    logo_mode="none",

    logo_text=None,

    logo_path=None,

    blur_intervals=None,

    music_path=None,

    music_volume=0.25,
    auto_brand_blur=False,
    on_render_progress=None,



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
    renderer.SUBTITLE_STYLE = subtitle_style
    renderer.OUTPUT_ASPECT_RATIO = aspect_ratio
    renderer.LOGO_SIZE_OVERRIDE = logo_size
    renderer.LOGO_X_OVERRIDE = logo_x
    renderer.LOGO_Y_OVERRIDE = logo_y
    renderer.LOGO_MODE = logo_mode or "none"
    renderer.LOGO_TEXT = logo_text
    renderer.LOGO_PATH_OVERRIDE = logo_path
    renderer.BLUR_INTERVALS = blur_intervals or []
    renderer.MUSIC_PATH = music_path
    renderer.MUSIC_VOLUME = normalize_music_volume(music_volume)
    renderer.AUTO_BRAND_BLUR_ENABLED = bool(auto_brand_blur)

    renderer.PREVIEW_SECONDS = preview_seconds

    renderer.RENDER_MODE = "voiceover"
    renderer.RENDER_PROGRESS_CALLBACK = on_render_progress
    try:
        renderer.create_ass(region)
        renderer.render_final(region)
    finally:
        renderer.RENDER_PROGRESS_CALLBACK = None



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
    subtitle_style="minimal",

    aspect_ratio=None,

    logo_size=None,

    logo_x=None,

    logo_y=None,

    logo_mode="none",

    logo_text=None,

    logo_path=None,

    blur_intervals=None,

    music_path=None,

    music_volume=0.25,
    auto_brand_blur=False,
    on_render_progress=None,

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
    renderer.SUBTITLE_STYLE = subtitle_style
    renderer.OUTPUT_ASPECT_RATIO = aspect_ratio
    renderer.LOGO_SIZE_OVERRIDE = logo_size
    renderer.LOGO_X_OVERRIDE = logo_x
    renderer.LOGO_Y_OVERRIDE = logo_y
    renderer.LOGO_MODE = logo_mode or "none"
    renderer.LOGO_TEXT = logo_text
    renderer.LOGO_PATH_OVERRIDE = logo_path
    renderer.BLUR_INTERVALS = blur_intervals or []
    renderer.MUSIC_PATH = music_path
    renderer.MUSIC_VOLUME = normalize_music_volume(music_volume)
    renderer.AUTO_BRAND_BLUR_ENABLED = bool(auto_brand_blur)

    renderer.RENDER_MODE = "subtitle"
    renderer.RENDER_PROGRESS_CALLBACK = on_render_progress
    try:
        renderer.create_ass(region)
        renderer.render_final(region)
    finally:
        renderer.RENDER_PROGRESS_CALLBACK = None



    if not file_ok(output_path):

        raise RuntimeError(

            "Final renderer khong tao duoc Vietsub video."

        )








def rerender_existing_output(
    *,
    url: str,
    job_dir: Path,
    mode: str,
    source_file: str | None,
    output_path: Path,
    ass_path: Path,
    region_path: Path,
    region_preview: Path,
    vietnamese_srt: Path,
    voice_path: Path,
    config: dict,
    original_volume: float,
    voice_volume: float,
):
    """Render an edited result from existing local pipeline artifacts only."""
    from services.output_subtitles import staged_revision

    with staged_revision(vietnamese_srt, config.get("revised_subtitles")) as vietnamese_srt:
        if not source_file:
            raise FileNotFoundError("Khong tim thay video nguon local de xuat lai.")
        source_video = get_source_video(url, job_dir, source_file, force=False)
        if not vietnamese_srt.is_file():
            raise FileNotFoundError("Khong tim thay phu de Viet da tao truoc do.")
        no_speech = not vietnamese_srt.read_text(encoding="utf-8-sig").strip()
        if mode == "voiceover" and not no_speech and not file_ok(voice_path) and not config.get("regenerate_voice"):
            raise FileNotFoundError("Khong tim thay file voice da tao truoc do.")

        # A revision normally reuses voice.wav.  When the editor changed its
        # speaker or pace, regenerate TTS locally from the existing Vietnamese
        # subtitle and keep every other pipeline stage untouched.
        if mode == "voiceover" and not no_speech and config.get("regenerate_voice"):
            write_progress(job_dir, stage="tts", percent=24, status="running", message="Dang tao lai giong Viet da chon.", mode=mode)
            create_voice(
                source_video,
                vietnamese_srt,
                voice_path,
                job_dir / "tts",
                job_dir / "tts_manifest.json",
                force=True,
                voice_name=config.get("voice"),
                speed=config.get("tts_speed"),
            )
            if not file_ok(voice_path):
                raise RuntimeError("Khong tao duoc file voice moi.")

        # Keep the last selection if an API caller omits it. Never invoke OCR for
        # an output-only revision unless there is no saved region at all.
        previous_no_blur = False
        if not isinstance(config.get("blur_region"), dict) and region_path.is_file():
            try:
                previous_region = json.loads(region_path.read_text(encoding="utf-8"))
                previous_no_blur = previous_region.get("blur_enabled") is False
                if (
                    not previous_no_blur
                    and not config.get("disable_main_blur")
                    and isinstance(previous_region.get("blur"), dict)
                ):
                    previous_blur = dict(previous_region["blur"])
                    previous_method = str((previous_region.get("detected") or {}).get("method", ""))
                    if previous_method.startswith("temporal_srt_paddleocr"):
                        previous_blur["x"] = 0
                        previous_blur["width"] = previous_region["video"]["width"]
                    config = {**config, "blur_region": previous_blur}
            except (OSError, ValueError, json.JSONDecodeError):
                pass

        write_progress(job_dir, stage="render", percent=15, status="running", message="Dang chuan bi xuat lai thanh pham.", mode=mode)
        region = resolve_subtitle_region(source_video, region_path, region_preview, config=config, no_subtitle=previous_no_blur, force=True)
        intervals = [dict(item) for item in (config.get("blur_intervals") or []) if isinstance(item, dict)]
        custom_only = config.get("custom_blur_region")
        if isinstance(custom_only, dict) and not intervals:
            intervals.append({**custom_only, "start": 0, "end": 86400})

        temporary_output = output_path.with_name(f".{output_path.stem}.rerendering{output_path.suffix}")
        temporary_output.unlink(missing_ok=True)
        write_progress(job_dir, stage="render", percent=35, status="running", message="Dang xuat lai video voi vung mo da chinh.", mode=mode)
        common = {
            "preview_seconds": None,
            "font_size": config.get("subtitle_font_size"),
            "subtitle_style": config.get("subtitle_style", "minimal"),
            "aspect_ratio": config.get("aspect_ratio"),
            "logo_size": config.get("logo_size"),
            "logo_x": config.get("logo_x"),
            "logo_y": config.get("logo_y"),
            "logo_mode": config.get("logo_mode", "none"),
            "logo_text": config.get("logo_text"),
            "logo_path": config.get("logo_path"),
            "blur_intervals": intervals,
            "music_path": config.get("music_path"),
            "music_volume": normalize_music_volume(config.get("music_volume", 0.25)),
            "auto_brand_blur": bool(config.get("auto_brand_blur", False)),
            "force": True,
        }
        if mode == "voiceover" and not no_speech:
            render_voiceover(source_video, voice_path, vietnamese_srt, region_path, ass_path, temporary_output, region, original_volume=original_volume, voice_volume=voice_volume, **common)
        else:
            render_subtitle_only(source_video, vietnamese_srt, region_path, ass_path, temporary_output, region, **common)
        if not file_ok(temporary_output):
            raise RuntimeError("Khong tao duoc file thanh pham khi xuat lai.")
        temporary_output.replace(output_path)
        return source_video, region


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



    url = normalize_video_url(url)

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

    music_url = normalize_music_url(config.get("music_url"))
    if music_url and music_path is None:
        write_progress(
            job_dir,
            stage="music",
            percent=2,
            status="running",
            message="Đang tải và kiểm tra nhạc nền.",
            mode=mode,
        )
        music_path = resolve_music_url_track(job_dir, music_url, valid_music_file)
    # Render revisions can reuse a local background track created by the
    # original job. Only accept files inside this job directory; browser input
    # never controls this path.
    if music_path is None and config.get("render_only") and config.get("rerender_music_path"):
        try:
            cached_music = Path(str(config["rerender_music_path"])).resolve()
            cached_music.relative_to(job_dir.resolve())
            if valid_music_file(cached_music):
                music_path = cached_music
        except (OSError, ValueError):
            pass
    music_volume = normalize_music_volume(config.get("music_volume", 0.25))
    config = {
        **config,
        "music_path": str(music_path) if music_path and valid_music_file(music_path) else None,
        "music_volume": music_volume,
    }







    audio_path = job_dir / "source_16k.wav"



    chinese_srt = job_dir / "chinese.srt"



    vietnamese_srt = job_dir / "vietnamese.srt"



    translation_checkpoint = job_dir / "translation_checkpoint.json"
    source_language = config.get("source_language", "auto")
    target_language = str(config.get("target_language") or "vi").strip().lower() or "vi"
    source_language_path = job_dir / "source_language.txt"
    target_language_path = job_dir / "target_language.txt"
    previous_source_language = source_language_path.read_text(encoding="utf-8").strip() if source_language_path.is_file() else "auto"
    previous_target_language = target_language_path.read_text(encoding="utf-8").strip() if target_language_path.is_file() else "vi"
    language_force = source_language != previous_source_language
    target_language_force = target_language != previous_target_language
    transcript_source = config.get("transcript_source", "audio")
    transcription_signature_path = job_dir / "transcription_settings.sha256"
    if config.get("boost_gpu"):
        os.environ["REUP_BOOST_GPU"] = "1"
        config["ocr_use_gpu"] = True
        config["ocr_parallelism"] = max(int(config.get("ocr_parallelism") or 2), 4)
    else:
        os.environ.pop("REUP_BOOST_GPU", None)

    is_ocr_source = transcript_source == "video_subtitles"
    # Only OCR transcripts depend on OCR knobs. Keeping them out of the audio
    # signature means toggling Boost GPU never discards a finished Whisper
    # transcript or its translation checkpoint.
    transcription_signature = stable_fingerprint({
        "schema": 1,
        "transcript_source": transcript_source,
        "manual_transcript": config.get("manual_transcript") or None,
        "source_language": source_language,
        "ocr_language": config.get("ocr_language", "auto") if is_ocr_source else "auto",
        "ocr_fps": float(config.get("ocr_fps", 2.0) or 2.0) if is_ocr_source else 2.0,
        "ocr_min_confidence": float(config.get("ocr_min_confidence", 0.45) or 0.45) if is_ocr_source else 0.45,
        "ocr_parallelism": int(config.get("ocr_parallelism", 2) or 2) if is_ocr_source else 2,
        "ocr_use_gpu": bool(config.get("ocr_use_gpu", False)) if is_ocr_source else False,
        "ocr_merge_similar": bool(config.get("ocr_merge_similar", True)) if is_ocr_source else True,
        "ocr_similarity_threshold": float(config.get("ocr_similarity_threshold", 0.82) or 0.82) if is_ocr_source else 0.82,
    })
    previous_transcription_signature = (
        transcription_signature_path.read_text(encoding="utf-8").strip()
        if transcription_signature_path.is_file() else ""
    )
    transcription_changed = transcription_signature != previous_transcription_signature
    transcription_force = force or language_force or transcription_changed
    translation_force = force or language_force or target_language_force or transcription_changed
    if translation_force:
        translation_checkpoint.unlink(missing_ok=True)



    translation_debug = job_dir / "translation_debug.json"



    voice_flac = job_dir / "voice.flac"
    voice_wav = job_dir / "voice.wav"
    voice_path = voice_flac if voice_flac.is_file() else voice_wav



    tts_manifest = job_dir / "tts_manifest.json"
    tts_fingerprint_path = job_dir / "tts_fingerprint.sha256"
    tts_in_progress_fingerprint_path = job_dir / "tts_in_progress.sha256"



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







    if config.get("render_only"):
        source_video, region = rerender_existing_output(
            url=url,
            job_dir=job_dir,
            mode=mode,
            source_file=source_file,
            output_path=output_path,
            ass_path=ass_path,
            region_path=region_path,
            region_preview=region_preview,
            vietnamese_srt=vietnamese_srt,
            voice_path=voice_path,
            config=config,
            original_volume=original_volume,
            voice_volume=voice_volume,
        )
        existing = {}
        try:
            existing = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            pass
        save_job_info(job_dir, {
            **(existing if isinstance(existing, dict) else {}),
            "job_id": job_id,
            "url": url,
            "channel": channel_key,
            "mode": mode,
            "source_video": rel(source_video),
            "vietnamese_srt": rel(vietnamese_srt),
            "subtitle_region": rel(region_path),
            "ass": rel(ass_path),
            "final_video": rel(output_path),
            "status": "completed",
            "render_revision": True,
            "warnings": region.get("warnings", []),
        })
        write_progress(
            job_dir, stage="completed", percent=100, status="completed",
            message="Da xuat lai thanh pham voi vung mo da chinh.", mode=mode,
        )
        return

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



        offline_mode = bool(config.get("offline_mode"))
        boost_gpu = bool(config.get("boost_gpu"))
        stability_mode = bool(config.get("stability_mode", False))
        _saved_env = {}
        _env_updates = {
            "LOCAL_TRANSLATION_FALLBACK": "1",
        }
        _env_updates.setdefault("REUP_RENDER_CHUNK_SECONDS", os.getenv("REUP_RENDER_CHUNK_SECONDS", "600"))
        if stability_mode and not boost_gpu:
            _env_updates["REUP_STABILITY_MODE"] = "1"
            _env_updates["REUP_TTS_ONNX_WORKERS"] = "1"
        if offline_mode:
            _env_updates["REUP_OFFLINE_MODE"] = "1"
            _env_updates["REUP_TTS_EDGE_FALLBACK"] = "0"
        for _k, _v in _env_updates.items():
            _saved_env[_k] = os.environ.get(_k)
            os.environ[_k] = _v

        # Validate Gemini before downloading or transcribing unless running in
        # Offline mode or using an already-approved translation.
        write_progress(
            job_dir,
            stage="prepare",
            percent=2,
            status="running",
            message=(
                "Che do Offline · Uu tien on dinh dang kich hoat."
                if offline_mode
                else "Dang kiem tra ket noi va chuan bi checkpoint xu ly."
            ),
            mode=mode,
        )
        from services.reviewed_subtitles import reviewed_translation_lines

        approved_translation = reviewed_translation_lines(config.get("manual_transcript"))
        if approved_translation is None and not offline_mode:
            from services.translator import ensure_translation_ready

            ensure_translation_ready()

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
        _record_stage_checkpoint(job_dir, "source", {"source_video": rel(source_video)})
        from services.final_renderer import _probe_media_duration as _probe_video_duration_seconds
        source_duration_seconds = _probe_video_duration_seconds(source_video)
        if source_duration_seconds >= 10800 and not voice_wav.is_file():
            # Avoid WAV's 4 GB RIFF limit (~6.76h at 44.1kHz stereo) on long videos.
            voice_path = voice_flac

        check_processing_storage(
            source_video, job_dir, audio_path, mode,
            voice_path=voice_path, force_audio=force, include_voice=False,
            include_audio=transcript_source == "audio",
            include_render=config.get("output_format") != "srt",
            preview_seconds=preview_seconds,
        )







        # 2. AUDIO



        write_progress(



            job_dir,



            stage="subtitle_ocr" if transcript_source == "video_subtitles" else "extract_audio",



            percent=15,



            status="running",



            message=(
                "Đang chuẩn bị đọc phụ đề trên hình."
                if transcript_source == "video_subtitles"
                else "Dang tach audio 16k."
            ),



            mode=mode,



        )







        if transcript_source == "audio":
            extract_audio(source_video, audio_path, force=force)
            _record_stage_checkpoint(job_dir, "extract_audio", {"audio": rel(audio_path)})







        # 3. WHISPER



        write_progress(



            job_dir,



            stage="subtitle_ocr" if transcript_source == "video_subtitles" else "whisper",



            percent=30,



            status="running",



            message=(
                "Đang lấy phụ đề trong hình bằng OCR."
                if transcript_source == "video_subtitles"
                else "Dang nhan dien loi thoai bang Whisper."
            ),



            mode=mode,



        )







        no_speech = False
        def on_transcription_progress(processed_seconds, total_seconds):
            if total_seconds <= 0:
                return
            percent = 30 + min(19, int(19 * processed_seconds / total_seconds))
            write_progress(
                job_dir,
                stage="subtitle_ocr" if transcript_source == "video_subtitles" else "whisper",
                percent=percent,
                status="running",
                message=(
                    ("Đang quét phụ đề trên hình: " if transcript_source == "video_subtitles" else "Đang nhận diện lời thoại: ")
                    +
                    f"{processed_seconds / 60:.0f}/{total_seconds / 60:.0f} phút."
                ),
                mode=mode,
            )
        manual_transcript = config.get("manual_transcript") or []
        if manual_transcript:
            from services import transcriber

            normalized_transcript = []
            for line in manual_transcript:
                try:
                    start = max(0.0, float(line.get("start", 0)))
                    end = float(line.get("end", 0))
                    text = str(line.get("text", "")).strip()
                except (AttributeError, TypeError, ValueError):
                    continue
                if text and end > start:
                    normalized_transcript.append({"start": start, "end": end, "text": text})
            if not normalized_transcript:
                raise RuntimeError("Bản lời thoại đã sửa không có câu hợp lệ để xử lý.")
            transcriber.save_srt(normalized_transcript, rel(chinese_srt))
            print(f"[MANUAL TRANSCRIPT] Using {len(normalized_transcript)} reviewed subtitle lines.")
            no_speech = False
        elif transcript_source == "video_subtitles":
            if not (not transcription_force and file_ok(chinese_srt) and chinese_srt.read_text(encoding="utf-8-sig").strip()):
                from services.subtitle_ocr import extract_subtitle_srt

                extract_subtitle_srt(
                    source_video,
                    chinese_srt,
                    language=config.get("ocr_language", "auto"),
                    fps=config.get("ocr_fps", 2.0),
                    min_confidence=config.get("ocr_min_confidence", 0.45),
                    parallelism=config.get("ocr_parallelism", 2),
                    use_gpu=bool(config.get("ocr_use_gpu", False)),
                    merge_similar=bool(config.get("ocr_merge_similar", True)),
                    similarity_threshold=config.get("ocr_similarity_threshold", 0.82),
                    on_progress=on_transcription_progress,
                )
            else:
                print("[SKIP] Sử dụng lại SRT OCR đã tạo với cùng cấu hình.")
            no_speech = False
        else:
            try:
                transcribe_audio(
                    audio_path, chinese_srt, force=transcription_force,
                    on_progress=on_transcription_progress,
                    source_language=config.get("source_language", "auto"),
                )
            except NoSpeechDetected as error:
                no_speech = True
                print(f"[SKIP] Khong tim thay loi thoai: {error}")
                chinese_srt.write_text("", encoding="utf-8")
                vietnamese_srt.write_text("", encoding="utf-8")

        transcription_signature_path.write_text(transcription_signature, encoding="utf-8")
        _record_stage_checkpoint(job_dir, "transcript", {"chinese_srt": rel(chinese_srt), "no_speech": no_speech})







        # 4. GEMINI



        write_progress(



            job_dir,



            stage="translate",



            percent=50,



            status="running",



            message=(
                "Không có lời thoại, bỏ qua bước dịch."
                if no_speech else (
                    "Đang dịch phụ đề đã đọc từ hình sang tiếng Việt bằng Gemini AI."
                    if transcript_source == "video_subtitles"
                    else "Đang dịch lời thoại sang tiếng Việt bằng Gemini AI."
                )
            ),



            mode=mode,



        )







        if approved_translation is not None:
            from services.transcriber import save_srt

            save_srt(approved_translation, rel(vietnamese_srt))
            print(f"[REVIEWED TRANSLATION] Using {len(approved_translation)} approved Vietnamese lines without retranslating.")
        elif not no_speech:
            translate_srt(



            job_id,



            chinese_srt,



            vietnamese_srt,



            translation_checkpoint,



            translation_debug,



            force=translation_force,

            source_language=config.get("source_language", "auto"),
            translation_model=config.get("translation_model", "gemini-3.1-flash-lite"),
            target_language=target_language,

            )
            source_language_path.write_text(source_language, encoding="utf-8")
            target_language_path.write_text(target_language, encoding="utf-8")

        if config.get("output_format") == "srt":
            from services.subtitle_export import export_subtitle_file
            subtitle_output = export_subtitle_file(vietnamese_srt, job_dir)
            save_job_info(job_dir, {
                **base_job, "status": "completed", "output_format": "srt",
                "source_video": rel(source_video), "chinese_srt": rel(chinese_srt),
                "vietnamese_srt": rel(vietnamese_srt), "final_srt": rel(subtitle_output),
            })
            write_progress(job_dir, stage="completed", percent=100, status="completed",
                           message="Đã xuất file SRT tiếng Việt. Không render video.", mode=mode)
            return subtitle_output







        # 5. TTS - chi voiceover moi chay



        if mode == "voiceover" and not no_speech:



            write_progress(



                job_dir,



                stage="tts",



                percent=68,



                status="running",



                message="Dang tao giong Viet bang Edge-TTS.",



                mode=mode,



            )







            from services import tts as tts_module
            effective_voice = tts_module.resolve_voice_for_target_language(
                config.get("voice"),
                target_language=target_language,
            )
            tts_fingerprint = stable_fingerprint({
                "schema": 1,
                "subtitle": file_fingerprint(vietnamese_srt),
                "voice": effective_voice or "default",
                "target_language": target_language,
                "speed": float(config.get("tts_speed") or 1.00),
            })
            tts_force = bool(
                force
                or not (
                    cache_fingerprint_matches(tts_fingerprint_path, tts_fingerprint)
                    or cache_fingerprint_matches(tts_in_progress_fingerprint_path, tts_fingerprint)
                )
            )
            check_processing_storage(
                source_video, job_dir, audio_path, mode,
                voice_path=voice_path, force_voice=tts_force,
                preview_seconds=preview_seconds,
            )
            # Keep completed clips after an interruption only when subtitle,
            # voice and speed still match the configuration that made them.
            write_cache_fingerprint(tts_in_progress_fingerprint_path, tts_fingerprint)
            last_tts_percent = 68
            def on_voice_progress(phase, current, total):
                nonlocal last_tts_percent
                if total <= 0:
                    return
                fraction = min(1.0, max(0.0, current / total))
                if phase == "raw":
                    percent = 68 + int(3 * fraction)
                    label = "Đang tạo giọng nói"
                elif phase == "clips":
                    percent = 71 + int(4 * fraction)
                    label = "Đang ghép từng câu thoại"
                else:
                    percent = 75 + int(2 * fraction)
                    label = "Đang tạo track giọng nói"
                if percent <= last_tts_percent:
                    return
                last_tts_percent = percent
                write_progress(
                    job_dir,
                    stage="tts",
                    percent=percent,
                    status="running",
                    message=f"{label}: {fraction:.0%}.",
                    mode=mode,
                )
            voice_path = create_voice(



                source_video,



                vietnamese_srt,



                voice_path,



                tts_dir,



                tts_manifest,



                force=tts_force,



                voice_name=effective_voice,



                speed=config.get("tts_speed"),

                on_progress=on_voice_progress,



            )
            write_cache_fingerprint(tts_fingerprint_path, tts_fingerprint)
            tts_in_progress_fingerprint_path.unlink(missing_ok=True)
            _record_stage_checkpoint(job_dir, "tts", {"voice": rel(voice_path)})



        else:



            print("\n[SKIP] TTS - khong co loi thoai de tao giong Viet." if mode == "voiceover" else "\n[SKIP] TTS - mode subtitle chi tao Vietsub.")







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
            config=config, no_subtitle=no_speech, force=force,
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







        last_render_percent = 80
        def on_render_progress(done_seconds, total_seconds):
            nonlocal last_render_percent
            if total_seconds <= 0:
                return
            fraction = min(1.0, max(0.0, done_seconds / total_seconds))
            percent = 80 + min(18, int(18 * fraction))
            if percent <= last_render_percent:
                return
            last_render_percent = percent
            write_progress(
                job_dir,
                stage="render",
                percent=percent,
                status="running",
                message=f"Dang render tung doan co checkpoint: {done_seconds / 60:.0f}/{total_seconds / 60:.0f} phut ({fraction:.0%}).",
                mode=mode,
            )

        if mode == "voiceover" and not no_speech:

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
                subtitle_style=config.get("subtitle_style", "minimal"),

                aspect_ratio=config.get("aspect_ratio"),

                logo_size=config.get("logo_size"),

                logo_x=config.get("logo_x"),

                logo_y=config.get("logo_y"),

                logo_mode=config.get("logo_mode", "none"),

                logo_text=config.get("logo_text"),

                logo_path=config.get("logo_path"),

                blur_intervals=effective_blur_intervals,

                music_path=config.get("music_path"),

                music_volume=float(config.get("music_volume", 0.25)),
                auto_brand_blur=bool(config.get("auto_brand_blur", False)),
                on_render_progress=on_render_progress,

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
                subtitle_style=config.get("subtitle_style", "minimal"),

                aspect_ratio=config.get("aspect_ratio"),

                logo_size=config.get("logo_size"),

                logo_x=config.get("logo_x"),

                logo_y=config.get("logo_y"),

                logo_mode=config.get("logo_mode", "none"),

                logo_text=config.get("logo_text"),

                logo_path=config.get("logo_path"),

                blur_intervals=effective_blur_intervals,

                music_path=config.get("music_path"),

                music_volume=float(config.get("music_volume", 0.25)),
                auto_brand_blur=bool(config.get("auto_brand_blur", False)),
                on_render_progress=on_render_progress,

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







        if mode == "voiceover" and not no_speech:



            completed_job["voice"] = rel(voice_path)



            completed_job["tts_manifest"] = rel(tts_manifest)







        save_job_info(job_dir, completed_job)

        _record_stage_checkpoint(job_dir, "completed", {"final_video": rel(output_path)})

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
    finally:
        for _k, _old in locals().get("_saved_env", {}).items():
            if _old is None:
                os.environ.pop(_k, None)
            else:
                os.environ[_k] = _old











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



            "Channel key, vi du: default, 3d_animation, comedy. "



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
