"""Regression tests for long-video checkpoints, download session persistence, and offline stability mode."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

from services import final_renderer, translator, tts
from web import server


class LongVideoResilienceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_slice_ass_file_shifts_and_filters_events(self):
        src = self.root / "full.ass"
        dst = self.root / "seg.ass"
        src.write_text(
            "[Script Info]\nTitle: Test\n\n[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
            "Dialogue: 0,0:01:00.00,0:01:05.00,Default,,0,0,0,,Truoc segment\n"
            "Dialogue: 0,0:09:58.00,0:10:03.00,Default,,0,0,0,,Cat giua\n"
            "Dialogue: 0,0:10:15.00,0:10:20.00,Default,,0,0,0,,Trong segment 2\n"
            "Dialogue: 0,0:25:00.00,0:25:05.00,Default,,0,0,0,,Sau segment 2\n",
            encoding="utf-8-sig",
        )
        final_renderer._slice_ass_file(src, dst, 600.0, 1200.0)
        lines = dst.read_text(encoding="utf-8-sig").splitlines()
        dialogues = [line for line in lines if line.startswith("Dialogue:")]
        self.assertEqual(len(dialogues), 2)
        self.assertIn(",0:00:00.00,0:00:03.00,", dialogues[0])
        self.assertIn("Cat giua", dialogues[0])
        self.assertIn(",0:00:15.00,0:00:20.00,", dialogues[1])

    def test_segmented_render_reuses_valid_checkpoint_segments(self):
        video = self.root / "source.mp4"
        ass = self.root / "final.ass"
        output = self.root / "final_sub.mp4"
        video.write_bytes(b"v" * 4096)
        ass.write_text("[Script Info]\nTitle: T\n\n[Events]\n", encoding="utf-8-sig")

        region = {"video": {"width": 1280, "height": 720}, "blur": {"x": 0, "y": 500, "width": 1280, "height": 100}}
        saved_state = {
            "VIDEO_PATH": final_renderer.VIDEO_PATH,
            "ASS_PATH": final_renderer.ASS_PATH,
            "OUTPUT_PATH": final_renderer.OUTPUT_PATH,
            "BLUR_INTERVALS": list(final_renderer.BLUR_INTERVALS),
        }
        try:
            final_renderer.VIDEO_PATH = str(video)
            final_renderer.ASS_PATH = str(ass)
            final_renderer.OUTPUT_PATH = str(output)
            final_renderer.BLUR_INTERVALS = []

            sig = final_renderer._render_checkpoint_signature(region, "subtitle", False, False, False)
            chunk_dir = output.with_name(f"{output.stem}.render_chunks")
            chunk_dir.mkdir(parents=True)
            (chunk_dir / "checkpoint.json").write_text(
                json.dumps({"signature": sig, "chunk_seconds": 600, "duration": 1200.0}),
                encoding="utf-8",
            )
            seg0 = chunk_dir / "seg_00000.mp4"
            seg0.write_bytes(b"ok-seg0" * 300)

            rendered_cmds = []

            def fake_run_ffmpeg(cmd, use_voice=False):
                rendered_cmds.append(list(cmd))
                Path(cmd[-1]).write_bytes(b"ok-seg1" * 300)

            def fake_concat(cmd, **kwargs):
                Path(cmd[-1]).write_bytes(b"final-merged" * 300)
                return type("R", (), {"returncode": 0, "stderr": ""})()

            with patch.object(final_renderer, "_probe_has_audio", return_value=False), \
                 patch.object(final_renderer, "_segment_video_ok", side_effect=lambda p: Path(p).is_file()), \
                 patch.object(final_renderer, "ffmpeg_has_nvenc", return_value=False), \
                 patch.object(final_renderer, "run_ffmpeg_with_fallback", side_effect=fake_run_ffmpeg), \
                 patch.object(final_renderer.subprocess, "run", side_effect=fake_concat):
                final_renderer._render_segmented_long_video(
                    region,
                    mode="subtitle",
                    duration_sec=1200.0,
                    chunk_seconds=600,
                    use_voice=False,
                    use_music=False,
                    use_logo=False,
                    logo_path=None,
                    logo_is_prepared=False,
                    output_path=output,
                )

            # Segment 0 was skipped via checkpoint; only segment 1 was encoded.
            self.assertEqual(len(rendered_cmds), 1)
            self.assertIn("600.000", rendered_cmds[0])
            self.assertTrue(output.is_file())
            self.assertFalse(chunk_dir.exists())
        finally:
            final_renderer.VIDEO_PATH = saved_state["VIDEO_PATH"]
            final_renderer.ASS_PATH = saved_state["ASS_PATH"]
            final_renderer.OUTPUT_PATH = saved_state["OUTPUT_PATH"]
            final_renderer.BLUR_INTERVALS = saved_state["BLUR_INTERVALS"]

    def test_voice_timeline_reuses_completed_block_checkpoints(self):
        out_wav = self.root / "voice.wav"
        chunk_dir = self.root / "voice.timeline_chunks"
        chunk_dir.mkdir(parents=True)
        prev_out = tts.OUTPUT_AUDIO
        tts.OUTPUT_AUDIO = str(out_wav)
        try:
            manifest = []
            sig = tts._timeline_manifest_signature(manifest, 650_000, ".wav")
            (chunk_dir / "checkpoint.json").write_text(json.dumps({"signature": sig, "duration_ms": 650_000}), encoding="utf-8")

            # Pre-populate block_00000 (first 600s = 600*44100 frames of valid WAV).
            block0 = chunk_dir / "block_00000.wav"
            with wave.open(str(block0), "wb") as w:
                w.setnchannels(2)
                w.setsampwidth(2)
                w.setframerate(44100)
                w.writeframes(b"\x00" * (600 * 44100 * 4))

            built_windows = []

            original_silent = tts.AudioSegment.silent

            def spy_silent(*args, **kwargs):
                built_windows.append(kwargs.get("duration", args[0] if args else 0))
                return original_silent(*args, **kwargs)

            with patch.object(tts.AudioSegment, "silent", side_effect=spy_silent):
                result_path = Path(tts.build_voice_timeline(manifest, 650_000))

            self.assertEqual(result_path, out_wav)
            self.assertTrue(out_wav.is_file())
            # Only the remaining 50s (Windows 20 & 21) were synthesized, NOT the first 600s!
            self.assertEqual(sum(built_windows), 50_000)
            self.assertFalse(chunk_dir.exists())
        finally:
            tts.OUTPUT_AUDIO = prev_out

    def test_translator_offline_mode_skips_online_preflight_and_uses_local_nllb(self):
        with patch.dict(os.environ, {"REUP_OFFLINE_MODE": "1"}):
            # Must not raise even when OAUTH_CREDENTIALS / API are offline.
            with patch.object(translator, "OAUTH_CREDENTIALS", True):
                translator.ensure_translation_ready()

            with patch.object(
                translator,
                "translate_batch_local",
                return_value=[{"id": 1, "text": "Xin chao"}],
            ) as local_fn:
                translated = translator.translate_batch([{"id": 1, "text": "Hello"}], source_language="en")
            local_fn.assert_called_once()
            self.assertEqual(translated[0]["text"], "Xin chao")
            self.assertEqual(translator._nllb_source_lang("en"), "eng_Latn")
            self.assertEqual(translator._nllb_source_lang("ja"), "jpn_Jpan")

    def test_translator_auto_switches_to_local_nllb_when_offline_without_manual_toggle(self):
        saved_offline = os.environ.pop("REUP_OFFLINE_MODE", None)
        try:
            with patch.dict(os.environ, {"LOCAL_TRANSLATION_FALLBACK": "1"}), \
                 patch.object(translator, "OAUTH_CREDENTIALS", True), \
                 patch.object(translator, "get_credentials", return_value=type("C", (), {"token": "ok"})()), \
                 patch.object(translator, "get_project_id", return_value="proj-1"), \
                 patch.object(translator, "authorized_request", side_effect=translator.requests.RequestException("offline")), \
                 patch.object(translator, "_local_nllb_cached", return_value=True), \
                 patch.object(translator.time, "sleep"):
                translator.ensure_translation_ready()
                self.assertEqual(os.environ.get("REUP_OFFLINE_MODE"), "1")
        finally:
            if saved_offline is None:
                os.environ.pop("REUP_OFFLINE_MODE", None)
            else:
                os.environ["REUP_OFFLINE_MODE"] = saved_offline

    def test_api_download_preserves_non_empty_part_session_on_failure(self):
        folder = self.root / "BV1LongVideo"
        folder.mkdir(parents=True)
        part_file = folder / "source.pending.mp4.part"
        part_file.write_bytes(b"resumable-bytes" * 100)

        request = server.DownloadRequest(
            video_id="BV1LongVideo",
            url="https://www.bilibili.com/video/BV1LongVideo",
        )
        with patch.object(server, "DOWNLOAD_ROOT", self.root), \
             patch.object(server, "ensure_download_space"), \
             patch.object(server, "run_platform_download", side_effect=RuntimeError("network drop")), \
             self.assertRaises(Exception):
            server.api_download(request, local_only=True)

        # Partial download session must still exist on disk after failure.
        self.assertTrue(part_file.is_file())
        self.assertGreater(part_file.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
