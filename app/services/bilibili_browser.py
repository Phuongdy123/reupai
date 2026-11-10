"""Browser fallback for Bilibili when its public extractor rejects yt-dlp."""

from __future__ import annotations

import shutil
import os
import subprocess
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.request import Request, urlopen
from uuid import uuid4

from services.download_space import ensure_download_space


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


class BilibiliAccessError(RuntimeError):
    """The source needs user action; retrying the same request is unhelpful."""

    def __init__(self, status: int):
        self.status = status
        messages = {
            401: "Bilibili yêu cầu đăng nhập để xem video. Mở đúng link bằng trình duyệt trên máy này và kiểm tra quyền xem.",
            403: "Bilibili từ chối quyền xem hoặc tải video. Kiểm tra video bằng trình duyệt trên máy này.",
            404: "Video Bilibili không tồn tại hoặc đã bị gỡ. Kiểm tra lại liên kết.",
            410: "Video Bilibili đã bị gỡ. Chọn video nguồn khác.",
            412: "Bilibili yêu cầu kiểm tra phiên truy cập (HTTP 412). Mở đúng link video trong Chrome/Edge trên máy này, hoàn tất xác minh nếu có rồi thử lại sau. Chưa đủ thông tin để kết luận chặn IP.",
            429: "Bilibili đang giới hạn yêu cầu (HTTP 429). Dừng gửi thêm yêu cầu và thử lại sau ít phút.",
        }
        super().__init__(messages.get(status, f"Bilibili trả HTTP {status} khi mở video. Hãy kiểm tra nguồn rồi thử lại."))


def _browser_executable() -> str | None:
    chrome = (
        shutil.which("chrome"),
        r"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        r"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        str(Path(os.getenv('LOCALAPPDATA', '')) / 'Google/Chrome/Application/chrome.exe'),
    )
    edge = (
        shutil.which("msedge"),
        r"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        str(Path(os.getenv('LOCALAPPDATA', '')) / 'Microsoft/Edge/Application/msedge.exe'),
    )
    candidates = edge + chrome if os.getenv('REUP_COOKIE_BROWSER', 'chrome').split(':',1)[0] == 'edge' else chrome + edge
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


def _bilibili_cookies() -> tuple[list[dict], str]:
    """Read the configured customer's profile, importing only Bilibili cookies.

    Never persist/export cookies or silently switch to another browser/account.
    Chrome may deny decryption; that is reported without exposing cookie data.
    """
    specification = os.getenv('REUP_COOKIE_BROWSER', 'chrome').strip()
    browser, _, profile = specification.partition(':')
    if browser not in {'chrome', 'edge', 'firefox', 'brave', 'chromium'}:
        return [], 'unavailable'
    class QuietLogger:
        def debug(self, *args, **kwargs): pass
        def info(self, *args, **kwargs): pass
        def warning(self, *args, **kwargs): pass
        def error(self, *args, **kwargs): pass
    try:
        from yt_dlp.cookies import extract_cookies_from_browser
        jar = extract_cookies_from_browser(browser, profile=profile or None, logger=QuietLogger())
        cookies = []
        for item in jar:
            domain = str(item.domain or '').lstrip('.').lower()
            if not (domain == 'bilibili.com' or domain.endswith('.bilibili.com')):
                continue
            if not item.name or item.value is None or item.expires is not None and item.expires <= time.time():
                continue
            cookie = {'name': item.name, 'value': item.value, 'domain': item.domain,
                      'path': item.path if str(item.path or '').startswith('/') else '/', 'secure': bool(item.secure)}
            if item.expires is not None:
                cookie['expires'] = item.expires
            rest = getattr(item, '_rest', {})
            cookie['httpOnly'] = any(str(key).lower() == 'httponly' for key in rest)
            cookies.append(cookie)
        return cookies, 'available' if cookies else 'empty'
    except Exception:
        # Do not log raw extraction errors: they can contain profile paths or
        # credential data. The caller reports the browser/session state only.
        return [], 'unavailable'


def _download(url: str, destination: Path, referer: str, *, user_agent: str = USER_AGENT) -> None:
    request = Request(url, headers={"User-Agent": user_agent, "Referer": referer})
    with urlopen(request, timeout=60) as response:
        content_length = response.headers.get("Content-Length", "")
        expected_bytes = int(content_length) if content_length.isdecimal() else 0
        ensure_download_space(
            destination.parent,
            expected_bytes=expected_bytes,
            operation="tải luồng video tạm",
        )
        written = 0
        next_space_check = 64 * 1024 * 1024
        with destination.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                written += len(chunk)
                if written >= next_space_check:
                    ensure_download_space(
                        destination.parent,
                        expected_bytes=max(0, expected_bytes - written),
                        operation="tải luồng video tạm",
                    )
                    next_space_check += 64 * 1024 * 1024
        if expected_bytes and written != expected_bytes:
            raise RuntimeError(
                "Bilibili gửi thiếu dữ liệu video; kết nối có thể đã bị ngắt."
            )


