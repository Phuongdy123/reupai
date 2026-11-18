"""Smart Silence & Dead-Air Trimmer using FFmpeg silencedetect."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


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
        out = subprocess.check_output(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
            text=True,
            timeout=30,
        )
        return max(0.0, float(json.loads(out or "{}").get("format", {}).get("duration") or 0.0))
    except Exception:
        return 0.0


def trim_video_silence(
    source_video: Path,
    output_video: Path,
    *,
    min_silence_duration: float = 1.2,
    noise_db: str = "-38dB",
) -> Path:
    """Detect silences > min_silence_duration and concatenate active segments."""
    ffmpeg = _find_binary("ffmpeg")
    if not ffmpeg or not source_video.is_file():
        return source_video

    total_dur = _probe_duration(source_video)
    if total_dur < 4.0:
        return source_video

    detect = subprocess.run(
        [
            ffmpeg,
            "-i", str(source_video),
            "-af", f"silencedetect=noise={noise_db}:d={float(min_silence_duration):.2f}",
            "-f", "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )
    stderr = detect.stderr or ""
    silences: list[tuple[float, float]] = []
    cur_start: float | None = None
    for line in stderr.splitlines():
        m_start = re.search(r"silence_start:\s*([0-9.]+)", line)
        if m_start:
            cur_start = float(m_start.group(1))
            continue
        m_end = re.search(r"silence_end:\s*([0-9.]+)", line)
        if m_end and cur_start is not None:
            end_ts = float(m_end.group(1))
            if end_ts > cur_start:
                silences.append((cur_start, end_ts))
            cur_start = None
    if cur_start is not None and total_dur > cur_start:
        silences.append((cur_start, total_dur))

    if not silences:
        return source_video

    # Invert silences to active keep segments with 0.12s padding
    pad = 0.12
    keep: list[tuple[float, float]] = []
    cursor = 0.0
    for s_start, s_end in silences:
        seg_end = max(cursor, min(total_dur, s_start + pad))
        if seg_end - cursor >= 0.25:
            keep.append((cursor, seg_end))
        cursor = max(cursor, s_end - pad)
    if total_dur - cursor >= 0.25:
        keep.append((cursor, total_dur))

    kept_total = sum(e - s for s, e in keep)
    if not keep or kept_total >= total_dur * 0.96 or kept_total < max(2.0, total_dur * 0.2):
        return source_video

    filter_parts: list[str] = []
    concat_inputs: list[str] = []
    for idx, (s, e) in enumerate(keep):
        filter_parts.append(f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[v{idx}]")
        filter_parts.append(f"[0:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS[a{idx}]")
        concat_inputs.append(f"[v{idx}][a{idx}]")
    filter_parts.append(f"{''.join(concat_inputs)}concat=n={len(keep)}:v=1:a=1[vout][aout]")

    subprocess.run(
        [
            ffmpeg, "-y",
            "-i", str(source_video),
            "-filter_complex", ";".join(filter_parts),
            "-map", "[vout]",
            "-map", "[aout]",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "18",
            "-c:a", "aac",
            "-b:a", "192k",
            str(output_video),
        ],
        check=True,
        capture_output=True,
        timeout=600,
    )
    return output_video if output_video.is_file() else source_video
