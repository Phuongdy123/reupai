"""Validate human-reviewed translations before using them as final subtitles."""

import math


def reviewed_translation_lines(lines):
    """Return exact approved Vietnamese cues, or None for a source-only transcript.

    A partial translation must fail rather than silently mixing languages or
    asking Gemini to overwrite edits that the customer already approved.
    """
    if not lines or not any(line.get("translated_text") is not None for line in lines):
        return None
    translated = []
    for line in lines:
        text = str(line.get("translated_text") or "").strip()
        try:
            start, end = float(line["start"]), float(line["end"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("Bản dịch có thời gian không hợp lệ.") from error
        if not text:
            raise ValueError("Bản dịch còn câu để trống. Hãy dịch đủ các câu trước khi xuất.")
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            raise ValueError("Bản dịch có thời gian không hợp lệ.")
        translated.append({"start": start, "end": end, "text": text})
    return translated
