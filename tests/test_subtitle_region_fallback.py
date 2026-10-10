"""Regression coverage for OCR absence, current selections and render layout."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from core import pipeline
from services import final_renderer, subtitle_detector


class SubtitleRegionFallbackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source.mp4"
        self.region_path = self.root / "subtitle_region.json"
        self.preview = self.root / "preview.jpg"
        self.probe = patch.object(pipeline.subprocess, "run")
        self.probe_mock = self.probe.start()
        self.addCleanup(self.probe.stop)
        self.probe_mock.return_value.stdout = "1440,1080"

    def resolve(self, **kwargs):
        return pipeline.resolve_subtitle_region(self.source, self.region_path, self.preview, **kwargs)

    def test_no_ocr_text_continues_with_warning_and_no_blur(self):
        error = subtitle_detector.SubtitleRegionNotFound("no text", "no_text_lines")
        with patch.object(pipeline, "detect_subtitle_region", side_effect=error):
            region = self.resolve()
        self.assertFalse(region["blur_enabled"])
        self.assertEqual(region["detected"]["reason"], "no_text_lines")
        self.assertTrue(region["warnings"])
        self.assertEqual(json.loads(self.region_path.read_text(encoding="utf-8")), region)
        self.assertGreater(region["blur"]["width"], 1000)
        self.assertGreater(region["blur"]["y"], 800)

    def test_actual_ocr_runtime_error_still_fails(self):
        with patch.object(pipeline, "detect_subtitle_region", side_effect=RuntimeError("model load failed")):
            with self.assertRaisesRegex(RuntimeError, "model load failed"):
                self.resolve()

    def test_manual_selection_bypasses_ocr_and_wins_over_preset(self):
        selected = {"x": 100, "y": 620, "width": 1200, "height": 260}
        with patch.object(pipeline, "detect_subtitle_region", side_effect=AssertionError("OCR must not run")):
            region = self.resolve(config={"blur_region": selected, "blur_preset": "bottom"})
        self.assertTrue(region["blur_enabled"])
        self.assertEqual(region["blur"], selected)
        self.assertNotIn("warnings", region)

    def test_changing_selection_overwrites_effective_file_immediately(self):
        first = {"x": 100, "y": 620, "width": 1200, "height": 260}
        second = {"x": 450, "y": 500, "width": 400, "height": 100}
        self.resolve(config={"blur_region": first})
        self.resolve(config={"blur_region": second})
        saved = json.loads(self.region_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["blur"], second)

    def test_auto_does_not_read_previous_manual_effective_region(self):
        self.resolve(config={"blur_region": {"x": 20, "y": 20, "width": 100, "height": 100}})
        expected = {"video": {"width": 1440, "height": 1080}, "blur": {
            "x": 140, "y": 850, "width": 1100, "height": 100}, "blur_enabled": True,
            "subtitle": {"x": 720, "y": 900}, "detected": {"method": "test"}}
        with patch.object(pipeline, "detect_subtitle_region", return_value=expected) as detect:
            self.assertEqual(self.resolve(), expected)
        self.assertEqual(detect.call_args.args[1].name, "subtitle_region_auto.json")

    def test_no_speech_uses_bottom_layout_without_ocr(self):
        with patch.object(pipeline, "detect_subtitle_region", side_effect=AssertionError("OCR must not run")):
            region = self.resolve(no_subtitle=True)
        self.assertFalse(region["blur_enabled"])
        self.assertGreater(region["blur"]["y"], 800)

    def test_fallback_filter_has_no_automatic_blur_but_keeps_custom_interval(self):
        region = pipeline.default_region_without_subtitle(self.source)
        with patch.object(final_renderer, "get_video_geometry", return_value=(1440,1080,1440,1080)), \
             patch.object(final_renderer, "AUTO_BRAND_BLUR_ENABLED", False), \
             patch.object(final_renderer, "LOGO_MODE", "none"), \
             patch.object(final_renderer, "BLUR_INTERVALS", []):
            graph = final_renderer.build_video_filter(region)
            layout = final_renderer.normalize_region(region)
            self.assertNotIn("boxblur=", graph)
            self.assertGreater(layout["subtitle"]["y"], 800)
            self.assertLessEqual(abs(layout["subtitle"]["x"] - 720), 1)
            with patch.object(final_renderer, "BLUR_INTERVALS", [{"x":100,"y":100,"width":200,
                    "height":80,"start":1,"end":3}]):
                graph = final_renderer.build_video_filter(region)
            self.assertIn("crop=200:80:100:100", graph)
            self.assertIn("between(t,1.0,3.0)", graph)


if __name__ == "__main__":
    unittest.main()
