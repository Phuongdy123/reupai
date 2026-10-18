"""Regression coverage for local-only source downloads and duplicate requests."""
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from fastapi.responses import Response

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
import local_engine
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

    def test_library_scan_cache_returns_copies_and_can_be_invalidated(self):
        server.invalidate_library_scan_cache("test")
        self.addCleanup(server.invalidate_library_scan_cache, "test")
        calls = 0

        def loader():
            nonlocal calls
            calls += 1
            return [{"video_id": "one"}]

        first = server._cached_library_scan("test", loader)
        first[0]["video_id"] = "changed"
        second = server._cached_library_scan("test", loader)
        self.assertEqual(calls, 1)
        self.assertEqual(second[0]["video_id"], "one")
        server.invalidate_library_scan_cache("test")
        server._cached_library_scan("test", loader)
        self.assertEqual(calls, 2)

    def test_download_ticket_is_single_use_and_sets_attachment_header(self):
        ticket = "test-download-ticket"
        local_engine._browser_sessions["session"] = {
            "client_origin": "https://www.reupai.cloud",
            "expires_at": time.time() + 60,
        }
        self.addCleanup(local_engine._browser_sessions.pop, "session", None)
        local_engine._media_tickets[ticket] = {
            "session": "session",
            "origin": "https://www.reupai.cloud",
            "path": "/api/files/downloads/example.mp4",
            "download": True,
            "filename": "video test.mp4",
            "expires_at": time.time() + 60,
        }
        self.addCleanup(local_engine._media_tickets.pop, ticket, None)
        with patch.object(local_engine, "_serve_local_file", return_value=Response()):
            response = local_engine.ticket_media(ticket)
        self.assertEqual(
            response.headers["content-disposition"],
            "attachment; filename*=UTF-8''video%20test.mp4",
        )
        self.assertNotIn(ticket, local_engine._media_tickets)

