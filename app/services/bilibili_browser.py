"""Browser fallback for Bilibili when its public extractor rejects yt-dlp."""

from __future__ import annotations

import shutil
import os
import re
import socket
import subprocess
import tempfile
import time
from email.utils import parsedate_to_datetime
from http.client import IncompleteRead
from contextlib import contextmanager
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from services.download_space import DownloadStorageError, ensure_download_space


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


def _stream_urls(stream: dict, *names: str) -> list[str]:
    """Return primary and backup CDN URLs without duplicates."""
    urls = []
    for name in names:
        value = stream.get(name)
        if isinstance(value, str) and value:
            urls.append(value)
    for name in ("backupUrl", "backup_url"):
        backups = stream.get(name) or []
        if isinstance(backups, str):
            backups = [backups]
        urls.extend(value for value in backups if isinstance(value, str) and value)
    return list(dict.fromkeys(urls))


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


def _bilibili_profile_dir() -> Path:
    browser_name = os.getenv('REUP_COOKIE_BROWSER', 'chrome').split(':', 1)[0].strip()
    base = Path(os.getenv('LOCALAPPDATA') or (Path.home() / 'AppData/Local'))
    return base / 'ReupAI' / 'browser-profiles' / f'bilibili-{browser_name}'


def _public_playinfo(context, url: str) -> dict:
    """Ask Bilibili's public metadata/player endpoints before loading the page.

    This path needs no Bilibili login. It is useful when the ordinary video
    page is rate-limited with HTTP 412 while public playback APIs still work.
    A failed/blocked endpoint is only a signal to try the browser fallback.
    """
    parts = urlsplit(url)
    match = re.search(r'(?i)/(BV[0-9A-Za-z]+|av\d+)(?:/|$)', parts.path)
    if not match:
        return {}
    video_id = match.group(1)
    key, value = ('aid', video_id[2:]) if video_id.lower().startswith('av') else ('bvid', video_id)
    headers = {'Referer': url, 'Accept': 'application/json'}
    try:
        view = context.request.get(
            'https://api.bilibili.com/x/web-interface/view',
            params={key: value}, headers=headers, timeout=12_000,
        )
        if view.status != 200:
            return {}
        payload = view.json()
        video_data = payload.get('data') if isinstance(payload, dict) and payload.get('code') == 0 else None
        if not isinstance(video_data, dict):
            return {}
        selected = (parse_qs(parts.query).get('p') or ['1'])[0]
        index = int(selected) - 1 if str(selected).isdecimal() else 0
        pages = video_data.get('pages') or []
        cid = (pages[index].get('cid') if 0 <= index < len(pages) else None) or video_data.get('cid')
        bvid = video_data.get('bvid') or (video_id if key == 'bvid' else None)
        if not (cid and bvid):
            return {}
        player = context.request.get(
            'https://api.bilibili.com/x/player/playurl',
            params={'bvid': bvid, 'cid': cid, 'qn': 64, 'fnval': 16, 'fourk': 1},
            headers=headers, timeout=15_000,
        )
        if player.status != 200:
            return {}
        result = player.json()
        if result.get('code') == 0 and isinstance(result.get('data'), dict):
            return result
    except Exception:
        # Keep the browser route available, and never log signed/media URLs.
        return {}
    return {}


