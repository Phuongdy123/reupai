export const SUBTITLE_SAMPLE_LINES = [
    'Chào mừng bạn đến với kênh hôm nay!',
    'Bí quyết làm phụ đề sắc nét chỉ trong 1 phút.',
    'Nhớ bấm theo dõi để xem tập tiếp theo nhé!',
];

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

export function getSubtitlePreviewData(styleId, fontSizeValue, sampleIndex = 0) {
    const normalizedStyle = Object.prototype.hasOwnProperty.call(SUBTITLE_STYLE_SPECS, styleId)
        ? styleId
        : 'minimal';
    const spec = SUBTITLE_STYLE_SPECS[normalizedStyle];
    const safeIndex = ((Number(sampleIndex) || 0) % SUBTITLE_SAMPLE_LINES.length + SUBTITLE_SAMPLE_LINES.length) % SUBTITLE_SAMPLE_LINES.length;
    const rawSize = Number(fontSizeValue);
    const previewFontPx = Number.isFinite(rawSize) && rawSize > 0
        ? Math.max(13, Math.min(21, Math.round(rawSize * 0.52)))
        : 16;
    const stageFontPx = Number.isFinite(rawSize) && rawSize > 0
        ? Math.max(16, Math.min(26, Math.round(rawSize * 0.66)))
        : 19;
    return {
        spec,
        sampleIndex: safeIndex,
        sampleText: SUBTITLE_SAMPLE_LINES[safeIndex],
        previewFontPx,
        stageFontPx,
    };
}
