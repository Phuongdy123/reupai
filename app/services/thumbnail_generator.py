"""Automatic YouTube Hook Thumbnail generator using FFmpeg + Pillow."""
from __future__ import annotations

import base64
import io
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path


def _find_ffmpeg() -> str | None:
    bundle = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
    binary = bundle / "bin" / "ffmpeg.exe"
    if binary.is_file():
        return str(binary)
    return shutil.which("ffmpeg")


def _load_bold_font(size: int):
    from PIL import ImageFont

    candidates = [
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/calibrib.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for fp in candidates:
        if Path(fp).is_file():
            try:
                return ImageFont.truetype(fp, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def generate_hook_thumbnail(
    source_video: Path,
    hook_text: str = "",
    *,
    timestamp_seconds: float = 12.0,
) -> str:
    """Extract a crisp 1280x720 frame and overlay bold Vietnamese Hook text."""
    from PIL import Image, ImageDraw

    ffmpeg = _find_ffmpeg()
    if not ffmpeg or not source_video.is_file():
        raise RuntimeError("Không tìm thấy video nguồn hoặc FFmpeg để tạo thumbnail.")

    temp_jpg = source_video.with_suffix(".hook_thumb_tmp.jpg")
    try:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-ss",
                str(max(1.0, float(timestamp_seconds))),
                "-i",
                str(source_video),
                "-frames:v",
                "1",
                "-vf",
                "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
                "-q:v",
                "2",
                str(temp_jpg),
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
        with Image.open(temp_jpg) as img:
            canvas = img.convert("RGBA")
            w, h = canvas.size
            # Subtle bottom gradient strip for readable Hook text
            overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            ov_draw = ImageDraw.Draw(overlay)
            ov_draw.rectangle((0, int(h * 0.56), w, h), fill=(10, 14, 23, 165))
            canvas = Image.alpha_composite(canvas, overlay).convert("RGB")

            clean_hook = " ".join(str(hook_text or "").strip().split()).upper()
            if clean_hook:
                draw = ImageDraw.Draw(canvas)
                font_size = 76 if len(clean_hook) <= 24 else 62
                font = _load_bold_font(font_size)
                wrapped = textwrap.wrap(clean_hook, width=22)[:2]
                y_pos = int(h * 0.63)
                for line in wrapped:
                    bbox = draw.textbbox((0, 0), line, font=font)
                    tw = bbox[2] - bbox[0]
                    tx = max(40, (w - tw) // 2)
                    draw.text(
                        (tx, y_pos),
                        line,
                        font=font,
                        fill=(255, 226, 74),
                        stroke_width=6,
                        stroke_fill=(12, 16, 26),
                    )
                    y_pos += font_size + 14

            buf = io.BytesIO()
            canvas.save(buf, format="JPEG", quality=90)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            return f"data:image/jpeg;base64,{b64}"
    finally:
        try:
            temp_jpg.unlink(missing_ok=True)
        except OSError:
            pass
