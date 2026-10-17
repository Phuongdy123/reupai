"""Regression coverage for local-only source downloads and duplicate requests."""
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from web import server


class DownloadApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_local_only_existing_source_returns_metadata_not_media_file(self):
        source = self.root / "source.mp4"
        source.write_bytes(b"video")
        request = server.DownloadRequest(
            video_id="BV1F3RxBVE4Q",
            url="https://www.bilibili.com/video/BV1F3RxBVE4Q",
        )
        with patch.object(server, "DOWNLOAD_ROOT", self.root), \
             patch.object(server, "find_valid_downloaded_video", return_value=source), \
             patch.object(server, "register_downloaded_source"):
            result = server.api_download(request, local_only=True)
        self.assertEqual(
            result,
            {
                "ok": True,
                "video_id": "BV1F3RxBVE4Q",
                "downloaded": False,
                "already_downloaded": True,
            },
        )

    def test_duplicate_video_lock_serializes_only_the_same_source(self):
        barrier = threading.Barrier(6)
        active = 0
        maximum = 0
        state_lock = threading.Lock()

        def acquire():
            nonlocal active, maximum
            barrier.wait()
            with server.download_video_lock("BV1F3RxBVE4Q"):
                with state_lock:
                    active += 1
                    maximum = max(maximum, active)
                time.sleep(0.01)
                with state_lock:
                    active -= 1

        threads = [threading.Thread(target=acquire) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(maximum, 1)
        self.assertFalse(server.DOWNLOAD_VIDEO_LOCKS)

