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

    def test_long_cue_keeps_fixed_font_size_and_paginates_sequentially(self):
        region = {
            "video": {"width": 1920, "height": 1080},
            "blur": {"x": 0, "y": 820, "width": 1920, "height": 140},
            "subtitle": {"x": 960, "y": 895},
            "blur_enabled": True,
        }
        long_text = (
            "Nhưng đó là sai lầm. Giữa những người yêu nhau luôn tồn tại một cán cân "
            "quyền lực rõ rệt. Kẻ phục tùng và người được phục tùng, kẻ bị thao túng "
            "và người thao túng, đó là cuộc chiến giữa kẻ thắng và người thua."
        )
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "sub.srt"
            output = Path(folder) / "sub.ass"
            source.write_text(
                f"1\n00:00:01,000 --> 00:00:07,000\n{long_text}\n",
                encoding="utf-8",
            )
            with patch.object(final_renderer, "SRT_PATH", str(source)), \
                 patch.object(final_renderer, "ASS_PATH", str(output)), \
                 patch.object(final_renderer, "FONT_SIZE_OVERRIDE", None):
                final_renderer.create_ass(region)
            ass_text = output.read_text(encoding="utf-8-sig")
            dialogues = [line for line in ass_text.splitlines() if line.startswith("Dialogue:")]
            self.assertGreaterEqual(len(dialogues), 3)
            # Fixed base font size across every chunk (no shrinking down to fit).
            expected_fs = f"\\fs{final_renderer.base_font_size(1920, 1080, 1920, 140)}"
            for row in dialogues:
                self.assertIn(expected_fs, row)
            # Contiguous timestamps from 0:00:01.00 to 0:00:07.00 with zero gap/overlap.
            times = [row.split(",")[1:3] for row in dialogues]
            self.assertEqual(times[0][0], "0:00:01.00")
            self.assertEqual(times[-1][1], "0:00:07.00")
            for idx in range(len(times) - 1):
                self.assertEqual(times[idx][1], times[idx + 1][0])

    def test_tight_cue_speeds_up_pages_without_dropping_words(self):
        chunks = final_renderer.paginate_subtitle_cue(
            "Một câu dịch rất dài với rất nhiều từ cần hiển thị nhanh trong khoảng thời gian ngắn để không bị chậm nhịp thoại tiếp theo",
            1.0,
            3.0,
            font_size=54,
            max_width=900.0,
            blur_height=180.0,
        )
        self.assertGreaterEqual(len(chunks), 2)
        self.assertAlmostEqual(chunks[0]["start"], 1.0, places=2)
        self.assertAlmostEqual(chunks[-1]["end"], 3.0, places=2)
        for chunk in chunks:
            self.assertLess(chunk["start"], chunk["end"])
            self.assertLessEqual(len(chunk["lines"]), 2)
        reconstructed = " ".join(" ".join(chunk["lines"]) for chunk in chunks)
        self.assertIn("tiếp theo", reconstructed)


if __name__ == "__main__":
    unittest.main()