@contextmanager
def _staged_output(output_path: Path):
    """Keep incomplete mux output separate and remove it on every failure."""
    staged = output_path.with_name(
        f"{output_path.stem}.pending.{uuid4().hex}{output_path.suffix}"
    )
    try:
        yield staged
    finally:
        try:
            staged.unlink(missing_ok=True)
        except OSError:
            # A cleanup failure must not conceal the actual download result.
            pass


def download_video(url: str, output_path: Path) -> Path:
    """Try the configured Bilibili session in a temporary local browser."""
    browser_path = _browser_executable()
    if not browser_path:
        raise RuntimeError("Không tìm thấy Chrome hoặc Edge để tải Bilibili fallback.")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("Local Engine thiếu Playwright cho Bilibili fallback.") from error

    cookies, session_state = _bilibili_cookies()
    print(f'[bilibili] browser session: {session_state}; imported Bilibili cookies: {len(cookies)}')
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=browser_path,
            headless=True,
        )
        try:
            context = browser.new_context(viewport={"width": 1365, "height": 900})
            if cookies:
                context.add_cookies(cookies)
            page = context.new_page()
            user_agent = page.evaluate('() => navigator.userAgent')
            response = page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            if response is not None and response.status >= 400:
                if response.status == 412 and session_state == 'unavailable':
                    raise RuntimeError('Bilibili trả HTTP 412 và ReupAI chưa đọc được phiên trình duyệt đã chọn. Kiểm tra đúng hồ sơ Chrome/Edge và tài khoản Windows; trình duyệt có thể đang khóa hoặc bảo vệ cookie. Không thể dùng phiên ẩn danh thay cho phiên đang xem được.')
                raise BilibiliAccessError(response.status)
            if "passport.bilibili.com" in page.url:
                raise BilibiliAccessError(401)
            # __playinfo__ is created before the asynchronous play URL request
            # finishes.  Waiting only for the object races that request and
            # yields an empty ``data`` object for some Bilibili videos.
            page.wait_for_function(
                """() => {
                    const data = window.__playinfo__?.data || {};
                    const progressive = Array.isArray(data.durl)
                        && data.durl.some(item => item && (item.url || item.baseUrl || item.base_url));
                    const dash = data.dash || {};
                    const separate = Array.isArray(dash.video) && dash.video.length > 0
                        && Array.isArray(dash.audio) && dash.audio.length > 0;
                    return progressive || separate;
                }""",
                timeout=30_000,
            )
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
    with _staged_output(output_path) as staged_path, tempfile.TemporaryDirectory(
        prefix="reupai-bilibili-", dir=output_path.parent
    ) as folder:
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
                _download(stream_url, part, url, user_agent=user_agent)
                parts.append(part)

            if len(parts) == 1:
                ensure_download_space(
                    output_path.parent,
                    expected_bytes=parts[0].stat().st_size,
                    operation="lưu video nguồn",
                )
                shutil.copyfile(parts[0], staged_path)
            else:
                ensure_download_space(
                    output_path.parent,
                    expected_bytes=sum(part.stat().st_size for part in parts),
                    operation="ghép video nguồn",
                )
                manifest = folder_path / "concat.txt"
                manifest.write_text(
                    "".join(f"file '{part.as_posix()}'\n" for part in parts),
                    encoding="utf-8",
                )
                result = subprocess.run(
                    ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(manifest), "-c", "copy", str(staged_path)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                    check=False,
                )
                if result.returncode != 0:
                    raise RuntimeError("Bilibili browser fallback không ghép được các đoạn MP4: " + result.stderr[-500:])
            if not staged_path.is_file() or staged_path.stat().st_size < 1024:
                raise RuntimeError("Bilibili browser fallback không tạo được MP4 hoàn chỉnh.")
            staged_path.replace(output_path)
            return output_path

        if not video_url or not audio_url:
            raise RuntimeError("Bilibili browser fallback không lấy được stream video hoặc audio.")

        video_file, audio_file = folder_path / "video.m4s", folder_path / "audio.m4s"
        _download(video_url, video_file, url, user_agent=user_agent)
        _download(audio_url, audio_file, url, user_agent=user_agent)
        ensure_download_space(
            output_path.parent,
            expected_bytes=video_file.stat().st_size + audio_file.stat().st_size,
            operation="ghép video và âm thanh",
        )
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", str(video_file), "-i", str(audio_file), "-c", "copy", str(staged_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if result.returncode != 0 or not staged_path.is_file() or staged_path.stat().st_size < 1024:
            raise RuntimeError("Bilibili browser fallback không ghép được video: " + result.stderr[-500:])
        staged_path.replace(output_path)
        return output_path
