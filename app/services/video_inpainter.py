"""Text-aware video subtitle/logo inpainter (runs alongside classic boxblur)."""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def _find_ffmpeg() -> str | None:
    bundle = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
    binary = bundle / "bin" / "ffmpeg.exe"
    if binary.is_file():
        return str(binary)
    return shutil.which("ffmpeg")


def _clamp_delogo_box(box: dict[str, Any], width: int, height: int) -> tuple[int, int, int, int] | None:
    try:
        x = int(round(float(box.get("x", 0))))
        y = int(round(float(box.get("y", 0))))
        w = int(round(float(box.get("width", 0))))
        h = int(round(float(box.get("height", 0))))
    except (TypeError, ValueError):
        return None
    if w <= 2 or h <= 2 or width <= 4 or height <= 4:
        return None
    # FFmpeg delogo requires at least 1px margin from frame borders
    x = max(1, min(x, width - 3))
    y = max(1, min(y, height - 3))
    w = max(2, min(w, width - x - 1))
    h = max(2, min(h, height - y - 1))
    if w <= 2 or h <= 2:
        return None
    return x, y, w, h


def build_delogo_filter_chain(
    boxes: list[dict[str, Any]],
    video_width: int,
    video_height: int,
) -> str:
    """Build chained FFmpeg delogo filters for non-blur border-interpolated removal."""
    ops: list[str] = []
    for box in boxes:
        clamped = _clamp_delogo_box(box, video_width, video_height)
        if not clamped:
            continue
        x, y, w, h = clamped
        ops.append(f"delogo=x={x}:y={y}:w={w}:h={h}")
    return ",".join(ops)


def inpaint_video_regions(
    source_video: Path,
    output_video: Path,
    boxes: list[dict[str, Any]],
    *,
    video_width: int,
    video_height: int,
    text_aware: bool = True,
) -> Path:
    """Remove subtitles/logos without boxblur.

    Uses OpenCV text-aware TELEA inpainting when cv2 is installed, otherwise
    uses FFmpeg delogo border interpolation + subtle unsharp detail recovery.
    """
    valid_boxes = [b for b in (boxes or []) if _clamp_delogo_box(b, video_width, video_height)]
    if not valid_boxes:
        return source_video

    try:
        import cv2  # type: ignore
        import numpy as np
    except ImportError:
        cv2 = None  # type: ignore
        np = None  # type: ignore

    if cv2 is not None and np is not None:
        cap = cv2.VideoCapture(str(source_video))
        if cap.isOpened():
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or video_width)
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or video_height)
            temp_silent = output_video.with_suffix(".silent_inpaint.mp4")
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(str(temp_silent), fourcc, fps, (w, h))
            clamped = [c for c in (_clamp_delogo_box(b, w, h) for b in valid_boxes) if c]
            kernel = np.ones((3, 3), np.uint8)
            try:
                while True:
                    ok, frame = cap.read()
                    if not ok:
                        break
                    mask = np.zeros((h, w), dtype=np.uint8)
                    for bx, by, bw, bh in clamped:
                        if text_aware:
                            roi = frame[by:by + bh, bx:bx + bw]
                            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
                            # Detect bright subtitle text and dark outlines inside ROI
                            _, bright = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
                            edges = cv2.Canny(gray, 90, 200)
                            combined = cv2.bitwise_or(bright, edges)
                            combined = cv2.dilate(combined, kernel, iterations=2)
                            if int(np.count_nonzero(combined)) > 12:
                                mask[by:by + bh, bx:bx + bw] = combined
                            else:
                                mask[by:by + bh, bx:bx + bw] = 255
                        else:
                            mask[by:by + bh, bx:bx + bw] = 255
                    if int(np.count_nonzero(mask)) > 0:
                        frame = cv2.inpaint(frame, mask, 3, cv2.INPAINT_TELEA)
                    writer.write(frame)
            finally:
                cap.release()
                writer.release()

            ffmpeg = _find_ffmpeg()
            if ffmpeg and temp_silent.is_file():
                subprocess.run(
                    [
                        ffmpeg, "-y",
                        "-i", str(temp_silent),
                        "-i", str(source_video),
                        "-map", "0:v:0",
                        "-map", "1:a?",
                        "-c:v", "libx264",
                        "-preset", "fast",
                        "-crf", "17",
                        "-c:a", "copy",
                        str(output_video),
                    ],
                    check=True,
                    capture_output=True,
                )
                try:
                    temp_silent.unlink(missing_ok=True)
                except OSError:
                    pass
                return output_video

    # Fast local fallback: FFmpeg delogo + mild unsharp
    ffmpeg = _find_ffmpeg()
    chain = build_delogo_filter_chain(valid_boxes, video_width, video_height)
    if not ffmpeg or not chain:
        return source_video
    subprocess.run(
        [
            ffmpeg, "-y",
            "-i", str(source_video),
            "-vf", f"{chain},unsharp=3:3:0.35:3:3:0.0",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "17",
            "-c:a", "copy",
            str(output_video),
        ],
        check=True,
        capture_output=True,
    )
    return output_video
