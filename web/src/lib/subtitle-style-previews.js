export const SUBTITLE_SAMPLE_LINES = [
    'Chào mừng bạn đến với kênh hôm nay!',
    'Bí quyết làm phụ đề sắc nét chỉ trong 1 phút.',
    'Nhớ bấm theo dõi để xem tập tiếp theo nhé!',
];

export const SUBTITLE_SAMPLE_LINES_BY_LANG = {
    vi: SUBTITLE_SAMPLE_LINES,
    en: [
        'Welcome back to the channel today!',
        'Here is how to create crisp subtitles in 1 minute.',
        "Don't forget to subscribe for the next episode!",
    ],
    zh: [
        '欢迎来到今天的频道！',
        '一分钟教你制作高清双语字幕。',
        '别忘了关注我，下期视频更精彩！',
    ],
    ja: [
        '今日もチャンネルへようこそ！',
        '1分でくっきり見やすい字幕を作るコツ。',
        '次のエピソードもお見逃しなく！',
    ],
    ko: [
        '오늘도 채널에 오신 것을 환영합니다!',
        '1분 만에 선명한 자막을 만드는 비법.',
        '다음 에피소드도 놓치지 말고 구독해 주세요!',
    ],
};

export function sampleLinesForLanguage(targetLanguage = 'vi') {
    const code = String(targetLanguage || 'vi').trim().toLowerCase() || 'vi';
    return SUBTITLE_SAMPLE_LINES_BY_LANG[code] || SUBTITLE_SAMPLE_LINES;
}

// Mirrors the ASS styles rendered in app/services/final_renderer.py.
export const SUBTITLE_STYLE_SPECS = {
    minimal: {
        id: 'minimal',
        label: 'Minimal Clean',
        description: 'Chữ trắng sáng, viền đen mảnh gọn gàng, dễ đọc mọi video.',
    },
    bold: {
        id: 'bold',
        label: 'Creator Bold',
        description: 'Chữ trắng in đậm, viền đen dày nổi bật, hợp review & Shorts.',
    },
    cinema: {
        id: 'cinema',
        label: 'Cinema',
        description: 'Chữ kem ấm dịu mắt, viền mảnh kèm đổ bóng điện ảnh.',
    },
    neon: {
        id: 'neon',
        label: 'Neon Pop',
        description: 'Chữ hồng neon rực rỡ, viền tím đậm tạo điểm nhấn bắt mắt.',
    },
    box: {
        id: 'box',
        label: 'Simple Box',
        description: 'Nền hộp đen bán trong suốt, che phụ đề cũ và đọc rõ trên nền sáng.',
    },
};

export function getSubtitlePreviewData(styleId, fontSizeValue, sampleIndex = 0, targetLanguage = 'vi') {
    const normalizedStyle = Object.prototype.hasOwnProperty.call(SUBTITLE_STYLE_SPECS, styleId)
        ? styleId
        : 'minimal';
    const spec = SUBTITLE_STYLE_SPECS[normalizedStyle];
    const lines = sampleLinesForLanguage(targetLanguage);
    const safeIndex = ((Number(sampleIndex) || 0) % lines.length + lines.length) % lines.length;
    const rawSize = Number(fontSizeValue);
    const previewFontPx = Number.isFinite(rawSize) && rawSize > 0
        ? Math.max(13, Math.min(21, Math.round(rawSize * 0.52)))
        : 16;
    const stageFontPx = Number.isFinite(rawSize) && rawSize > 0
        ? Math.max(16, Math.min(26, Math.round(rawSize * 0.66)))
        : 19;
    return {
        spec,
        lines,
        sampleIndex: safeIndex,
        sampleText: lines[safeIndex],
        previewFontPx,
        stageFontPx,
    };
}
