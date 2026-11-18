"""Normalize supported video/share URLs without dropping locale or episode.

Short-link resolution follows only official source hosts, never arbitrary
redirect destinations. It does not attempt to bypass source access controls.
"""
import hashlib
import html
import ipaddress
import math
import re
from urllib.parse import parse_qs, unquote, urlencode, urljoin, urlsplit, urlunsplit

import requests

BV = r'BV[0-9A-Za-z]{10}'
AV = r'av[0-9]{1,20}'

_BARE_SOURCE_DOMAINS = (
    r'(?:bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com|youtube\.com|youtu\.be|'
    r'tiktok\.com|facebook\.com|fb\.watch|instagram\.com|x\.com|twitter\.com|'
    r'xiaohongshu\.com|xhslink\.com|vimeo\.com|twitch\.tv|dailymotion\.com)'
)

PLATFORM_LABELS = {
    'bilibili': 'Bilibili',
    'douyin': 'Douyin',
    'youtube': 'YouTube',
    'tiktok': 'TikTok',
    'facebook': 'Facebook',
    'instagram': 'Instagram',
    'twitter': 'X / Twitter',
    'xiaohongshu': 'Xiaohongshu',
    'vimeo': 'Vimeo',
    'twitch': 'Twitch',
    'dailymotion': 'Dailymotion',
}

_HOST_PLATFORMS = (
    (('b23.tv', 'bilibili.com'), 'bilibili'),
    (('douyin.com', 'iesdouyin.com'), 'douyin'),
    (('youtube.com', 'youtu.be', 'youtube-nocookie.com'), 'youtube'),
    (('tiktok.com', 'tiktokv.com'), 'tiktok'),
    (('facebook.com', 'fb.com', 'fb.watch'), 'facebook'),
    (('instagram.com', 'instagr.am'), 'instagram'),
    (('twitter.com', 'x.com', 't.co'), 'twitter'),
    (('xiaohongshu.com', 'xhslink.com'), 'xiaohongshu'),
    (('vimeo.com',), 'vimeo'),
    (('twitch.tv',), 'twitch'),
    (('dailymotion.com', 'dai.ly'), 'dailymotion'),
)


def _match_host(host, domains):
    return any(host == domain or host.endswith('.' + domain) for domain in domains)


def is_safe_public_url(value):
    """Return True if value is a public HTTP/HTTPS URL without private/loopback targets."""
    raw = str(value or '').strip()
    if not raw or any(ord(char) < 32 for char in raw):
        return False
    try:
        parsed = urlsplit(raw)
        if parsed.scheme.lower() not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password or parsed.port not in {None, 80, 443}:
            return False
    except ValueError:
        return False
    host = parsed.hostname.lower().rstrip('.')
    if not host:
        return False
    if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal', '.arpa', '.test')):
        return False
    try:
        ip = ipaddress.ip_address(host)
        return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified)
    except ValueError:
        return '.' in host and not host.endswith('.')


def source_platform(value):
    try:
        host = (urlsplit(str(value)).hostname or '').lower()
    except ValueError:
        return 'unknown'
    if _match_host(host, ('b23.tv', 'bilibili.com')):
        return 'bilibili'
    if _match_host(host, ('douyin.com', 'iesdouyin.com')):
        return 'douyin'
    return 'unknown'


def detected_platform(value):
    """Identify known video platforms or 'generic' for safe public HTTP/HTTPS URLs."""
    try:
        host = (urlsplit(str(value)).hostname or '').lower()
    except ValueError:
        return 'unknown'
    for domains, platform in _HOST_PLATFORMS:
        if _match_host(host, domains):
            return platform
    return 'generic' if is_safe_public_url(value) else 'unknown'


def platform_label(platform):
    return PLATFORM_LABELS.get(str(platform or '').lower(), 'nguồn')