def _open_persistent_bilibili_page(playwright, browser_path: str, url: str):
    """Open a visible ReupAI browser profile only for Bilibili verification."""
    profile_dir = _bilibili_profile_dir()
    profile_dir.mkdir(parents=True, exist_ok=True)
    context = playwright.chromium.launch_persistent_context(
        user_data_dir=str(profile_dir),
        executable_path=browser_path,
        headless=False,
        viewport={"width": 1365, "height": 900},
    )
    page = context.new_page()
    print('[bilibili] opening ReupAI browser profile for interactive verification')
    try:
        response = page.goto(url, wait_until='domcontentloaded', timeout=45_000)
    except Exception:
        context.close()
        raise

    deadline = time.monotonic() + 180
    last_status = response.status if response is not None else None
    announced = False
    while time.monotonic() < deadline:
        current_url = str(page.url or '')
        if 'passport.bilibili.com' in current_url:
            if not announced:
                print('[bilibili] if requested by the source, sign in or complete verification in the opened browser; waiting up to 3 minutes')
                announced = True
            page.wait_for_timeout(1_000)
            continue
        if last_status == 412:
            if not announced:
                print('[bilibili] complete any verification in the opened browser; waiting up to 3 minutes')
                announced = True
            page.wait_for_timeout(8_000)
            try:
                response = page.reload(wait_until='domcontentloaded', timeout=20_000)
                last_status = response.status if response is not None else None
            except Exception:
                last_status = 412
            continue
        if last_status is not None and last_status >= 400:
            context.close()
            raise BilibiliAccessError(last_status)
        return context, page

    context.close()
    raise RuntimeError(
        'Bilibili chưa cho phép mở video sau khi chờ xác minh 3 phút. '
        'Hoàn tất xác minh trong cửa sổ ReupAI nếu trang yêu cầu rồi thử lại; '
        'đăng nhập chỉ cần thiết nếu chính video yêu cầu. '
        'Phiên trình duyệt ReupAI được lưu riêng trên máy.'
    )


def _download(url: str, destination: Path, referer: str, *, user_agent: str = USER_AGENT) -> None:
    """Download a CDN stream with bounded retries and HTTP Range resume."""
    partial = destination.with_name(destination.name + ".part")
    max_attempts = 5

    def retry_delay(error: BaseException, attempt: int) -> float | None:
        if isinstance(error, HTTPError):
            if error.code not in {408, 425, 429, 500, 502, 503, 504}:
                return None
            retry_after = error.headers.get("Retry-After", "") if error.headers else ""
            try:
                return min(30.0, max(1.0, float(retry_after)))
            except (TypeError, ValueError):
                try:
                    when = parsedate_to_datetime(retry_after).timestamp()
                    return min(30.0, max(1.0, when - time.time()))
                except (TypeError, ValueError, OverflowError):
                    return min(8.0, 1.5 ** attempt)
        if isinstance(error, URLError):
            reason = error.reason
            if isinstance(reason, OSError) and getattr(reason, "errno", None) in {28, 39}:
                return None
        if isinstance(error, (TimeoutError, socket.timeout, ConnectionError, IncompleteRead, URLError)):
            return min(8.0, 1.5 ** attempt)
        return None

    last_error: BaseException | None = None
    try:
        for attempt in range(max_attempts):
            offset = partial.stat().st_size if partial.exists() else 0
            headers = {"User-Agent": user_agent, "Referer": referer}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            try:
                request = Request(url, headers=headers)
                with urlopen(request, timeout=90) as response:
                    status = getattr(response, "status", response.getcode())
                    # Some CDNs ignore Range. In that case, restart the
                    # temporary file rather than append a duplicate payload.
                    append = bool(offset and status == 206)
                    if offset and not append:
                        offset = 0
                    content_range = response.headers.get("Content-Range", "")
                    total_bytes = 0
                    if content_range:
                        match = re.search(r"bytes\s+(\d+)-\d+/(\d+)", content_range, re.IGNORECASE)
                        if match:
                            range_start, total_bytes = int(match.group(1)), int(match.group(2))
                            if append and range_start != offset:
                                partial.unlink(missing_ok=True)
                                raise ConnectionError("CDN trả sai vị trí tiếp tục tải.")
                        elif append:
                            partial.unlink(missing_ok=True)
                            raise ConnectionError("CDN không xác nhận vị trí tiếp tục tải.")
                    content_length = response.headers.get("Content-Length", "")
                    response_bytes = int(content_length) if content_length.isdecimal() else 0
                    if total_bytes <= 0 and response_bytes:
                        total_bytes = offset + response_bytes
                    ensure_download_space(
                        destination.parent,
                        expected_bytes=response_bytes,
                        operation="tiếp tục tải luồng video tạm",
                    )
                    written = 0
                    next_space_check = 64 * 1024 * 1024
                    mode = "ab" if append else "wb"
                    with partial.open(mode) as output:
                        while chunk := response.read(1024 * 1024):
                            output.write(chunk)
                            written += len(chunk)
                            if written >= next_space_check:
                                remaining = max(0, response_bytes - written) if response_bytes else 0
                                ensure_download_space(
                                    destination.parent,
                                    expected_bytes=remaining,
                                    operation="tiếp tục tải luồng video tạm",
                                )
                                next_space_check += 64 * 1024 * 1024
                    final_size = partial.stat().st_size
                    if response_bytes and written != response_bytes:
                        raise ConnectionError("Bilibili gửi thiếu dữ liệu trong luồng video.")
                    if total_bytes and final_size != total_bytes:
                        raise ConnectionError("Luồng video Bilibili chưa tải đủ số byte.")
                    if final_size < 1024:
                        raise RuntimeError("Bilibili trả về luồng video rỗng hoặc không hợp lệ.")
                partial.replace(destination)
                return
            except (HTTPError, URLError, TimeoutError, socket.timeout, ConnectionError, IncompleteRead) as error:
                last_error = error
                delay = retry_delay(error, attempt)
                if delay is None or attempt + 1 >= max_attempts:
                    if isinstance(error, HTTPError):
                        raise RuntimeError(f"CDN Bilibili trả HTTP {error.code} khi tải luồng video.") from error
                    raise RuntimeError(
                        f"Kết nối CDN Bilibili bị gián đoạn sau {attempt + 1} lần thử; "
                        "không thể hoàn tất luồng video."
                    ) from error
                print(f"[bilibili] stream interrupted; resuming byte {partial.stat().st_size if partial.exists() else 0} after retry {attempt + 1}/{max_attempts}")
                time.sleep(delay)
    finally:
        # Partial data is intentionally retained only for retries within this
        # call. The caller's temporary job folder removes it after failure.
        if partial.exists() and not destination.exists():
            partial.unlink(missing_ok=True)


