const RECORD_LABEL_REGEX = /\b(?:SME|Sony Music|UMG|Universal Music|WMG|Warner Music|BMG|EMI|Avex|Pony Canyon|King Records|Lantis|Aniplex|Tencent Music|TME|NetEase Cloud Music|QQ Music|Kugou|Kuwo|滾石|相信音樂|華研|JVR Music|Licensed to YouTube by|Provided to YouTube by|Official MV|Official Music Video|Official Audio|Lyric Video|Full OST|Original Soundtrack)\b/i;

const STUDIO_VISUAL_REGEX = /\b(?:Tencent Video|腾讯视频|iQIYI|爱奇艺|Youku|优酷|MangoTV|芒果TV|哔哩哔哩独家|Netflix|Disney\+|HBO|TVB|Full Movie|Phim lẻ|Phim bộ bản quyền|Official Trailer)\b/i;

const MUSIC_KEYWORD_REGEX = /(?:\b(?:mv|ost|soundtrack|remix|cover|dj|edm|bgm|nhạc trẻ|nhạc hoa|nhạc nền|抖音神曲|op|ed|opening|ending)\b|♫|♪|🎵|🎶|🎧)/i;

export function riskLabelFromLevel(level) {
    if (level === 'high') return '🔴 Nguy cơ Bản quyền cao';
    if (level === 'medium') return '🟡 Lưu ý Bản quyền';
    return '🟢 An toàn (Nguy cơ thấp)';
}

