"""Read hardcoded subtitles from video frames and write a timed source SRT."""

from __future__ import annotations

import json
import math
import re
import statistics
import time
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

import cv2


_OCR = None
_OCR_KEY = None


def _paddle_language(language: str) -> str:
    # PaddleOCR's multilingual Chinese model also recognizes Latin text and is
    # the safest default for mixed Chinese/English Bilibili subtitles.
    return {
        "auto": "ch",
        "zh": "ch",
        "en": "en",
        "ja": "japan",
        "ko": "korean",
        "vi": "vi",
        "th": "th",
    }.get(str(language or "auto").lower(), "ch")


def _get_ocr(language: str, threads: int, use_gpu: bool):
    global _OCR, _OCR_KEY

    import paddle
    from paddleocr import PaddleOCR

    try:
        paddle.set_num_threads(max(1, min(int(threads), 8)))
    except (AttributeError, TypeError, ValueError):
        pass

    cuda_ready = False
    try:
        cuda_ready = bool(paddle.device.is_compiled_with_cuda())
    except (AttributeError, RuntimeError):
        try:
            cuda_ready = bool(paddle.is_compiled_with_cuda())
        except (AttributeError, RuntimeError):
            cuda_ready = False

    device = "gpu:0" if use_gpu and cuda_ready else "cpu"
    key = (_paddle_language(language), device, max(1, min(int(threads), 8)))
    if _OCR is not None and _OCR_KEY == key:
        return _OCR, device

    print(f"[subtitle-ocr] Đang khởi tạo PaddleOCR ({key[0]}, {device}).")
    kwargs = {
        "lang": key[0],
        "device": device,
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
    }
    try:
        _OCR = PaddleOCR(**kwargs)
    except Exception:
        if device == "cpu":
            raise
        print("[subtitle-ocr] GPU không khởi tạo được; chuyển sang CPU.")
        kwargs["device"] = "cpu"
        _OCR = PaddleOCR(**kwargs)
        device = "cpu"
        key = (key[0], device, key[2])
    _OCR_KEY = key
    return _OCR, device


def _json_result(item):
    value = getattr(item, "json", None)
    if callable(value):
        value = value()
    if value is None and isinstance(item, dict):
        value = item
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return {}
    if not isinstance(value, dict):
        return {}
    nested = value.get("res")
    return nested if isinstance(nested, dict) else value


def _box_center_y(box):
    try:
        values = [float(part) for part in box]
    except (TypeError, ValueError):
        return None
    if len(values) == 4:
        return (values[1] + values[3]) / 2
    if len(values) >= 6 and len(values) % 2 == 0:
        return sum(values[1::2]) / (len(values) / 2)
    try:
        points = list(box)
        return sum(float(point[1]) for point in points) / len(points)
    except (TypeError, ValueError, IndexError, ZeroDivisionError):
        return None


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _frame_text(ocr, frame, confidence: float):
    height = frame.shape[0]
    # Hardcoded subtitles most commonly sit in the lower part of the picture.
    # Start above the usual subtitle baseline so two-line bilingual captions
    # are retained, while avoiding OCR on most scenery and title cards.
    crop_y = int(height * 0.25)
    crop = frame[crop_y:, :]
    predictions = ocr.predict(crop)
    candidates = []
    for item in predictions or []:
        data = _json_result(item)
        texts = data.get("rec_texts") or []
        scores = data.get("rec_scores") or []
        boxes = data.get("rec_boxes") or data.get("rec_polys") or []
        for index, raw_text in enumerate(texts):
            text = _normalize_text(raw_text)
            if not text:
                continue
            try:
                score = float(scores[index]) if index < len(scores) else 1.0
            except (TypeError, ValueError):
                score = 0.0
            if score < confidence:
                continue
            center_y = None
            if index < len(boxes):
                center_y = _box_center_y(boxes[index])
                if center_y is not None and center_y < crop.shape[0] * 0.10:
                    continue
            candidates.append((text, score, center_y or 0))

    candidates.sort(key=lambda item: (item[2], item[0]))
    texts = []
    for text, _score, _y in candidates:
        if not any(SequenceMatcher(None, text.casefold(), old.casefold()).ratio() >= 0.94 for old in texts):
            texts.append(text)
    return " ".join(texts), statistics.mean(item[1] for item in candidates) if candidates else 0.0


def _timestamp(seconds: float) -> str:
    milliseconds = max(0, int(round(float(seconds) * 1000)))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{whole_seconds:02},{millis:03}"