def _download_stream(
    stream: dict,
    destination: Path,
    referer: str,
    *,
    names: tuple[str, ...],
    user_agent: str,
) -> None:
    """Try the primary CDN then each Bilibili-provided backup URL."""
    urls = _stream_urls(stream, *names)
    if not urls:
        raise RuntimeError("Bilibili trả về luồng video không có URL tải.")
    last_error = None
    for index, stream_url in enumerate(urls):
        try:
            _download(stream_url, destination, referer, user_agent=user_agent)
            return
        except DownloadStorageError:
            raise
        except RuntimeError as error:
            last_error = error
            if index + 1 < len(urls):
                print(f"[bilibili] CDN chính lỗi; thử URL dự phòng {index + 1}/{len(urls) - 1}")
    raise last_error or RuntimeError("Không tải được luồng video Bilibili.")


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
        browser = None
        context = None
        try:
            # Once the customer has signed in through ReupAI's own profile,
            # reuse that profile headlessly for normal jobs. This avoids both
            # Chrome's App-Bound cookie decryption and an interactive window
            # on every subsequent download.
            profile_dir = _bilibili_profile_dir()
            if profile_dir.is_dir():
                context = playwright.chromium.launch_persistent_context(
                    user_data_dir=str(profile_dir),
                    executable_path=browser_path,
                    headless=True,
                    viewport={"width": 1365, "height": 900},
                )
            else:
                browser = playwright.chromium.launch(
                    executable_path=browser_path,
                    headless=True,
                )
                context = browser.new_context(viewport={"width": 1365, "height": 900})
                if cookies:
                    context.add_cookies(cookies)
            page = context.new_page()
            user_agent = page.evaluate('() => navigator.userAgent')
            playinfo = _public_playinfo(context, url)
            streams = playinfo.get('data') or {}
            has_stream = bool(streams.get('durl') or (streams.get('dash') or {}).get('video'))
            response = None
            if not has_stream:
                response = page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            if response is not None and response.status >= 400:
                if response.status != 412:
                    raise BilibiliAccessError(response.status)
                print('[bilibili] HTTP 412; switching to the persistent interactive browser profile')
                context.close()
                context = None
                if browser is not None:
                    browser.close()
                    browser = None
                context, page = _open_persistent_bilibili_page(playwright, browser_path, url)
                user_agent = page.evaluate('() => navigator.userAgent')
            if "passport.bilibili.com" in page.url:
                raise BilibiliAccessError(401)
            # Localized pages can omit __playinfo__ entirely. The embedded
            # initial state contains the selected CID; ask the official player
            # endpoint using this temporary browser context and its cookies.
            initial = page.evaluate("() => window.__INITIAL_STATE__ || {}") or {}
            video_data = initial.get('videoData', {}) if isinstance(initial, dict) else {}
            parts = video_data.get('pages') or []
            selected = (parse_qs(urlsplit(url).query).get('p') or ['1'])[0]
            index = int(selected) - 1 if str(selected).isdecimal() else 0
            cid = (parts[index].get('cid') if 0 <= index < len(parts) else None) or video_data.get('cid')
            bvid = video_data.get('bvid')
            if cid and bvid:
                try:
                    result = context.request.get(
                        'https://api.bilibili.com/x/player/playurl',
                        params={'bvid': bvid, 'cid': cid, 'qn': 64, 'fnval': 16, 'fourk': 1},
                        headers={'Referer': url}, timeout=15_000,
                    )
                    if result.status == 200:
                        candidate = result.json()
                        if candidate.get('code') == 0 and isinstance(candidate.get('data'), dict):
                            playinfo = candidate
                    elif result.status in {401, 403, 412, 429}:
                        raise BilibiliAccessError(result.status)
                except BilibiliAccessError:
                    raise
                except Exception:
                    pass  # The page player below may still have a usable stream.
            if not (playinfo.get('data') or {}).get('dash') and not (playinfo.get('data') or {}).get('durl'):
                try:
                    page.wait_for_function(
                        """() => {
                            const data = window.__playinfo__?.data || {};
                            return (Array.isArray(data.durl) && data.durl.some(x => x?.url || x?.baseUrl))
                                || (Array.isArray(data.dash?.video) && data.dash.video.length > 0
                                    && Array.isArray(data.dash?.audio) && data.dash.audio.length > 0);
                        }""", timeout=8_000,
                    )
                    playinfo = page.evaluate("() => window.__playinfo__") or {}
                except Exception as error:
                    raise RuntimeError(
                        'Chưa lấy được luồng phát công khai của Bilibili. ReupAI đã thử API không cần đăng nhập '
                        'và browser fallback; Bilibili vẫn đang giới hạn yêu cầu. Thử lại sau ít phút; '
                        'chỉ đăng nhập nếu chính video yêu cầu quyền xem. '
                        f'Trạng thái phiên: {session_state}.'
                    ) from error
        finally:
            if context is not None:
                context.close()
            if browser is not None:
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
                part = folder_path / f"part-{index:06d}.mp4"
                _download_stream(
                    item,
                    part,
                    url,
                    names=("url", "baseUrl", "base_url"),
                    user_agent=user_agent,
                )
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
        _download_stream(video or {}, video_file, url, names=("baseUrl", "base_url"), user_agent=user_agent)
        _download_stream(audio or {}, audio_file, url, names=("baseUrl", "base_url"), user_agent=user_agent)
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