export function analyzeVideoCopyrightRisk({
    title = '',
    description = '',
    url = '',
    track = '',
    artist = '',
    license = '',
    mode = 'voiceover',
    original_volume = 0.15,
    music_url = '',
    auto_brand_blur = false,
    has_blur_region = false,
    aspect_ratio = '',
} = {}) {
    const combinedText = [title, description, track, artist].filter(Boolean).join('\n');

    let musicScore = 15;
    let visualScore = 15;
    const musicReasons = [];
    const visualReasons = [];
    const warnings = [];
    const recommendations = [];

    if (track && !/(?:original sound|nhạc nền gốc|âm thanh gốc|原声)/i.test(track)) {
        musicScore += 50;
        musicReasons.push(`Phát hiện bản nhạc đính kèm: “${track}”${artist ? ` - ${artist}` : ''}.`);
    }

    const labelMatch = combinedText.match(RECORD_LABEL_REGEX);
    if (labelMatch) {
        musicScore += 55;
        musicReasons.push(`Phát hiện dấu hiệu bản quyền âm nhạc / hãng đĩa (“${labelMatch[0]}”).`);
    }

    const musicKwMatch = combinedText.match(MUSIC_KEYWORD_REGEX);
    if (musicKwMatch) {
        musicScore += 25;
        musicReasons.push(`Tiêu đề/mô tả chứa từ khóa âm nhạc hoặc OST (“${musicKwMatch[0]}”).`);
    }

    if (music_url && String(music_url).trim()) {
        musicScore += 22;
        musicReasons.push('Đang chèn thêm link nhạc nền ngoài — cần đảm bảo nhạc không bị đánh Content ID.');
    }

    if (license && /creative commons/i.test(license)) {
        musicScore = Math.max(10, musicScore - 25);
        visualScore = Math.max(10, visualScore - 25);
    }

    const studioMatch = combinedText.match(STUDIO_VISUAL_REGEX);
    if (studioMatch) {
        visualScore += 42;
        visualReasons.push(`Nguồn có dấu hiệu phim / hoạt hình / đài lớn (“${studioMatch[0]}”).`);
    }

    const lowerUrl = String(url || '').toLowerCase();
    if (['bilibili.com', 'b23.tv', 'douyin.com', 'iqiyi.com', 'qq.com', 'youku.com', 'xiaohongshu.com', 'xhslink.com'].some((h) => lowerUrl.includes(h))) {
        visualScore += 18;
        visualReasons.push('Video từ nền tảng Bilibili/Douyin/RedNote thường có logo góc hoặc nhạc nền BGM dễ trùng Content ID.');
    }

    const isSubtitleOnly = String(mode || '').toLowerCase() === 'subtitle';
    const parsedVol = Number(original_volume);
    const origVol = Number.isFinite(parsedVol) ? parsedVol : (isSubtitleOnly ? 1.0 : 0.15);

    if (isSubtitleOnly) {
        musicScore += 36;
        warnings.push(
            'Bạn đang chọn chế độ “Chỉ Phụ đề (Sub)” — giữ nguyên 100% âm thanh & nhạc gốc nên rất dễ bị YouTube quét trúng Content ID âm nhạc.',
        );
        recommendations.push(
            'Chuyển sang “Voice + Phụ đề (Lồng tiếng AI)” và hạ Âm lượng gốc xuống 0% – 8% để xóa dấu vân tay âm thanh (Audio Fingerprint).',
        );
    } else if (origVol > 0.2) {
        musicScore += 24;
        warnings.push(
            `Âm lượng gốc đang để khá cao (${Math.round(origVol * 100)}%) — YouTube vẫn có thể nhận diện được nhạc nền phía sau giọng đọc.`,
        );
        recommendations.push(
            'Hạ “Âm lượng gốc” xuống dưới 8% (hoặc 0% nếu video gốc có nhạc bản quyền mạnh).',
        );
    } else {
        musicScore = Math.max(10, musicScore - 30);
        musicReasons.push(
            `Đã bật Lồng tiếng AI và hạ âm lượng gốc xuống ${Math.round(origVol * 100)}% (giảm mạnh nguy cơ dính bản quyền nhạc).`,
        );
    }

    if (!auto_brand_blur && !has_blur_region) {
        visualScore += 15;
        recommendations.push(
            'Bật “Làm mờ watermark/logo” hoặc khoanh vùng mờ đè lên logo gốc để tránh trùng khớp hình ảnh.',
        );
    } else {
        visualScore = Math.max(10, visualScore - 15);
        visualReasons.push('Đã bật làm mờ vùng phụ đề / logo nguồn.');
    }

    if (aspect_ratio) {
        visualScore = Math.max(10, visualScore - 8);
    }

    musicScore = Math.min(98, Math.max(5, musicScore));
    visualScore = Math.min(98, Math.max(5, visualScore));
    const overallScore = Math.round(Math.max(musicScore, visualScore) * 0.7 + Math.min(musicScore, visualScore) * 0.3);

    const levelOf = (score) => {
        if (score >= 65) return 'high';
        if (score >= 38) return 'medium';
        return 'low';
    };

    const musicRisk = levelOf(musicScore);
    const visualRisk = levelOf(visualScore);
    const overallRisk = levelOf(overallScore);

    if (musicRisk === 'high') {
        warnings.unshift('⚠️ Cảnh báo: Nguy cơ cao dính bản quyền Âm nhạc (YouTube Content ID Audio Claim).');
    }
    if (visualRisk === 'high') {
        warnings.push('⚠️ Cảnh báo: Hình ảnh video có nguy cơ trùng bản quyền phim/chương trình hoặc chứa logo nhà đài.');
    }
    if (!warnings.length && overallRisk === 'medium') {
        warnings.push('Lưu ý: Video có khả năng chứa nhạc nền BGM hoặc logo gốc. Nên dùng Lồng tiếng AI + hạ âm gốc ≤ 8%.');
    }
    if (!recommendations.length) {
        recommendations.push('Cấu hình hiện tại đã tối ưu tốt để giảm rủi ro bản quyền YouTube.');
    }

    return {
        overall_risk: overallRisk,
        overall_score: overallScore,
        music_risk: musicRisk,
        music_score: musicScore,
        visual_risk: visualRisk,
        visual_score: visualScore,
        badge_label: riskLabelFromLevel(overallRisk),
        detected_music: track
            ? `${track}${artist ? ` - ${artist}` : ''}`
            : (musicScore >= 45 ? 'Phát hiện dấu hiệu nhạc nền / OST cần lưu ý' : 'Chưa phát hiện nhạc thương mại rủi ro cao'),
        music_reasons: musicReasons.length ? musicReasons : ['Chưa phát hiện dấu hiệu nhạc bản quyền trong thông tin nguồn.'],
        visual_reasons: visualReasons.length ? visualReasons : ['Hình ảnh ở mức rủi ro thông thường.'],
        warnings,
        recommendations,
        ai_scanned: false,
        safe_config_patch: {
            mode: 'voiceover',
            original_volume: 0.05,
            voice_volume: 1.15,
            auto_brand_blur: true,
        },
    };
}

export async function checkVideoCopyrightWithEngine(requestJson, payload = {}) {
    const localReport = analyzeVideoCopyrightRisk(payload);
    if (typeof requestJson !== 'function') {
        return localReport;
    }
    try {
        const remote = await requestJson('/api/copyright/check', {
            method: 'POST',
            timeoutMs: 55000,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...payload,
                use_ai: payload.use_ai !== false,
            }),
        });
        if (!remote || typeof remote !== 'object') {
            return localReport;
        }
        const overallRisk = remote.overall_risk || localReport.overall_risk;
        return {
            ...localReport,
            ...remote,
            overall_risk: overallRisk,
            badge_label: riskLabelFromLevel(overallRisk),
        };
    } catch {
        return localReport;
    }
}
