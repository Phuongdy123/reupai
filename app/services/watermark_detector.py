"""Find persistent corner text without blanketing an assumed corner rectangle."""
import math
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np


def _iou(left, right):
    width = max(0, min(left[2], right[2]) - max(left[0], right[0]))
    height = max(0, min(left[3], right[3]) - max(left[1], right[1]))
    overlap = width * height
    union = (left[2] - left[0]) * (left[3] - left[1]) + (right[2] - right[0]) * (right[3] - right[1]) - overlap
    return overlap / max(1, union)


def persistent_corner_regions(observations, sample_count, width, height):
    """Require repeated OCR evidence and retain compact, separate text rows."""
    clusters = []
    for frame_index, boxes in observations:
        for box in boxes:
            rect = tuple(float(box[key]) for key in ('x1', 'y1', 'x2', 'y2'))
            x1, y1, x2, y2 = rect
            bw, bh = x2 - x1, y2 - y1
            center = (x1 + x2) / 2
            if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height * .22):
                continue
            if not (width * .018 <= bw <= width * .48 and 4 <= bh <= height * .065):
                continue
            if not ((center <= width * .34 and x1 <= width * .18) or (center >= width * .66 and x2 >= width * .82)):
                continue
            matching = []
            for cluster in clusters:
                if frame_index in cluster['frames']:
                    continue
                median = np.median(cluster['rects'], axis=0)
                overlap = _iou(rect, median)
                if overlap >= .45:
                    matching.append((overlap, cluster))
            if matching:
                cluster = max(matching, key=lambda item: item[0])[1]
                cluster['rects'].append(rect)
                cluster['frames'].add(frame_index)
            else:
                clusters.append({'rects': [rect], 'frames': {frame_index}})

    required = max(3, math.ceil(sample_count * .5))
    regions = []
    for cluster in clusters:
        if len(cluster['frames']) < required:
            continue
        rects = np.asarray(cluster['rects'])
        x1, y1 = np.percentile(rects[:, :2], 10, axis=0)
        x2, y2 = np.percentile(rects[:, 2:], 90, axis=0)
        pad = max(2, min((y2 - y1) * .18, width * .004))
        left, top = max(0, math.floor(x1 - pad)), max(0, math.floor(y1 - pad))
        right, bottom = min(width, math.ceil(x2 + pad)), min(height, math.ceil(y2 + pad))
        regions.append({'x': left, 'y': top, 'width': right - left, 'height': bottom - top,
                        'hits': len(cluster['frames']), 'confidence': len(cluster['frames']) / sample_count})
    return sorted(regions, key=lambda box: (box['y'], box['x']))


def detect_watermark_regions(video_path):
    path = Path(video_path).resolve()
    stat = path.stat()
    return _detect_cached(str(path), stat.st_size, stat.st_mtime_ns)


def _corner_text_boxes(frame):
    # Do not reuse subtitle-size filters: on this short top crop, a valid small
    # watermark can exceed the subtitle detector's maximum relative box height.
    from services.subtitle_detector import get_detector, parse_result, resize_for_ocr
    resized, scale = resize_for_ocr(frame, 1280)
    boxes = []
    for result in get_detector().predict(resized):
        polygons, scores = parse_result(result)
        for index, polygon in enumerate(polygons):
            if index < len(scores) and float(scores[index]) < .52:
                continue
            points = np.asarray(polygon, dtype=np.float32).reshape(-1, 2) / scale
            left, top = points.min(axis=0)
            right, bottom = points.max(axis=0)
            boxes.append({'x1': float(left), 'y1': float(top), 'x2': float(right), 'y2': float(bottom)})
    return boxes


@lru_cache(maxsize=8)
def _detect_cached(video_path, _size, _mtime):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError('Cannot open video for watermark detection.')
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        duration = frames / fps if fps > 0 else 0
        if duration <= 0:
            raise RuntimeError('Cannot read video duration for watermark detection.')
        observations = []
        width = height = 0
        for index, fraction in enumerate((.04, .20, .36, .52, .68, .84)):
            cap.set(cv2.CAP_PROP_POS_MSEC, fraction * duration * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            height, width = frame.shape[:2]
            top = frame[:max(1, round(height * .22)), :]
            boxes = _corner_text_boxes(top)
            # Subtitle line merging intentionally drops text at the extreme edge;
            # watermark detection must keep those small edge boxes instead.
            observations.append((index, boxes))
        if not observations:
            raise RuntimeError('Cannot sample frames for watermark detection.')
        return {'video': {'width': width, 'height': height},
                'boxes': persistent_corner_regions(observations, len(observations), width, height),
                'method': 'persistent_corner_text_v1', 'samples': len(observations)}
    finally:
        cap.release()
