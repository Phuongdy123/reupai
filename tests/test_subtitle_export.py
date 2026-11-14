import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services.subtitle_export import export_subtitle_file


class SubtitleExportTests(unittest.TestCase):
    def test_standalone_export_keeps_timing_and_unicode_without_render(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "vietnamese.srt"
            text = "1\n00:00:01,000 --> 00:00:03,500\nXin chào Việt Nam!\n\n"
            source.write_text(text, encoding="utf-8-sig")
            output = export_subtitle_file(source, root)
            self.assertEqual(output.name, "final_sub.srt")
            self.assertIn("00:00:03,500", output.read_text(encoding="utf-8"))
            self.assertIn("Việt Nam!", output.read_text(encoding="utf-8"))
            self.assertFalse(list(root.glob("*.mp4")))
            self.assertFalse(list(root.glob("*.tmp")))

    def test_empty_recognition_does_not_publish_a_successful_empty_srt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "vietnamese.srt"
            source.write_text("", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "Chưa nhận diện"):
                export_subtitle_file(source, root)
            self.assertFalse((root / "final_sub.srt").exists())


if __name__ == "__main__":
    unittest.main()
