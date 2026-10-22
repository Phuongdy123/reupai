"""Browser fallback for Bilibili when its public extractor rejects yt-dlp."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


def _browser_executable() -> str | None:
    candidates = (
        shutil.which("chrome"),
        shutil.which("msedge"),
        r"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        r"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        r"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    )
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def _value(stream: dict, *names: str) -> str:
    for name in names:
        value = stream.get(name)
        if value:
            return str(value)
    backups = stream.get("backupUrl") or stream.get("backup_url") or []
    return str(backups[0]) if backups else ""


def _download(url: str, destination: Path, referer: str) -> None:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Referer": referer})
    with urlopen(request, timeout=60) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def download_video(url: str, output_path: Path) -> Path:
    """Download an anonymous Bilibili stream through local Chrome/Edge.

    We use a temporary headless profile, so this never reads customer cookies
    or changes their existing browser session.
    """
    browser_path = _browser_executable()
    if not browser_path:
        raise RuntimeError("Không tìm thấy Chrome hoặc Edge để tải Bilibili fallback.")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("Local Engine thiếu Playwright cho Bilibili fallback.") from error

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=browser_path,
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            page = browser.new_page(viewport={"width": 1365, "height": 900}, user_agent=USER_AGENT)
            page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_function("() => Boolean(window.__playinfo__)", timeout=15_000)
            playinfo = page.evaluate("() => window.__playinfo__") or {}
        finally:
            browser.close()

    data = playinfo.get("data") or {}
    dash = data.get("dash") or {}
    videos = dash.get("video") or []
    audios = dash.get("audio") or []
    accessible = [stream for stream in videos if int(stream.get("height") or 0) <= 720]
    video = max(accessible or videos, key=lambda stream: (int(stream.get("height") or 0), int(stream.get("bandwidth") or 0)), default=None)
    audio = max(audios, key=lambda stream: int(stream.get("bandwidth") or 0), default=None)
    video_url = _value(video or {}, "baseUrl", "base_url")
    audio_url = _value(audio or {}, "baseUrl", "base_url")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="reupai-bilibili-") as folder:
        folder_path = Path(folder)

        # Bilibili returns a classic progressive MP4 (``durl``) for some
        # videos, usually when an anonymous session only receives 480p.
        # Those responses intentionally have no DASH video/audio lists.
        durls = data.get("durl") or []
        if durls:
            parts: list[Path] = []
            for index, item in enumerate(durls):
                stream_url = _value(item, "url", "baseUrl", "base_url")
                if not stream_url:
                    raise RuntimeError("Bilibili trả về một đoạn MP4 không có URL tải.")
                part = folder_path / f"part-{index:03d}.mp4"
                _download(stream_url, part, url)
                parts.append(part)

            if len(parts) == 1:
                shutil.copyfile(parts[0], output_path)
            else:
                manifest = folder_path / "concat.txt"
                manifest.write_text(
                    "".join(f"file '{part.as_posix()}'\n" for part in parts),
                    encoding="utf-8",
                )
                result = subprocess.run(
                    ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(manifest), "-c", "copy", str(output_path)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                    check=False,
                )
                if result.returncode != 0:
                    raise RuntimeError("Bilibili browser fallback không ghép được các đoạn MP4: " + result.stderr[-500:])
            return output_path

        if not video_url or not audio_url:
            raise RuntimeError("Bilibili browser fallback không lấy được stream video hoặc audio.")

        video_file, audio_file = folder_path / "video.m4s", folder_path / "audio.m4s"
        _download(video_url, video_file, url)
        _download(audio_url, audio_file, url)
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", str(video_file), "-i", str(audio_file), "-c", "copy", str(output_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
    if result.returncode != 0 or not output_path.is_file() or output_path.stat().st_size < 1024:
        raise RuntimeError("Bilibili browser fallback không ghép được video: " + result.stderr[-500:])
    return output_path
