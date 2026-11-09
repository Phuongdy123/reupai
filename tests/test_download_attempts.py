"""Do not repeat identical extractor commands before browser fallback."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from core import pipeline


class DownloadAttemptTests(unittest.TestCase):
    def test_duplicate_anonymous_attempt_is_skipped_but_cookie_fallback_is_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            output=Path(root)/'source.mp4'
            def downloaded(url,path):path.write_bytes(b'v'*2048);return path
            with patch.object(pipeline,'detect_platform',return_value='bilibili'), \
                 patch.object(pipeline,'find_source_video',return_value=None), \
                 patch.object(pipeline,'run',side_effect=subprocess.CalledProcessError(1,['fixture'])) as run, \
                 patch('services.bilibili_browser.download_video',side_effect=downloaded) as browser:
                result=pipeline.download_video('https://www.bilibili.com/video/fixture',Path(root))
            self.assertEqual(result,output)
            self.assertEqual(run.call_count,2)
            self.assertNotIn('--cookies-from-browser',run.call_args_list[0].args[0])
            self.assertIn('--cookies-from-browser',run.call_args_list[1].args[0])
            browser.assert_called_once()


if __name__=='__main__':unittest.main()
