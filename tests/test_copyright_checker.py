import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

from services.copyright_checker import analyze_heuristic_copyright_risk, check_video_copyright


def test_high_risk_when_record_label_or_commercial_music_and_subtitle_only():
    report = analyze_heuristic_copyright_risk(
        title="Official MV - Licensed to YouTube by Sony Music Entertainment (SME)",
        description="Provided to YouTube by UMG",
        url="https://www.youtube.com/watch?v=abc123xyz00",
        mode="subtitle",
        original_volume=1.0,
        track="Shape of You",
        artist="Ed Sheeran",
    )
    assert report["music_risk"] == "high"
    assert report["overall_risk"] == "high"
    assert any("Content ID" in w for w in report["warnings"])
    assert report["safe_config_patch"]["mode"] == "voiceover"
    assert report["safe_config_patch"]["original_volume"] <= 0.08


def test_low_risk_when_voiceover_ducks_original_audio_and_blurs_logo():
    report = check_video_copyright(
        title="Tập 1: Xuyên không làm thần thuyết minh",
        description="Truyện hoạt hình",
        url="https://www.youtube.com/watch?v=abc123xyz00",
        mode="voiceover",
        original_volume=0.05,
        auto_brand_blur=True,
        has_blur_region=True,
        use_ai=False,
    )
    assert report["music_risk"] == "low"
    assert report["overall_risk"] == "low"
