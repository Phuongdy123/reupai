import sys
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
