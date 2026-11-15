"""Read final Vietnamese cues and stage edits until a render succeeds."""
from contextlib import contextmanager
import math
from pathlib import Path
import re
import tempfile


def validate_cues(cues):
    if not cues or len(cues) > 10000:
        raise ValueError("Cần giữ từ 1 đến 10.000 câu phụ đề.")
    result = []
    for cue in cues:
        start, end = float(cue["start"]), float(cue["end"])
        text = re.sub(r"\n\s*\n", "\n", str(cue.get("text") or "").replace("\r\n", "\n")).strip()
        if not text or len(text) > 2000:
            raise ValueError("Mỗi câu cần có nội dung, tối đa 2.000 ký tự.")
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or round(end * 1000) <= round(start * 1000):
            raise ValueError("Thời gian kết thúc mỗi câu phải lớn hơn thời gian bắt đầu.")
        result.append({"start": start, "end": end, "text": text})
    return result


def read_cues(path: Path):
    if not path.is_file():
        return []
    if path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("File phụ đề quá lớn để mở trình chỉnh sửa.")
    def seconds(value):
        h, m, s = value.replace(",", ".").split(":")
        return int(h) * 3600 + int(m) * 60 + float(s)
    cues = []
    for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").strip()):
        lines = block.splitlines()
        if lines and lines[0].strip().isdigit():
            lines = lines[1:]
        if not lines:
            continue
        match = re.fullmatch(r"(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2,}:\d{2}:\d{2}[,.]\d{3})", lines[0].strip())
        if not match or len(lines) < 2:
            raise ValueError("Không đọc được thời gian trong file phụ đề.")
        cues.append({"start": seconds(match[1]), "end": seconds(match[2]), "text": "\n".join(lines[1:])})
    return validate_cues(cues) if cues else []


def _clock(seconds):
    milliseconds = round(seconds * 1000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    hours, minutes = divmod(minutes, 60)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"


@contextmanager
def staged_revision(original: Path, cues):
    if cues is None:
        yield original
        return
    normalized = validate_cues(cues)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=".reviewed-", suffix=".srt", dir=original.parent, delete=False) as output:
        temporary = Path(output.name)
        output.write("\n\n".join(f"{index}\n{_clock(cue['start'])} --> {_clock(cue['end'])}\n{cue['text']}" for index, cue in enumerate(normalized, 1)) + "\n")
    try:
        yield temporary
        temporary.replace(original)
    finally:
        temporary.unlink(missing_ok=True)
