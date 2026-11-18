"""Vocal separation helper: removes original speech while keeping SFX & music."""
from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path


def _find_ffmpeg() -> str | None:
    bundle = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
    binary = bundle / "bin" / "ffmpeg.exe"
    if binary.is_file():
        return str(binary)
    return shutil.which("ffmpeg")


def separate_vocals_preserve_sfx(source_media: Path, output_dir: Path) -> Path | None:
    """Produce an accompaniment WAV (SFX + music, reduced/removed vocals).

    Uses Demucs two-stems separation when installed; otherwise falls back to
    FFmpeg stereo center-channel attenuation so stereo SFX & BGM remain clear.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    target_wav = output_dir / f"{source_media.stem}_no_vocals.wav"
    if target_wav.is_file() and target_wav.stat().st_size > 1024:
        return target_wav

    if importlib.util.find_spec("demucs") is not None:
        try:
            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "demucs",
                    "--two-stems=vocals",
                    "-o",
                    str(output_dir / "demucs_tmp"),
                    str(source_media),
                ],
                check=True,
                capture_output=True,
                timeout=600,
            )
            found = next((output_dir / "demucs_tmp").rglob("no_vocals.wav"), None)
            if found and found.is_file():
                shutil.copy2(found, target_wav)
                return target_wav
        except Exception:
            pass

    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        return None
    try:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(source_media),
                "-vn",
                "-af",
                "pan=stereo|c0=c0-0.65*c1|c1=c1-0.65*c0,lowshelf=g=3:f=180,alimiter=limit=0.95",
                "-ar",
                "44100",
                "-ac",
                "2",
                str(target_wav),
            ],
            check=True,
            capture_output=True,
            timeout=180,
        )
        return target_wav if target_wav.is_file() else None
    except Exception:
        return None
