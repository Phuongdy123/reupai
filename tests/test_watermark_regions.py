import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from services import watermark_detector, final_renderer, subtitle_detector
import numpy as np


def box(x=810, y=18, width=170, height=28):
    return {'x1': x, 'y1': y, 'x2': x + width, 'y2': y + height}


class WatermarkRegionTests(unittest.TestCase):
    def test_valid_watermark_is_not_dropped_by_subtitle_crop_height_rules(self):
        polygon = np.array([[800, 15], [930, 15], [930, 58], [800, 58]])
        class Detector:
            def predict(self, _image):
                return [object()]
        with patch.object(subtitle_detector, 'get_detector', return_value=Detector()), patch.object(subtitle_detector, 'parse_result', return_value=([polygon], [.9])):
            found = watermark_detector._corner_text_boxes(np.zeros((238, 1000, 3), dtype=np.uint8))
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['y2'] - found[0]['y1'], 43)

    def detect(self, observations, width=1000, height=600):
        return watermark_detector.persistent_corner_regions(observations, len(observations), width, height)

    def test_stable_corner_text_is_tightly_bounded(self):
        result = self.detect([(i, [box(x=810 + i % 2)]) for i in range(6)])
        self.assertEqual(len(result), 1)
        self.assertLess(result[0]['height'], 40)
        self.assertLess(result[0]['width'], 185)
        self.assertLessEqual(result[0]['x'], 810)
        self.assertGreaterEqual(result[0]['x'] + result[0]['width'], 981)

    def test_empty_or_transient_text_does_not_create_a_blanket_region(self):
        self.assertEqual(self.detect([(i, []) for i in range(6)]), [])
        self.assertEqual(self.detect([(i, [box()] if i < 2 else []) for i in range(6)]), [])

    def test_duplicate_boxes_in_one_frame_cannot_fake_persistence(self):
        self.assertEqual(self.detect([(i, [box()] * 5 if i == 0 else []) for i in range(6)]), [])

    def test_center_titles_subtitles_and_large_patches_are_rejected(self):
        boxes = [box(x=380), box(y=500), box(height=100)]
        self.assertEqual(self.detect([(i, boxes) for i in range(6)]), [])

    def test_two_corner_rows_stay_separate_and_missing_corner_stays_clear(self):
        result = self.detect([(i, [box(), box(y=65)]) for i in range(6)])
        self.assertEqual(len(result), 2)
        self.assertTrue(all(item['x'] > 800 and item['height'] < 40 for item in result))

    def test_scaled_renderer_boxes_cover_measurement_and_are_even(self):
        measured = {'video': {'width': 1000, 'height': 600}, 'boxes': [{'x': 807, 'y': 15, 'width': 177, 'height': 35}]}
        with patch.object(final_renderer, 'AUTO_BRAND_BLUR_ENABLED', True), patch.object(final_renderer, 'detect_source_platform', return_value='bilibili'), patch.object(watermark_detector, 'detect_watermark_regions', return_value=measured):
            result = final_renderer.get_bilibili_text_blur_boxes(500, 300)
        self.assertEqual(len(result), 1)
        self.assertTrue(all(value % 2 == 0 for value in result[0].values()))
        self.assertLessEqual(result[0]['x'], 807 / 2)
        self.assertGreaterEqual(result[0]['x'] + result[0]['width'], 984 / 2)

    def test_detector_failure_keeps_frame_clear(self):
        with patch.object(final_renderer, 'AUTO_BRAND_BLUR_ENABLED', True), patch.object(final_renderer, 'detect_source_platform', return_value='bilibili'), patch.object(watermark_detector, 'detect_watermark_regions', side_effect=RuntimeError('OCR unavailable')):
            self.assertEqual(final_renderer.get_bilibili_text_blur_boxes(1000, 600), [])

    def test_disabled_or_other_platform_does_not_run_ocr(self):
        with patch.object(final_renderer, 'AUTO_BRAND_BLUR_ENABLED', False), patch.object(watermark_detector, 'detect_watermark_regions') as detect:
            self.assertEqual(final_renderer.get_bilibili_text_blur_boxes(1000, 600), [])
            detect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
