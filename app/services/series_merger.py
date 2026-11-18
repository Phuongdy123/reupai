"""Merge multiple processed episodes into a Full-Season compilation + YouTube Chapters."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def _find_binary(name: str) -> str | None:
    bundle = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
    binary = bundle / "bin" / f"{name}.exe"
    if binary.is_file():
        return str(binary)
    return shutil.which(name)


def _probe_duration(path: Path) -> float:
    ffprobe = _find_binary("ffprobe")
    if not ffprobe or not path.is_file():
        return 0.0
    try:
        proc = subprocess.run(
            [
                ffprobe,
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        data = json.loads(proc.stdout or "{}")
        return max(0.0, float(data.get("format", {}).get("duration") or 0.0))
    except Exception:
        return 0.0


def _format_chapter_ts(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"


def merge_series_videos(
    video_paths: list[Path],
    titles: list[str],
    output_path: Path,
) -> dict[str, Any]:
    """Concatenate processed episodes and compute YouTube Chapters timestamps."""
    valid = [(p, t) for p, t in zip(video_paths, titles) if p and p.is_file()]
    if len(valid) < 2:
        raise ValueError("Cần ít nhất 2 tập đã xử lý để gộp Full Bộ.")

    ffmpeg = _find_binary("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("Không tìm thấy FFmpeg để gộp video.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    concat_file = output_path.with_suffix(".concat.txt")
    lines: list[str] = []
    chapters: list[dict[str, Any]] = []
    cursor = 0.0

    for idx, (path, title) in enumerate(valid, start=1):
        escaped = str(path.resolve()).replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
        dur = _probe_duration(path)
        chapters.append({
            "index": idx,
            "timestamp": _format_chapter_ts(cursor),
            "title": str(title or f"Tập {idx}").strip(),
            "duration": round(dur, 2),
        })
        cursor += dur

    concat_file.write_text("\n".join(lines), encoding="utf-8")
    try:
        try:
            subprocess.run(
                [
                    ffmpeg, "-y",
                    "-f", "concat",
                    "-safe", "0",
                    "-i", str(concat_file),
                    "-c", "copy",
                    str(output_path),
                ],
                check=True,
                capture_output=True,
                timeout=900,
            )
        except subprocess.CalledProcessError:
            subprocess.run(
                [
                    ffmpeg, "-y",
                    "-f", "concat",
                    "-safe", "0",
                    "-i", str(concat_file),
                    "-c:v", "libx264",
                    "-preset", "fast",
                    "-crf", "18",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    str(output_path),
                ],
                check=True,
                capture_output=True,
                timeout=1800,
            )
    finally:
        try:
            concat_file.unlink(missing_ok=True)
        except OSError:
            pass

    chapters_text = "\n".join(f"{c['timestamp']} {c['title']}" for c in chapters)
    return {
        "output_path": str(output_path),
        "total_duration": round(cursor, 2),
        "episode_count": len(valid),
        "chapters": chapters,
        "chapters_text": chapters_text,
    }
