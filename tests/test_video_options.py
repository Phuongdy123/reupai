"""Smoke tests for language selection and rendered subtitle themes."""

from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services import final_renderer, transcriber


class VideoOptionsTests(unittest.TestCase):
    def test_whisper_receives_selected_language(self):
        with patch.object(transcriber, "_chunkable_wav_duration", return_value=None), patch.object(
            transcriber, "_transcribe_once", return_value=([], SimpleNamespace(language="ja", language_probability=1, duration=1))
        ) as run:
            transcriber.transcribe("unused.wav", language="ja")
            self.assertEqual(run.call_args.args, ("unused.wav", "ja"))

    def test_auto_language_leaves_detection_to_whisper(self):
        with patch.object(transcriber, "_chunkable_wav_duration", return_value=None), patch.object(
            transcriber, "_transcribe_once", return_value=([], SimpleNamespace(language="vi", language_probability=1, duration=1))
        ) as run:
            transcriber.transcribe("unused.wav", language=None)
            self.assertEqual(run.call_args.args, ("unused.wav", None))

    def test_subtitle_theme_changes_ass_style(self):
        region = {"video": {"width": 1080, "height": 1920}, "blur": {"x": 50, "y": 1500, "width": 980, "height": 180}, "subtitle": {"x": 540, "y": 1580}, "blur_enabled": True}
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "sub.srt"
            output = Path(folder) / "sub.ass"
            source.write_text("1\n00:00:00,000 --> 00:00:02,000\nXin chào\n", encoding="utf-8")
            with patch.object(final_renderer, "SRT_PATH", str(source)), patch.object(final_renderer, "ASS_PATH", str(output)), patch.object(final_renderer, "SUBTITLE_STYLE", "box"):
                final_renderer.create_ass(region)
            self.assertIn("&H99101010", output.read_text(encoding="utf-8-sig"))
            self.assertIn("Dialogue: 0", output.read_text(encoding="utf-8-sig"))


if __name__ == "__main__":
    unittest.main()
