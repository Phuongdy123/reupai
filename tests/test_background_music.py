"""Regression coverage for remote background music preparation."""
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from core import pipeline


class BackgroundMusicTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.job_dir = Path(self.temp.name)

    def test_accepts_public_http_urls_only(self):
        self.assertEqual(
            pipeline.normalize_music_url(" https://example.com/music?id=1 "),
            "https://example.com/music?id=1",
        )
        for value in ("file:///C:/song.mp3", "ftp://example.com/song.mp3", "not a url"):
            with self.assertRaises(ValueError):
                pipeline.normalize_music_url(value)

    def test_reuses_a_valid_cached_track_without_downloading(self):
        url = "https://example.com/music"
        key = pipeline.stable_fingerprint({"url": url})[:16]
        cached = self.job_dir / f"background_music_{key}.m4a"
        cached.write_bytes(b"audio")
        with patch.object(pipeline.subprocess, "run") as run:
            actual = pipeline.resolve_music_url_track(self.job_dir, url, lambda path: path == cached)
        self.assertEqual(actual, cached)
        run.assert_not_called()

    def test_downloads_and_returns_a_valid_new_track(self):
        url = "https://example.com/new-music"

        def write_downloaded_track(command, **_kwargs):
            template = Path(command[command.index("-o") + 1])
            Path(str(template).replace("%(ext)s", "m4a")).write_bytes(b"audio")
            return SimpleNamespace(returncode=0, stdout="done", stderr="")

        with patch.object(pipeline.subprocess, "run", side_effect=write_downloaded_track) as run:
            actual = pipeline.resolve_music_url_track(self.job_dir, url, lambda path: path.is_file())

        self.assertTrue(actual.is_file())
        self.assertEqual(actual.suffix, ".m4a")
        command = run.call_args.args[0]
        self.assertIn("yt_dlp", command)
        self.assertIn("--audio-format", command)

    def test_youtube_failure_retries_with_browser_cookies(self):
        url = "https://www.youtube.com/watch?v=public-track"

        def first_failure_then_download(command, **_kwargs):
            if "--cookies-from-browser" not in command:
                return SimpleNamespace(returncode=1, stdout="", stderr="Sign in to confirm")
            template = Path(command[command.index("-o") + 1])
            Path(str(template).replace("%(ext)s", "m4a")).write_bytes(b"audio")
            return SimpleNamespace(returncode=0, stdout="done", stderr="")

        with patch.object(
            pipeline.subprocess,
            "run",
            side_effect=first_failure_then_download,
        ) as run:
            actual = pipeline.resolve_music_url_track(self.job_dir, url, lambda path: path.is_file())

        self.assertTrue(actual.is_file())
        self.assertEqual(run.call_count, 2)
        retry_command = run.call_args_list[1].args[0]
        self.assertIn("--cookies-from-browser", retry_command)
        self.assertIn("chrome", retry_command)

    def test_tiktok_failure_retries_with_browser_cookies(self):
        url = "https://vt.tiktok.com/ZStest/"

        def first_failure_then_download(command, **_kwargs):
            if "--cookies-from-browser" not in command:
                return SimpleNamespace(returncode=1, stdout="", stderr="verification required")
            template = Path(command[command.index("-o") + 1])
            Path(str(template).replace("%(ext)s", "m4a")).write_bytes(b"audio")
            return SimpleNamespace(returncode=0, stdout="done", stderr="")

        with patch.object(
            pipeline.subprocess,
            "run",
            side_effect=first_failure_then_download,
        ) as run:
            actual = pipeline.resolve_music_url_track(self.job_dir, url, lambda path: path.is_file())

        self.assertTrue(actual.is_file())
        self.assertEqual(run.call_count, 2)
        self.assertIn("--cookies-from-browser", run.call_args_list[1].args[0])

    def test_youtube_host_detection_accepts_common_links(self):
        for url in (
            "https://youtu.be/example",
            "https://www.youtube.com/watch?v=example",
            "https://music.youtube.com/watch?v=example",
        ):
            self.assertTrue(pipeline.is_youtube_music_url(url))
        self.assertFalse(pipeline.is_youtube_music_url("https://example.com/audio"))

    def test_tiktok_host_detection_accepts_share_links(self):
        for url in (
            "https://www.tiktok.com/@creator/video/123",
            "https://m.tiktok.com/v/123.html",
            "https://vm.tiktok.com/ZStest/",
            "https://vt.tiktok.com/ZStest/",
        ):
            self.assertTrue(pipeline.is_tiktok_music_url(url))
            self.assertTrue(pipeline.supports_browser_cookie_music_retry(url))
        self.assertFalse(pipeline.is_tiktok_music_url("https://example.com/audio"))

    def test_music_volume_accepts_silence_and_up_to_200_percent(self):
        self.assertEqual(pipeline.normalize_music_volume(0), 0.0)
        self.assertEqual(pipeline.normalize_music_volume("1.5"), 1.5)
        self.assertEqual(pipeline.normalize_music_volume(9), 2.0)
        self.assertEqual(pipeline.normalize_music_volume(-3), 0.0)
        self.assertEqual(pipeline.normalize_music_volume("invalid"), 0.25)

    def test_downloaded_track_must_contain_valid_audio(self):
        url = "https://example.com/music"
        with patch.object(
            pipeline.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=0, stdout="", stderr=""),
        ):
            with self.assertRaisesRegex(RuntimeError, "không tìm thấy stream âm thanh"):
                pipeline.resolve_music_url_track(self.job_dir, url, lambda _path: False)

    def test_reports_a_failed_remote_download(self):
        with patch.object(
            pipeline.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=1, stdout="", stderr="private video"),
        ):
            with self.assertRaisesRegex(RuntimeError, "Không tải được nhạc"):
                pipeline.resolve_music_url_track(
                    self.job_dir,
                    "https://example.com/private",
                    lambda _path: False,
                )


if __name__ == "__main__":
    unittest.main()
