"""Finalize a standalone subtitle artifact without starting video rendering."""
from pathlib import Path
import re


def export_subtitle_file(source: Path, job_dir: Path) -> Path:
    text = source.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    blocks = re.split(r"\n\s*\n", text.strip()) if text.strip() else []
    timeline = re.compile(r"\d{2,}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2,}:\d{2}:\d{2}[,.]\d{3}")
    has_text = False
    for block in blocks:
        lines = block.splitlines()
        offset = 1 if lines and lines[0].strip().isdigit() else 0
        if len(lines) <= offset + 1 or not timeline.fullmatch(lines[offset].strip()):
            raise RuntimeError("Nội dung SRT không hợp lệ; chưa thể xuất phụ đề.")
        has_text = has_text or any(line.strip() for line in lines[offset + 1:])
    if not has_text:
        raise RuntimeError("Chưa nhận diện được phụ đề để xuất SRT. Hãy kiểm tra nguồn phụ đề hoặc vùng nhận diện.")
    destination = job_dir / "final_sub.srt"
    temporary = destination.with_suffix(".srt.tmp")
    temporary.write_text(text.rstrip() + "\n", encoding="utf-8")
    temporary.replace(destination)
    return destination