def _plain(value, *, allow_generic=False):
    text = html.unescape(str(value or '').strip())
    if not text or len(text) > 8192:
        raise ValueError('Dán một link video hợp lệ, tối đa 8.192 ký tự.')
    if re.fullmatch(BV, text, re.I):
        return 'https://www.bilibili.com/video/' + 'BV' + text[2:] + '/'
    if re.fullmatch(AV, text, re.I):
        return 'https://www.bilibili.com/video/' + text.lower() + '/'
    if re.match(r'https?%3a%2f%2f', text, re.I):
        text = unquote(text)
    markdown = re.fullmatch(r'\[[^\]]*\]\((https?://[^\s]+)\)', text, re.I)
    if markdown:
        return markdown.group(1)
    candidates = re.findall(r'https?://[^\s<>"“”]+', text, re.I)
    candidates = list(dict.fromkeys(item.rstrip('.,，。!！;；)]}》」』') for item in candidates))
    supported = [item for item in candidates if source_platform(item) != 'unknown']
    if len(supported) > 1:
        raise ValueError('Có nhiều link trong nội dung chia sẻ. Hãy dán một link video mỗi lần.')
    if supported:
        return supported[0]
    if allow_generic:
        if len(candidates) > 1:
            raise ValueError('Có nhiều link trong nội dung chia sẻ. Hãy dán một link video mỗi lần.')
        if len(candidates) == 1:
            return candidates[0]
        if re.match(rf'(?:(?:[a-z0-9-]+)\.)?{_BARE_SOURCE_DOMAINS}/', text, re.I):
            return 'https://' + text
    if len(candidates) == 1 and text == candidates[0]:
        return candidates[0]
    if re.match(r'(?:(?:www|m|v)\.)?(?:bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com)/', text, re.I):
        return 'https://' + text
    raise ValueError('Không tìm thấy link video. Có thể dán link hoặc nội dung chia sẻ kèm link.')


def _checked(url):
    if any(ord(char) < 32 for char in url):
        raise ValueError('Link video chứa ký tự không hợp lệ.')
    try:
        parsed = urlsplit(url)
        if parsed.scheme.lower() not in {'http','https'} or not parsed.hostname or parsed.username or parsed.password or parsed.port not in {None,80,443}:
            raise ValueError()
    except ValueError:
        raise ValueError('Link video phải là http/https, không kèm tài khoản hoặc cổng khác.') from None
    return parsed


def _resolve(url):
    for _ in range(5):
        parsed = _checked(url)
        if source_platform(url) == 'unknown':
            raise ValueError('Link rút gọn chuyển tới website không được hỗ trợ.')
        try:
            response = requests.get(url, allow_redirects=False, stream=True, timeout=(5,10))
            try:
                code, location = response.status_code, response.headers.get('Location')
            finally:
                response.close()
        except requests.RequestException:
            raise ValueError('Chưa mở được link rút gọn. Thử lại hoặc sao chép link đầy đủ từ trình duyệt.') from None
        if code in {301,302,303,307,308} and location:
            target = urljoin(url, location)
            target_parts = _checked(target)
            if target_parts.scheme.lower() != 'https' or source_platform(target) == 'unknown':
                raise ValueError('Link rút gọn chuyển tới địa chỉ không an toàn hoặc không được hỗ trợ.')
            if target_parts.hostname not in {'b23.tv','www.b23.tv','v.douyin.com'}:
                return target
            url = target
            continue
        if code >= 400:
            raise ValueError(f'Nguồn trả HTTP {code} khi mở link rút gọn. Dán link đầy đủ đang xem được trên trình duyệt.')
        return url
    raise ValueError('Link rút gọn chuyển hướng quá nhiều lần. Hãy dán link video đầy đủ.')


def resolve_short_url(value):
    """Resolve official Bilibili/Douyin short URLs to their canonical target URL."""
    url = _plain(value)
    parsed = _checked(url)
    if parsed.hostname.lower() in {'b23.tv', 'www.b23.tv', 'v.douyin.com'}:
        return _resolve(url)
    return url


