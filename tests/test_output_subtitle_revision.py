import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services.output_subtitles import read_cues, staged_revision, validate_cues


class SubtitleRevisionTests(unittest.TestCase):
    def test_subtitle_update_is_committed_only_after_success(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "vietnamese.srt"
            path.write_text("1\n00:00:00,000 --> 00:00:02,000\nCâu cũ\n", encoding="utf-8")
            cues = [{"start": 0.25, "end": 1.75, "text": "Câu đã sửa\nDòng tiếp theo"}]
            with staged_revision(path, cues) as staged:
                self.assertIn("Câu cũ", path.read_text(encoding="utf-8"))
                self.assertEqual(read_cues(staged), cues)
            self.assertEqual(read_cues(path), cues)

    def test_render_failure_keeps_original_subtitle_and_cleans_temporary(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "vietnamese.srt"
            original = "1\n00:00:00,000 --> 00:00:02,000\nGiữ bản cũ\n"
            path.write_text(original, encoding="utf-8")
            with self.assertRaises(RuntimeError), staged_revision(path, [{"start": 0, "end": 1, "text": "Bản mới"}]):
                raise RuntimeError("render failed")
            self.assertEqual(path.read_text(encoding="utf-8"), original)
            self.assertFalse(list(Path(folder).glob(".reviewed-*.srt")))

    def test_revision_regenerates_voice_from_edited_words(self):
        from core import pipeline as runner
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, subtitle, output, voice = [root / name for name in ("source.mp4", "vietnamese.srt", "final.mp4", "voice.wav")]
            source.write_bytes(b"source")
            subtitle.write_text("1\n00:00:00,000 --> 00:00:02,000\nCũ\n", encoding="utf-8")
            output.write_bytes(b"old output")
            spoken = []
            def synth(_source, srt, destination, *_args, **_kwargs):
                spoken.extend(read_cues(srt)); destination.write_bytes(b"new voice")
            def render(*args, **kwargs):
                args[5].write_bytes(b"revised output")
            with patch.object(runner, "get_source_video", return_value=source), patch.object(runner, "create_voice", side_effect=synth), \
                 patch.object(runner, "resolve_subtitle_region", return_value={}), patch.object(runner, "write_progress"), \
                 patch.object(runner, "render_voiceover", side_effect=render):
                runner.rerender_existing_output(url="unused", job_dir=root, mode="voiceover", source_file=str(source),
                    output_path=output, ass_path=root / "sub.ass", region_path=root / "region.json", region_preview=root / "region.png",
                    vietnamese_srt=subtitle, voice_path=voice, original_volume=.15, voice_volume=1,
                    config={"regenerate_voice": True, "revised_subtitles": [{"start": 0, "end": 1, "text": "Lời mới"}]})
            self.assertEqual(spoken[0]["text"], "Lời mới")
            self.assertEqual(read_cues(subtitle)[0]["text"], "Lời mới")
            self.assertEqual(output.read_bytes(), b"revised output")

    def test_empty_or_invalid_cues_are_rejected(self):
        for cues in [[], [{"start": 0, "end": 1, "text": ""}], [{"start": 1, "end": .5, "text": "sai"}]]:
            with self.assertRaises(ValueError): validate_cues(cues)


if __name__ == "__main__": unittest.main()
