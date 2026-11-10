"""Download failure scenarios with fixture browser/media; never contact Bilibili."""
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from services import bilibili_browser as source


class BrowserFailureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name) / 'job' / 'source.mp4'
        self.page = MagicMock(); self.page.url = 'https://www.bilibili.com/video/fixture'
        self.page.goto.return_value = SimpleNamespace(status=200)
        self.page.evaluate.side_effect = lambda expression: 'FixtureBrowser/1.0' if 'navigator.userAgent' in expression else {'data': {'durl': [{'url':'https://cdn.example.test/media'}]}}
        self.browser = MagicMock(); self.browser.new_context.return_value.new_page.return_value = self.page
        manager = MagicMock(); manager.__enter__.return_value.chromium.launch.return_value = self.browser
        self.addCleanup(patch.stopall)
        patch('playwright.sync_api.sync_playwright', return_value=manager).start()
        patch.object(source, '_browser_executable', return_value='fixture-browser').start()
        patch.object(source, 'ensure_download_space').start()
        self.cookies = patch.object(source, '_bilibili_cookies', return_value=([], 'empty')).start()

    def test_412_429_and_deleted_videos_close_browser_without_attempting_stream_transfer(self):
        with patch.object(source, '_download') as transfer:
            for status in (401,403,404,410,412,429):
                self.page.goto.return_value.status = status
                with self.subTest(status=status), self.assertRaises(source.BilibiliAccessError) as caught:
                    source.download_video(self.page.url,self.output)
                self.assertEqual(caught.exception.status,status)
            transfer.assert_not_called()
        self.assertEqual(self.browser.close.call_count,6)

    def test_login_redirect_requests_user_action_and_closes_browser(self):
        self.page.url='https://passport.bilibili.com/login'
        with self.assertRaises(source.BilibiliAccessError) as caught:
            source.download_video(self.page.url,self.output)
        self.assertEqual(caught.exception.status,401);self.browser.close.assert_called_once()

    def test_temporary_media_uses_job_volume_and_success_replaces_source_atomically(self):
        def transfer(url,destination,referer,**kwargs):
            self.assertEqual(kwargs['user_agent'],'FixtureBrowser/1.0')
            self.assertEqual(destination.parent.parent,self.output.parent)
            destination.write_bytes(b'v'*2048)
        with patch.object(source,'_download',side_effect=transfer):
            result=source.download_video(self.page.url,self.output)
        self.assertEqual(result,self.output);self.assertEqual(result.stat().st_size,2048)
        self.assertEqual(list(self.output.parent.iterdir()),[self.output])

    def test_localized_page_uses_official_player_api_without_waiting_for_playinfo(self):
        self.page.evaluate.side_effect = lambda expression: (
            'FixtureBrowser/1.0' if 'navigator.userAgent' in expression else
            {'videoData': {'bvid': 'BV1S7446fEFw', 'cid': 100,
                           'pages': [{'cid': 100}, {'cid': 200}]}} if '__INITIAL_STATE__' in expression else {}
        )
        api = self.browser.new_context.return_value.request.get.return_value
        api.status = 200
        api.json.return_value = {'code': 0, 'data': {'durl': [{'url': 'https://cdn.example.test/media'}]}}
        def transfer(url, destination, referer, **kwargs):
            destination.write_bytes(b'v' * 2048)
        with patch.object(source, '_download', side_effect=transfer):
            result = source.download_video('https://www.bilibili.com/vi/video/BV1S7446fEFw/?p=2', self.output)
        self.assertEqual(result, self.output)
        self.assertEqual(api.json.call_count, 1)
        self.assertEqual(self.browser.new_context.return_value.request.get.call_args.kwargs['params']['cid'], 200)
        self.page.wait_for_function.assert_not_called()

    def test_transfer_failure_keeps_existing_source_and_cleans_staging(self):
        self.output.parent.mkdir();self.output.write_bytes(b'previous-good-video')
        def transfer(url,destination,referer,**kwargs):
            destination.write_bytes(b'partial');raise OSError('connection interrupted')
        with patch.object(source,'_download',side_effect=transfer), self.assertRaisesRegex(OSError,'interrupted'):
            source.download_video(self.page.url,self.output)
        self.assertEqual(self.output.read_bytes(),b'previous-good-video')
        self.assertEqual(list(self.output.parent.iterdir()),[self.output])

    def test_existing_bilibili_session_is_added_before_opening_video(self):
        cookie={'name':'fixture','value':'fixture-only','domain':'.bilibili.com','path':'/'}
        self.cookies.return_value=([cookie],'available')
        order=[]
        self.browser.new_context.return_value.add_cookies.side_effect=lambda values:order.append('cookies')
        self.page.goto.side_effect=lambda *a,**kw:(order.append('goto') or SimpleNamespace(status=412))
        with self.assertRaises(source.BilibiliAccessError):source.download_video(self.page.url,self.output)
        self.assertEqual(order,['cookies','goto'])
        self.browser.new_context.return_value.add_cookies.assert_called_once_with([cookie])

    def test_unreadable_session_is_not_reported_as_an_ip_ban(self):
        self.cookies.return_value=([],'unavailable');self.page.goto.return_value.status=412
        with self.assertRaisesRegex(RuntimeError,'chưa đọc được phiên trình duyệt'):
            source.download_video(self.page.url,self.output)


class BrowserCookieTests(unittest.TestCase):
    def cookie(self, domain, expires=None):
        return SimpleNamespace(domain=domain,name='fixture',value='fixture-secret',path='/',secure=True,expires=expires,_rest={'HttpOnly':None})

    def test_only_live_bilibili_cookies_are_imported_without_exporting_other_sites(self):
        with patch('yt_dlp.cookies.extract_cookies_from_browser',return_value=[self.cookie('.bilibili.com'),self.cookie('passport.bilibili.com'),self.cookie('evilbilibili.com'),self.cookie('google.com'),self.cookie('.bilibili.com',1)]),patch.dict(source.os.environ,{'REUP_COOKIE_BROWSER':'chrome:Profile 1'}):
            cookies,state=source._bilibili_cookies()
        self.assertEqual(state,'available');self.assertEqual(len(cookies),2)
        self.assertTrue(all(cookie['httpOnly'] for cookie in cookies))

    def test_cookie_decryption_error_is_actionable_without_exposing_raw_error(self):
        with patch('yt_dlp.cookies.extract_cookies_from_browser',side_effect=RuntimeError('fixture-secret decryption failed')):
            cookies,state=source._bilibili_cookies()
        self.assertEqual((cookies,state),([],'unavailable'))


if __name__=='__main__':unittest.main()