def normalize_source_url(value, *, resolve_short=False, allow_generic=False):
    url = _plain(value, allow_generic=allow_generic)
    parsed = _checked(url)
    platform = source_platform(url)
    if platform == 'unknown':
        if allow_generic:
            if not is_safe_public_url(url):
                raise ValueError('Link nguồn không hợp lệ hoặc không phải địa chỉ công khai.')
            return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, parsed.query, ''))
        raise ValueError('ReupAI hiện hỗ trợ link video Bilibili và Douyin.')
    if parsed.hostname.lower() in {'b23.tv','www.b23.tv','v.douyin.com'}:
        if not resolve_short:
            return urlunsplit(('https',parsed.hostname,parsed.path,parsed.query,''))
        url = _resolve(url)
        parsed = _checked(url)
        platform = source_platform(url)
    query = parse_qs(parsed.query)
    if platform == 'bilibili':
        match = re.search(rf'/video/({BV}|{AV})(?:/|$)', parsed.path, re.I)
        identifier = match.group(1) if match else (query.get('bvid') or [''])[0]
        if not re.fullmatch(rf'{BV}|{AV}', identifier, re.I):
            raise ValueError('Không tìm thấy mã video Bilibili đầy đủ. Link kênh/playlist không phải link một video.')
        identifier = 'BV' + identifier[2:] if identifier[:2].lower() == 'bv' else identifier.lower()
        prefix = parsed.path.split('/video/',1)[0] if match else ''
        if prefix and not re.fullmatch(r'/[a-z]{2}(?:-[a-z]{2})?', prefix, re.I):
            raise ValueError('Đường dẫn video Bilibili không hợp lệ.')
        kept = {}
        for key in ('p','t'):
            item = (query.get(key) or [''])[0]
            try:
                number = float(item)
            except ValueError:
                continue
            if math.isfinite(number) and (key == 'p' and item.isdecimal() and 1 <= number <= 10000 or key == 't' and 0 <= number <= 2592000):
                kept[key] = item
        return urlunsplit(('https', parsed.hostname.lower(), f'{prefix}/video/{identifier}/', urlencode(kept), ''))
    if re.search(r'/note/\d+',parsed.path):
        raise ValueError('Link này là bài ảnh Douyin; hãy chọn link video.')
    match = re.search(r'/(?:share/)?video/(\d{10,25})(?:/|$)', parsed.path)
    identifier = match.group(1) if match else (query.get('modal_id') or query.get('vid') or [''])[0]
    if not re.fullmatch(r'\d{10,25}',identifier):
        raise ValueError('Không tìm thấy mã video Douyin. Hãy dùng link video hoặc link chia sẻ của video.')
    return 'https://www.douyin.com/video/' + identifier


def _safe_generic_video_id(url):
    parsed = urlsplit(str(url or '').strip())
    host = (parsed.hostname or '').lower()
    query = parse_qs(parsed.query)
    if _match_host(host, ('youtube.com', 'youtu.be', 'youtube-nocookie.com')):
        yt_id = ''
        if host == 'youtu.be' or host.endswith('.youtu.be'):
            yt_id = parsed.path.strip('/').split('/')[0]
        elif '/shorts/' in parsed.path or '/live/' in parsed.path or '/embed/' in parsed.path:
            match = re.search(r'/(?:shorts|live|embed)/([A-Za-z0-9_-]{6,32})', parsed.path)
            yt_id = match.group(1) if match else ''
        else:
            yt_id = (query.get('v') or [''])[0]
        if re.fullmatch(r'[A-Za-z0-9_-]{6,32}', yt_id):
            return f'yt_{yt_id}'
    if _match_host(host, ('tiktok.com', 'tiktokv.com')):
        match = re.search(r'/video/(\d{8,30})', parsed.path)
        if match:
            return f'tt_{match.group(1)}'
    canonical = urlunsplit((parsed.scheme.lower() or 'https', host, parsed.path, parsed.query, ''))
    return 'vid_' + hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:16]


def video_identity(url, *, allow_generic=False):
    """Stable library/job key; multipart selections must not reuse part one's file."""
    parsed = urlsplit(url)
    if source_platform(url) == 'bilibili':
        match = re.search(rf'/video/({BV}|{AV})(?:/|$)', parsed.path, re.I)
        if match:
            identifier = match.group(1)
            identifier = 'BV' + identifier[2:] if identifier[:2].lower() == 'bv' else identifier.lower()
            part = (parse_qs(parsed.query).get('p') or ['1'])[0]
            return identifier + (f'_p{int(part)}' if part.isdecimal() and 1 < int(part) <= 10000 else '')
    if source_platform(url) == 'douyin':
        match = re.search(r'/video/(\d{10,25})(?:/|$)', parsed.path)
        if match:
            return match.group(1)
    if allow_generic and is_safe_public_url(url):
        return _safe_generic_video_id(url)
    return None
