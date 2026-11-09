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
        self.page.evaluate.return_value = {'data': {'durl': [{'url':'https://cdn.example.test/media'}]}}
        self.browser = MagicMock(); self.browser.new_page.return_value = self.page
        manager = MagicMock(); manager.__enter__.return_value.chromium.launch.return_value = self.browser
        self.addCleanup(patch.stopall)
        patch('playwright.sync_api.sync_playwright', return_value=manager).start()
        patch.object(source, '_browser_executable', return_value='fixture-browser').start()
        patch.object(source, 'ensure_download_space').start()

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
        def transfer(url,destination,referer):
            self.assertEqual(destination.parent.parent,self.output.parent)
            destination.write_bytes(b'v'*2048)
        with patch.object(source,'_download',side_effect=transfer):
            result=source.download_video(self.page.url,self.output)
        self.assertEqual(result,self.output);self.assertEqual(result.stat().st_size,2048)
        self.assertEqual(list(self.output.parent.iterdir()),[self.output])

    def test_transfer_failure_keeps_existing_source_and_cleans_staging(self):
        self.output.parent.mkdir();self.output.write_bytes(b'previous-good-video')
        def transfer(url,destination,referer):
            destination.write_bytes(b'partial');raise OSError('connection interrupted')
        with patch.object(source,'_download',side_effect=transfer), self.assertRaisesRegex(OSError,'interrupted'):
            source.download_video(self.page.url,self.output)
        self.assertEqual(self.output.read_bytes(),b'previous-good-video')
        self.assertEqual(list(self.output.parent.iterdir()),[self.output])


if __name__=='__main__':unittest.main()
