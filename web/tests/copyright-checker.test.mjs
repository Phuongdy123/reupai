import test from 'node:test';
import assert from 'node:assert/strict';

import {
    analyzeVideoCopyrightRisk,
    checkVideoCopyrightWithEngine,
    riskLabelFromLevel,
} from '../src/lib/copyright-checker.js';

test('analyzeVideoCopyrightRisk flags high music & overall risk for commercial tracks or subtitle-only mode', () => {
    const report = analyzeVideoCopyrightRisk({
        title: 'Official OST MV - Licensed to YouTube by Sony Music (SME)',
        track: 'Idol',
        artist: 'YOASOBI',
        url: 'https://www.bilibili.com/video/BV1xx411c7mD',
        mode: 'subtitle',
        original_volume: 1.0,
    });

    assert.equal(report.music_risk, 'high');
    assert.equal(report.overall_risk, 'high');
    assert.equal(report.badge_label, riskLabelFromLevel('high'));
    assert.ok(report.warnings.some((w) => /Content ID/i.test(w)));
    assert.equal(report.safe_config_patch.mode, 'voiceover');
    assert.equal(report.safe_config_patch.original_volume, 0.05);
});

test('analyzeVideoCopyrightRisk drops risk to low when AI voiceover + 5% original volume + brand blur are enabled', () => {
    const report = analyzeVideoCopyrightRisk({
        title: 'Xuyên không dị giới - Tập 1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        mode: 'voiceover',
        original_volume: 0.05,
        auto_brand_blur: true,
        has_blur_region: true,
        aspect_ratio: '9:16',
    });

    assert.equal(report.music_risk, 'low');
    assert.equal(report.overall_risk, 'low');
    assert.equal(report.badge_label, 'An toàn (Nguy cơ thấp)');
});

test('checkVideoCopyrightWithEngine merges AI deep scan results from Local Engine', async () => {
    const fakeRequestJson = async (path, options) => {
        assert.equal(path, '/api/copyright/check');
        const body = JSON.parse(options.body);
        assert.equal(body.video_id, 'vid_01');
        return {
            overall_risk: 'high',
            overall_score: 88,
            music_risk: 'high',
            music_score: 90,
            visual_risk: 'medium',
            visual_score: 50,
            detected_music: 'Phát hiện nhạc nền thương mại rõ trong 14 giây đầu',
            warnings: ['⚠️ AI phát hiện giai điệu bài hát bản quyền trong âm thanh gốc.'],
            recommendations: ['Hạ âm lượng gốc về 0% và dùng Lồng tiếng AI.'],
            ai_scanned: true,
        };
    };

    const report = await checkVideoCopyrightWithEngine(fakeRequestJson, {
        video_id: 'vid_01',
        title: 'Test video',
        mode: 'voiceover',
        original_volume: 0.15,
    });

    assert.equal(report.ai_scanned, true);
    assert.equal(report.overall_risk, 'high');
    assert.match(report.detected_music, /Phát hiện nhạc nền thương mại/);
});

test('checkVideoCopyrightWithEngine falls back to /api/assistant when Local Engine returns 404 for /api/copyright/check', async () => {
    const calledPaths = [];
    const fakeRequestJson = async (path) => {
        calledPaths.push(path);
        if (path === '/api/copyright/check') {
            const err = new Error('Not Found');
            err.status = 404;
            throw err;
        }
        assert.equal(path, '/api/assistant');
        return {
            answer: 'Video có nhạc nền OST dễ dính Content ID và có logo Tencent ở góc phải.',
        };
    };

    const report = await checkVideoCopyrightWithEngine(fakeRequestJson, {
        video_id: 'vid_02',
        title: 'Phim mới tập 1',
        mode: 'voiceover',
        original_volume: 0.15,
    });

    assert.deepEqual(calledPaths, ['/api/copyright/check', '/api/assistant']);
    assert.equal(report.ai_scanned, true);
    assert.equal(report.music_risk, 'high');
    assert.equal(report.scan_note, 'Đã quét sâu bằng AI Gemini.');
});
