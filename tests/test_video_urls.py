import sys
from pathlib import Path
from unittest.mock import Mock, patch

import unittest
from functools import wraps

def cases(names, values):
    def decorate(function):
        @wraps(function)
        def wrapped(self):
            for value in values:
                arguments = value if isinstance(value, tuple) else (value,)
                with self.subTest(value=value):
                    function(self, *arguments)
        return wrapped
    return decorate

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from services.video_urls import normalize_source_url, source_platform, video_identity


class VideoUrlTests(unittest.TestCase):
    @cases('value,expected', [
        ('BV1S7446fEFw', 'https://www.bilibili.com/video/BV1S7446fEFw/'),
        ('bilibili.com/vi/video/BV1S7446fEFw/?trackid=abc&spm_id_from=x', 'https://bilibili.com/vi/video/BV1S7446fEFw/'),
        ('https://m.bilibili.com/video/BV1S7446fEFw?p=2&t=15&share_source=copy#reply', 'https://m.bilibili.com/video/BV1S7446fEFw/?p=2&t=15'),
        ('[Xem video](https://www.bilibili.com/vi/video/BV1S7446fEFw/?trackid=x)', 'https://www.bilibili.com/vi/video/BV1S7446fEFw/'),
        ('Video hay https://www.bilibili.com/video/BV1S7446fEFw/。', 'https://www.bilibili.com/video/BV1S7446fEFw/'),
        ('https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1S7446fEFw%2F', 'https://www.bilibili.com/video/BV1S7446fEFw/'),
        ('AV170001', 'https://www.bilibili.com/video/av170001/'),
        ('https://www.iesdouyin.com/share/video/7451234567890123456/?a=1', 'https://www.douyin.com/video/7451234567890123456'),
        ('https://www.douyin.com/?modal_id=7451234567890123456&from=x', 'https://www.douyin.com/video/7451234567890123456'),
    ])
    def test_supported_forms(self, value, expected):
        assert normalize_source_url(value) == expected
        assert normalize_source_url(expected) == expected


    @cases('value', [
        'https://bilibili.com.evil.test/video/BV1S7446fEFw/',
        'https://evil.test/?url=bilibili.com/video/BV1S7446fEFw',
        'https://user:pass@www.bilibili.com/video/BV1S7446fEFw/',
        'https://www.bilibili.com:9090/video/BV1S7446fEFw/',
        'https://space.bilibili.com/1234', 'https://www.douyin.com/note/7451234567890123456',
        'BV1S7446fE', 'https://www.bilibili.com/video/BV1S7446fEFwx/',
        'https://b23.tv/one https://b23.tv/two',
    ])
    def test_reject_ambiguous_or_invalid(self, value):
        with self.assertRaises(ValueError):
            normalize_source_url(value)


    def test_episode_identity_avoids_reusing_first_part(self):
        base = 'https://www.bilibili.com/vi/video/BV1S7446fEFw/'
        assert video_identity(base) == video_identity(base + '?p=1') == 'BV1S7446fEFw'
        assert video_identity(base + '?p=2') == 'BV1S7446fEFw_p2'
        assert normalize_source_url(base + '?p=NaN&t=inf') == base
        assert source_platform('https://evil.test/?url=bilibili.com') == 'unknown'


    def test_short_share_resolves_and_closes_response(self):
        response = Mock(status_code=302, headers={'Location': 'https://www.bilibili.com/vi/video/BV1S7446fEFw/?spm=x&p=2'})
        with patch('services.video_urls.requests.get', return_value=response) as get:
            result = normalize_source_url('分享 https://b23.tv/abc 复制打开', resolve_short=True)
        assert result == 'https://www.bilibili.com/vi/video/BV1S7446fEFw/?p=2'
        assert get.call_args.kwargs['allow_redirects'] is False
        response.close.assert_called_once()


    def test_external_redirect_is_never_followed(self):
        response = Mock(status_code=302, headers={'Location': 'https://127.0.0.1/private'})
        with patch('services.video_urls.requests.get', return_value=response) as get:
            with self.assertRaises(ValueError):
                normalize_source_url('https://b23.tv/abc', resolve_short=True)
        assert get.call_count == 1
        response.close.assert_called_once()


    def test_library_preserves_original_locale_and_part(self):
        from services.library_api import canonical_video_url, parse_video_id
        url = 'https://www.bilibili.com/vi/video/BV1S7446fEFw/?p=2&trackid=x'
        assert parse_video_id('bilibili', url) == 'BV1S7446fEFw_p2'
        assert canonical_video_url('bilibili', 'BV1S7446fEFw_p2', url) == url.split('&trackid')[0]

    def test_generic_public_urls_and_ssrf_guards(self):
        from services.video_urls import detected_platform, is_safe_public_url
        assert detected_platform('https://www.youtube.com/watch?v=dQw4w9WgXcQ') == 'youtube'
        assert detected_platform('https://vt.tiktok.com/ZSYabc123/') == 'tiktok'
        assert detected_platform('https://www.facebook.com/watch/?v=123456') == 'facebook'
        assert detected_platform('https://vimeo.com/123456') == 'vimeo'
        assert detected_platform('https://example-video.org/watch/1') == 'generic'
        assert detected_platform('http://127.0.0.1:8080/internal') == 'unknown'
        assert detected_platform('https://bilibili.com.evil.test/video/BV1S7446fEFw/') == 'unknown'
        assert is_safe_public_url('https://localhost/admin') is False
        assert is_safe_public_url('http://192.168.1.10/video.mp4') is False
        assert normalize_source_url('Xem https://youtu.be/dQw4w9WgXcQ nha', allow_generic=True) == 'https://youtu.be/dQw4w9WgXcQ'
        assert video_identity('https://youtu.be/dQw4w9WgXcQ', allow_generic=True) == 'yt_dQw4w9WgXcQ'
        assert video_identity('https://www.tiktok.com/@user/video/732109876543210', allow_generic=True) == 'tt_732109876543210'
        assert normalize_source_url('vimeo.com/123456', allow_generic=True) == 'https://vimeo.com/123456'
        assert video_identity('https://vimeo.com/123456', allow_generic=True).startswith('vid_')
        with self.assertRaises(ValueError):
            normalize_source_url('http://127.0.0.1/video.mp4', allow_generic=True)
