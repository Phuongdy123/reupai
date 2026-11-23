"""Regression tests for v0.2.59/v0.2.60 audit fixes."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

from core import pipeline
from services import final_renderer as renderer
from services import translator, tts
from services.video_urls import normalize_source_url


class V060RegressionTests(unittest.TestCase):
    def test_bilibili_zh_hans_and_zh_hant_urls_are_accepted_and_stripped_for_ytdlp(self):
        url_hans = "https://www.bilibili.com/zh-Hans/video/BV1fwwJz6Ewg/?spm_id_from=333.337.search-card.all.click"
        url_hant = "https://www.bilibili.com/zh-Hant/video/BV1YM4w6fEnd/?p=2&trackid=x"
        self.assertEqual(
            normalize_source_url(url_hans),
            "https://www.bilibili.com/zh-Hans/video/BV1fwwJz6Ewg/",
        )
        self.assertEqual(
            normalize_source_url(url_hant),
            "https://www.bilibili.com/zh-Hant/video/BV1YM4w6fEnd/?p=2",
        )
        cmd_hans = pipeline.build_ytdlp_command(
            "https://www.bilibili.com/zh-Hans/video/BV1fwwJz6Ewg/",
            "out.%(ext)s",
        )
        self.assertEqual(cmd_hans[-1], "https://www.bilibili.com/video/BV1fwwJz6Ewg/")
        cmd_vi = pipeline.build_ytdlp_command(
            "https://www.bilibili.com/vi/video/BV1S7446fEFw/?p=2",
            "out.%(ext)s",
        )
        self.assertEqual(cmd_vi[-1], "https://www.bilibili.com/video/BV1S7446fEFw/?p=2")

    def test_translator_429_cooldown_is_temporary_while_404_is_permanent(self):
        temp_model = "gemini-temp-429-fixture"
        perm_model = "gemini-perm-404-fixture"
        try:
            translator._mark_model_exhausted(temp_model, ttl=45, permanent=False)
            self.assertNotIn(temp_model, translator.DISABLED_MODELS)
            self.assertTrue(translator._is_model_exhausted(temp_model))

            translator._mark_model_exhausted(perm_model, ttl=900, permanent=True)
            self.assertIn(perm_model, translator.DISABLED_MODELS)
            self.assertTrue(translator._is_model_exhausted(perm_model))
        finally:
            translator.DISABLED_MODELS.discard(temp_model)
            translator.DISABLED_MODELS.discard(perm_model)
            with translator._MODEL_COOLDOWN_LOCK:
                translator._MODEL_COOLDOWN_UNTIL.pop(temp_model, None)
                translator._MODEL_COOLDOWN_UNTIL.pop(perm_model, None)

    def test_translator_checkpoint_recovers_from_backup_when_primary_corrupt(self):
        with tempfile.TemporaryDirectory() as tmp:
            ckpt = Path(tmp) / "translation_checkpoint.json"
            bak = Path(tmp) / "translation_checkpoint.json.bak"
            ckpt.write_text("{broken-json", encoding="utf-8")
            bak.write_text(
                json.dumps(
                    {
                        "source_hash": "hash123",
                        "target_language": "vi",
                        "translations": [
                            {
                                "id": 1,
                                "start": "00:00:00,000",
                                "end": "00:00:01,000",
                                "original_text": "你好",
                                "translated_text": "Xin chào từ bản sao lưu",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            orig = translator.CHECKPOINT_FILE
            try:
                translator.CHECKPOINT_FILE = str(ckpt)
                recovered = translator.load_checkpoint("hash123", target_language="vi")
                self.assertEqual(len(recovered), 1)
                self.assertEqual(recovered[0]["translated_text"], "Xin chào từ bản sao lưu")
            finally:
                translator.CHECKPOINT_FILE = orig

    def test_renderer_filter_order_delogo_before_hflip_and_outro_cta_after_9_16_crop(self):
        with tempfile.TemporaryDirectory() as tmp:
            ass = Path(tmp) / "sub.ass"
            ass.write_text("[Events]\n", encoding="utf-8")
            region = {
                "video": {"width": 1920, "height": 1080},
                "blur": {"x": 100, "y": 900, "width": 1720, "height": 120},
                "blur_enabled": True,
                "subtitle": {"x": 960, "y": 950, "max_width": 1600},
            }
            saved = {
                "ASS_PATH": renderer.ASS_PATH,
                "BLUR_MODE": renderer.BLUR_MODE,
                "ANTI_REUSE_ENABLED": renderer.ANTI_REUSE_ENABLED,
                "ANTI_REUSE_SPEED": renderer.ANTI_REUSE_SPEED,
                "ANTI_REUSE_MIRROR": renderer.ANTI_REUSE_MIRROR,
                "ANTI_REUSE_COLOR": renderer.ANTI_REUSE_COLOR,
                "OUTPUT_ASPECT_RATIO": renderer.OUTPUT_ASPECT_RATIO,
                "OUTRO_CTA_ENABLED": renderer.OUTRO_CTA_ENABLED,
                "OUTRO_CTA_TEXT": renderer.OUTRO_CTA_TEXT,
                "OUTRO_CTA_START": renderer.OUTRO_CTA_START,
                "SECONDARY_SUB_REGION": renderer.SECONDARY_SUB_REGION,
                "SECONDARY_SUB_BLUR": renderer.SECONDARY_SUB_BLUR,
                "BLUR_INTERVALS": renderer.BLUR_INTERVALS,
            }
            try:
                renderer.ASS_PATH = str(ass)
                renderer.BLUR_MODE = "delogo"
                renderer.ANTI_REUSE_ENABLED = True
                renderer.ANTI_REUSE_SPEED = 1.03
                renderer.ANTI_REUSE_MIRROR = True
                renderer.ANTI_REUSE_COLOR = True
                renderer.OUTPUT_ASPECT_RATIO = "shorts"
                renderer.OUTRO_CTA_ENABLED = True
                renderer.OUTRO_CTA_TEXT = "Đăng ký kênh!"
                renderer.OUTRO_CTA_START = 120.0
                renderer.SECONDARY_SUB_REGION = {"x": 0.1, "y": 0.05, "width": 0.8, "height": 0.08}
                renderer.SECONDARY_SUB_BLUR = True
                renderer.BLUR_INTERVALS = []

                vf = renderer.build_video_filter(region)
                delogo_pos = vf.find("delogo=")
                sec_pos = vf.find("[sec_sub_out]")
                hflip_pos = vf.find("hflip")
                resize_pos = vf.find("[resized]")
                cta_pos = vf.find("drawbox=")
                setpts_pos = vf.find("setpts=PTS/")

                self.assertGreater(delogo_pos, -1)
                self.assertGreater(sec_pos, delogo_pos)
                self.assertGreater(hflip_pos, sec_pos)
                self.assertGreater(resize_pos, hflip_pos)
                self.assertGreater(cta_pos, resize_pos)
                self.assertGreater(setpts_pos, cta_pos)
            finally:
                for key, value in saved.items():
                    setattr(renderer, key, value)

    def test_checkpoint_signature_changes_when_blur_mode_or_anti_reuse_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            vid = Path(tmp) / "source.mp4"
            ass = Path(tmp) / "sub.ass"
            vid.write_bytes(b"0" * 2048)
            ass.write_text("[Events]\n", encoding="utf-8")
            region = {"video": {"width": 1280, "height": 720}, "blur": {"x": 0, "y": 600, "width": 1280, "height": 100}}
            saved = {
                "VIDEO_PATH": renderer.VIDEO_PATH,
                "ASS_PATH": renderer.ASS_PATH,
                "BLUR_MODE": renderer.BLUR_MODE,
                "ANTI_REUSE_ENABLED": renderer.ANTI_REUSE_ENABLED,
                "OUTRO_CTA_ENABLED": renderer.OUTRO_CTA_ENABLED,
            }
            try:
                renderer.VIDEO_PATH = str(vid)
                renderer.ASS_PATH = str(ass)
                renderer.BLUR_MODE = "blur"
                renderer.ANTI_REUSE_ENABLED = False
                renderer.OUTRO_CTA_ENABLED = False
                sig_base = renderer._render_checkpoint_signature(region, "subtitle", False, False, False)

                renderer.BLUR_MODE = "delogo"
                sig_delogo = renderer._render_checkpoint_signature(region, "subtitle", False, False, False)
                self.assertNotEqual(sig_base, sig_delogo)

                renderer.ANTI_REUSE_ENABLED = True
                sig_ar = renderer._render_checkpoint_signature(region, "subtitle", False, False, False)
                self.assertNotEqual(sig_delogo, sig_ar)
            finally:
                for key, value in saved.items():
                    setattr(renderer, key, value)

    def test_storage_check_reclaims_stale_preview_wavs_and_supports_long_flac_videos(self):
        with tempfile.TemporaryDirectory() as tmp:
            job_dir = Path(tmp) / "job"
            job_dir.mkdir()
            source = job_dir / "source.mp4"
            source.write_bytes(b"x" * (280 * 1024))
            audio = job_dir / "source_16k.wav"
            audio.write_bytes(b"a" * 2048)
            stale_preview = job_dir / ".transcript-preview-deadbeef.wav"
            stale_preview.write_bytes(b"p" * 4096)
            old_ts = time.time() - 600
            os.utime(stale_preview, (old_ts, old_ts))

            # 8-hour video (28800s) must NOT raise the old 6-hour WAV limit when
            # disk space is sufficient for FLAC voice timeline + render.
            probe = SimpleNamespace(stdout="28800.0\n", returncode=0)
            fake_usage = SimpleNamespace(total=100 * 1024**3, used=50 * 1024**3, free=50 * 1024**3)
            with patch.object(pipeline.subprocess, "run", return_value=probe), \
                 patch.object(pipeline.shutil, "disk_usage", return_value=fake_usage):
                pipeline.check_processing_storage(
                    source,
                    job_dir,
                    audio,
                    "voiceover",
                    voice_path=job_dir / "voice.flac",
                )
            self.assertFalse(stale_preview.exists())

    def test_pipeline_resets_global_translator_and_tts_state_on_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src_srt = root / "chinese.srt"
            src_srt.write_text("1\n00:00:00,000 --> 00:00:01,000\n你好\n", encoding="utf-8")
            out_srt = root / "vietnamese.srt"
            with patch.object(translator, "translate_all", side_effect=RuntimeError("boom")):
                with self.assertRaisesRegex(RuntimeError, "boom"):
                    pipeline.translate_srt(
                        "job1",
                        src_srt,
                        out_srt,
                        root / "ckpt.json",
                        root / "debug.json",
                        glossary="林凡 => Lâm Phàm",
                        on_progress=lambda d, t: None,
                    )
            self.assertIsNone(translator.PROGRESS_CALLBACK)
            self.assertEqual(translator.GLOSSARY_TEXT, "")

            vi_srt = root / "vi.srt"
            vi_srt.write_text("1\n00:00:00,000 --> 00:00:01,000\nXin chào\n", encoding="utf-8")
            src_vid = root / "source.mp4"
            src_vid.write_bytes(b"v" * 2048)
            with patch.object(tts, "create_tts_clips", side_effect=RuntimeError("tts-boom")):
                with self.assertRaisesRegex(RuntimeError, "tts-boom"):
                    pipeline.create_voice(
                        src_vid,
                        vi_srt,
                        root / "voice.wav",
                        root / "tts",
                        root / "manifest.json",
                        speed=1.35,
                        secondary_voice="Nam Minh",
                    )
            self.assertIsNone(tts.SECONDARY_VOICE)
            self.assertEqual(tts.BASE_TTS_SPEED, 1.0)

    def test_local_engine_media_ticket_prefixes_and_seo_trends_without_account(self):
        import local_engine
        from fastapi.testclient import TestClient

        with tempfile.TemporaryDirectory() as tmp:
            grants_path = Path(tmp) / "grants.json"
            sessions_before = dict(local_engine._browser_sessions)
            try:
                with patch.object(local_engine, "AUTH_GRANTS_PATH", grants_path):
                    origin = "https://www.reupai.cloud"
                    auth = local_engine.connect_authorization({"client_origin": origin}, origin=origin)
                    headers = {
                        "Authorization": f"Bearer {auth['session_token']}",
                        "Origin": origin,
                    }
                    client = TestClient(local_engine.app)
                    for path in (
                        "/api/shorts/file/default/BV123/short_1.mp4",
                        "/api/series/file/default/ep1.mp4",
                        "/api/music/preset/chill",
                    ):
                        resp = client.post("/api/media/tickets", json={"path": path}, headers=headers)
                        self.assertEqual(resp.status_code, 200, f"Rejected valid media path {path}: {resp.text}")
                        self.assertTrue(str(resp.json().get("url", "")).startswith("/api/media/"))

                    with patch("services.youtube_seo.analyze_youtube_seo_trends", return_value={"ok": True, "keywords": ["câu cá"]}):
                        resp = client.post("/api/youtube/seo-trends", json={"query": "câu cá"}, headers=headers)
                        self.assertEqual(resp.status_code, 200, resp.text)
                        self.assertEqual(resp.json().get("keywords"), ["câu cá"])
            finally:
                local_engine._browser_sessions.clear()
                local_engine._browser_sessions.update(sessions_before)


if __name__ == "__main__":
    unittest.main()
