"""AI Viral Shorts Highlight Suggester & 9:16 Cutter for ReupAI."""
from __future__ import annotations

import json
import re
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


def _parse_srt_blocks(srt_text: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for raw in re.split(r"\r?\n\r?\n+", str(srt_text or "").strip()):
        lines = [line.strip() for line in raw.splitlines() if line.strip()]
        if len(lines) < 2:
            continue
        ts_line = lines[1] if "-->" in lines[1] else (lines[0] if "-->" in lines[0] else "")
        match = re.search(
            r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})",
            ts_line,
        )
        if not match:
            continue
        h1, m1, s1, ms1, h2, m2, s2, ms2 = map(int, match.groups())
        start = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000.0
        end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000.0
        text_start = 2 if "-->" in lines[1] else 1
        text = " ".join(lines[text_start:]).strip()
        if text and end > start:
            blocks.append({"start": round(start, 2), "end": round(end, 2), "text": text})
    return blocks


def suggest_viral_highlights(
    *,
    srt_path: Path | None = None,
    title: str = "",
    duration_seconds: float = 0.0,
    max_clips: int = 4,
) -> list[dict[str, Any]]:
    """Use Gemini AI to pick 3-5 viral highlight segments (15-58s) from a video transcript."""
    blocks = _parse_srt_blocks(srt_path.read_text(encoding="utf-8", errors="replace")) if srt_path and srt_path.is_file() else []

    if blocks:
        try:
            from services.gemini_oauth import authorized_request, get_project_id
            from services.assistant_service import _MODELS, is_model_exhausted, mark_model_exhausted

            project = get_project_id()
            if project:
                compact_lines = [f"[{b['start']}s-{b['end']}s] {b['text'][:120]}" for b in blocks[:160]]
                prompt = (
                    f"Video: {title[:180]}\n"
                    f"Chọn {max(1, min(5, max_clips))} đoạn cao trào, hài hước hoặc kịch tính nhất để cắt làm YouTube Shorts / TikTok (mỗi đoạn dài 15–55 giây).\n"
                    "Trả về JSON array các object: [{start: number, end: number, hook_title: string (tiếng Việt ngắn giật tít <= 60 ký tự), reason: string}].\n\n"
                    + "\n".join(compact_lines)
                )
                body = {
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.3, "responseMimeType": "application/json"},
                }
                for model in _MODELS:
                    if is_model_exhausted(model):
                        continue
                    resp = authorized_request(
                        "POST",
                        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                        project_id=project,
                        json=body,
                        timeout=35,
                    )
                    if resp.status_code in {404, 429}:
                        mark_model_exhausted(model)
                        continue
                    if resp.ok:
                        raw_txt = "".join(p.get("text", "") for p in resp.json()["candidates"][0]["content"]["parts"])
                        parsed = json.loads(raw_txt)
                        if isinstance(parsed, list) and parsed:
                            cleaned: list[dict[str, Any]] = []
                            for item in parsed[:max_clips]:
                                if not isinstance(item, dict):
                                    continue
                                s = max(0.0, float(item.get("start") or 0.0))
                                e = max(s + 10.0, float(item.get("end") or (s + 30.0)))
                                if e - s > 59.0:
                                    e = s + 55.0
                                cleaned.append({
                                    "start": round(s, 2),
                                    "end": round(e, 2),
                                    "hook_title": str(item.get("hook_title") or "Đoạn cao trào cực cuốn").strip()[:80],
                                    "reason": str(item.get("reason") or "Nhịp nhanh, giữ chân người xem tốt").strip()[:180],
                                })
                            if cleaned:
                                return cleaned
        except Exception:
            pass

    # Deterministic fallback if transcript is short/unavailable
    total = max(30.0, float(duration_seconds or (blocks[-1]["end"] if blocks else 90.0)))
    clip_len = min(45.0, max(18.0, total / max(1, min(3, max_clips))))
    results: list[dict[str, Any]] = []
    step = max(clip_len, total / max(1, min(3, max_clips)))
    for i in range(min(3, max_clips)):
        s = round(min(max(0.0, total - clip_len), i * step), 2)
        e = round(min(total, s + clip_len), 2)
        if e - s < 8:
            break
        results.append({
            "start": s,
            "end": e,
            "hook_title": f"Highlight #{i + 1}: {title[:36] or 'Khoảnh khắc đắt giá'}",
            "reason": "Phân đoạn tự động tối ưu thời lượng Shorts (9:16).",
        })
    return results


def cut_short_highlight_clip(
    *,
    source_video: Path,
    output_path: Path,
    start: float,
    end: float,
) -> Path:
    """Cut [start, end] and format into crisp 1080x1920 (9:16) vertical Shorts with blurred backdrop."""
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("Thiếu ffmpeg để cắt video Shorts.")
    if not source_video.is_file():
        raise FileNotFoundError("Không tìm thấy video nguồn/thành phẩm để cắt Shorts.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dur = max(5.0, min(59.0, float(end) - float(start)))
    vf = (
        "split=2[bg][fg];"
        "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:2[bgb];"
        "[fg]scale=1080:-2:force_original_aspect_ratio=decrease[fgs];"
        "[bgb][fgs]overlay=(W-w)/2:(H-h)/2,format=yuv420p"
    )
    res = subprocess.run(
        [
            ffmpeg, "-y",
            "-ss", f"{max(0.0, float(start)):.2f}",
            "-t", f"{dur:.2f}",
            "-i", str(source_video),
            "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-c:a", "aac", "-b:a", "160k",
            "-movflags", "+faststart",
            str(output_path),
        ],
        capture_output=True,
        text=True,
        timeout=180,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if res.returncode != 0 or not output_path.is_file() or output_path.stat().st_size < 1024:
        raise RuntimeError("Không cắt được video Shorts: " + (res.stderr or "")[-400:])
    return output_path
