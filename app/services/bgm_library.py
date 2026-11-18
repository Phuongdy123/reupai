"""Built-in Royalty-Free Mood BGM Preset Library (100% copyright-safe ambient loops)."""
from __future__ import annotations

import wave
from pathlib import Path
from typing import Any

import numpy as np

BGM_PRESETS: dict[str, dict[str, Any]] = {
    "lofi": {
        "id": "lofi",
        "label": "Lo-fi Chill (Kể chuyện / Review)",
        "chords": [(261.63, 329.63, 392.00, 493.88), (220.00, 261.63, 329.63, 392.00), (174.61, 220.00, 261.63, 349.23), (196.00, 246.94, 293.66, 392.00)],
        "tempo_sec": 3.0,
    },
    "epic": {
        "id": "epic",
        "label": "Hào hùng / Tiên hiệp (Epic)",
        "chords": [(146.83, 220.00, 293.66, 440.00), (130.81, 196.00, 261.63, 392.00), (116.54, 174.61, 233.08, 349.23), (130.81, 196.00, 261.63, 392.00)],
        "tempo_sec": 2.5,
    },
    "action": {
        "id": "action",
        "label": "Kịch tính / Hành động (Action)",
        "chords": [(110.00, 164.81, 220.00, 329.63), (123.47, 185.00, 246.94, 369.99), (130.81, 196.00, 261.63, 392.00), (110.00, 164.81, 220.00, 329.63)],
        "tempo_sec": 1.5,
    },
    "funny": {
        "id": "funny",
        "label": "Vui tươi / Hài hước (Upbeat)",
        "chords": [(329.63, 392.00, 493.88, 659.25), (293.66, 349.23, 440.00, 587.33), (261.63, 329.63, 392.00, 523.25), (293.66, 392.00, 493.88, 587.33)],
        "tempo_sec": 1.5,
    },
}


def list_bgm_presets() -> list[dict[str, str]]:
    return [{"id": k, "label": v["label"]} for k, v in BGM_PRESETS.items()]


def get_or_generate_bgm_preset(mood: str, cache_dir: Path) -> Path:
    key = str(mood or "lofi").strip().lower()
    spec = BGM_PRESETS.get(key) or BGM_PRESETS["lofi"]
    cache_dir.mkdir(parents=True, exist_ok=True)
    out_wav = cache_dir / f"reupai_bgm_{spec['id']}.wav"
    if out_wav.is_file() and out_wav.stat().st_size > 10000:
        return out_wav

    sr = 44100
    chords = spec["chords"]
    seg_sec = float(spec["tempo_sec"])
    samples_per_seg = int(sr * seg_sec)
    total_samples = samples_per_seg * len(chords)
    t_seg = np.linspace(0.0, seg_sec, samples_per_seg, endpoint=False)
    fade = int(sr * 0.15)
    env = np.ones_like(t_seg)
    env[:fade] = np.linspace(0.0, 1.0, fade)
    env[-fade:] = np.linspace(1.0, 0.0, fade)

    left = np.zeros(total_samples, dtype=np.float32)
    right = np.zeros(total_samples, dtype=np.float32)
    for idx, freqs in enumerate(chords):
        start = idx * samples_per_seg
        end = start + samples_per_seg
        wave_l = np.zeros_like(t_seg)
        wave_r = np.zeros_like(t_seg)
        for fi, f in enumerate(freqs):
            detune = 1.0 + (0.002 if fi % 2 == 0 else -0.002)
            wave_l += np.sin(2.0 * np.pi * f * t_seg) * (0.25 / len(freqs))
            wave_r += np.sin(2.0 * np.pi * f * detune * t_seg) * (0.25 / len(freqs))
        left[start:end] = wave_l * env
        right[start:end] = wave_r * env

    stereo = np.stack([left, right], axis=1)
    pcm = np.clip(stereo * 32767.0, -32767, 32767).astype(np.int16)
    with wave.open(str(out_wav), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())
    return out_wav
