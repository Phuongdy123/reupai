import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services.reviewed_subtitles import reviewed_translation_lines


class ReviewedTranslationTests(unittest.TestCase):
    def test_approved_translation_keeps_edited_text_and_timing(self):
        cues = [{"start": 1.23, "end": 2.45, "text": "你好", "translated_text": "Xin chào, câu đã sửa!"}]
        self.assertEqual(reviewed_translation_lines(cues), [
            {"start": 1.23, "end": 2.45, "text": "Xin chào, câu đã sửa!"},
        ])

    def test_old_source_only_transcripts_still_use_translation(self):
        self.assertIsNone(reviewed_translation_lines([{"start": 0, "end": 1, "text": "你好"}]))
        self.assertIsNone(reviewed_translation_lines([]))

    def test_partial_translation_cannot_silently_overwrite_reviewed_cues(self):
        cues = [
            {"start": 0, "end": 1, "translated_text": "Xin chào"},
            {"start": 1, "end": 2, "text": "你好"},
        ]
        with self.assertRaisesRegex(ValueError, "để trống"):
            reviewed_translation_lines(cues)

    def test_invalid_or_nonfinite_timing_is_rejected(self):
        for start, end in [(2, 1), (-1, 2), (0, float("nan")), (0, float("inf"))]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                reviewed_translation_lines([{"start": start, "end": end, "translated_text": "Xin chào"}])

    def test_pipeline_exports_approved_translation_without_recognition_or_gemini(self):
        from core import pipeline as runner

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "source.mp4"
            source.write_bytes(b"fixture source; media work is mocked")
            with patch.object(runner, "get_jobs_dir", return_value=root), \
                 patch.object(runner, "get_source_video", return_value=source), \
                 patch.object(runner, "require_command"), \
                 patch.object(runner, "extract_audio"), \
                 patch.object(runner, "check_processing_storage"), \
                 patch.object(runner, "transcribe_audio", side_effect=AssertionError("must reuse recognized cues")), \
                 patch.object(runner, "translate_srt", side_effect=AssertionError("must preserve the approved translation")):
                output = runner.pipeline("https://www.bilibili.com/video/BV1kU4v66Ef5/", mode="subtitle", config={
                    "output_format": "srt", "manual_transcript": [
                        {"start": 1.23, "end": 2.45, "text": "你好", "translated_text": "Xin chào, bản dịch tôi đã sửa!"},
                    ],
                })
            exported = output.read_text(encoding="utf-8")
            self.assertIn("Xin chào, bản dịch tôi đã sửa!", exported)
            self.assertIn("00:00:01,230 --> 00:00:02,450", exported)
            self.assertNotIn("你好", exported)


if __name__ == "__main__":
    unittest.main()
