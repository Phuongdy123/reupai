"""Normalize supported video/share URLs without dropping locale or episode.

Short-link resolution follows only official source hosts, never arbitrary
redirect destinations. It does not attempt to bypass source access controls.
"""
import html
import math
import re
from urllib.parse import parse_qs, unquote, urlencode, urljoin, urlsplit, urlunsplit

import requests

BV = r'BV[0-9A-Za-z]{10}'
AV = r'av[0-9]{1,20}'


def source_platform(value):
    try:
        host = (urlsplit(str(value)).hostname or '').lower()
    except ValueError:
        return 'unknown'
    if host == 'b23.tv' or host.endswith('.b23.tv') or host == 'bilibili.com' or host.endswith('.bilibili.com'):
        return 'bilibili'
    if host == 'douyin.com' or host.endswith('.douyin.com') or host == 'iesdouyin.com' or host.endswith('.iesdouyin.com'):
        return 'douyin'
    return 'unknown'


def _plain(value):
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


def normalize_source_url(value, *, resolve_short=False, allow_generic=False):
    url = _plain(value)
    parsed = _checked(url)
    platform = source_platform(url)
    if platform == 'unknown':
        if allow_generic:
            return url
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


def video_identity(url):
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
    return None