def _similarity(left: str, right: str) -> float:
    left = re.sub(r"\s+", "", left).casefold()
    right = re.sub(r"\s+", "", right).casefold()
    return SequenceMatcher(None, left, right).ratio()


def _write_srt(detections, duration: float, sample_interval: float, output_path: Path, merge: bool, threshold: float):
    if not detections:
        return 0

    groups = []
    current = [detections[0]]
    max_gap = max(1.25, sample_interval * 2.5)
    for detected in detections[1:]:
        previous = current[-1]
        same_text = _similarity(previous["text"], detected["text"]) >= threshold if merge else previous["text"] == detected["text"]
        if same_text and detected["time"] - previous["time"] <= max_gap:
            current.append(detected)
        else:
            groups.append(current)
            current = [detected]
    groups.append(current)

    blocks = []
    for group in groups:
        start = group[0]["time"]
        end = min(duration, group[-1]["time"] + sample_interval)
        if end - start < 0.30:
            end = min(duration, start + 0.30)
        if end <= start:
            continue
        # Choose the most repeatedly recognized caption; use mean confidence
        # only as a tie-breaker to avoid forwarding a single OCR flicker.
        ranked = Counter(item["text"] for item in group)
        best_count = max(ranked.values())
        choices = [text for text, count in ranked.items() if count == best_count]
        best = max(choices, key=lambda text: statistics.mean(
            item["confidence"] for item in group if item["text"] == text
        ))
        blocks.append(f"{len(blocks) + 1}\n{_timestamp(start)} --> {_timestamp(end)}\n{best}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n\n".join(blocks) + ("\n" if blocks else ""), encoding="utf-8-sig")
    return len(blocks)


def extract_subtitle_srt(
    video_path: Path,
    output_path: Path,
    *,
    language: str = "auto",
    fps: float = 2.0,
    min_confidence: float = 0.45,
    parallelism: int = 2,
    use_gpu: bool = False,
    merge_similar: bool = True,
    similarity_threshold: float = 0.82,
    on_progress=None,
):
    """OCR embedded subtitle text from sampled frames into a source SRT."""
    fps = min(10.0, max(0.25, float(fps or 2.0)))
    confidence = min(0.99, max(0.05, float(min_confidence or 0.45)))
    threshold = min(0.99, max(0.50, float(similarity_threshold or 0.82)))
    video_path = Path(video_path)
    output_path = Path(output_path)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError("Không mở được video để đọc phụ đề bằng OCR.")

    duration = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0) / max(float(cap.get(cv2.CAP_PROP_FPS) or 0), 0.001)
    if not math.isfinite(duration) or duration <= 0:
        cap.release()
        raise RuntimeError("Không xác định được thời lượng video để tạo mốc SRT.")

    try:
        ocr, device = _get_ocr(language, parallelism, use_gpu)
    except Exception as error:
        cap.release()
        raise RuntimeError(
            "Không khởi tạo được OCR phụ đề. Lần đầu cần tải model OCR; hãy kiểm tra mạng và dung lượng trống rồi thử lại. "
            f"Chi tiết: {error}"
        ) from error

    if use_gpu and device == "cpu":
        print("[subtitle-ocr] Engine hiện không có Paddle GPU; tiếp tục bằng CPU.")

    total = max(1, int(math.ceil(duration * fps)))
    interval = 1.0 / fps
    detections = []
    started = time.monotonic()
    last_report = started
    try:
        for index in range(total):
            timestamp = min(index * interval, max(0, duration - 0.01))
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ok, frame = cap.read()
            if ok and frame is not None:
                text, score = _frame_text(ocr, frame, confidence)
                if text:
                    detections.append({"time": timestamp, "text": text, "confidence": score})
            now = time.monotonic()
            if on_progress and (now - last_report >= 0.75 or index + 1 == total):
                on_progress(timestamp, duration)
                last_report = now
    finally:
        cap.release()

    count = _write_srt(detections, duration, interval, output_path, bool(merge_similar), threshold)
    if count == 0:
        output_path.unlink(missing_ok=True)
        raise RuntimeError(
            "OCR chưa đọc được phụ đề trên video. Thử tăng tốc độ lấy mẫu, giảm ngưỡng tin cậy, "
            "chọn đúng ngôn ngữ OCR hoặc chuyển sang lấy lời thoại từ âm thanh."
        )
    elapsed = time.monotonic() - started
    print(f"[subtitle-ocr] Đã tạo {count} dòng SRT từ {len(detections)} lần nhận diện trong {elapsed:.1f}s.")
    return count
