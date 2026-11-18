const RECORD_LABEL_REGEX = /\b(?:SME|Sony Music|UMG|Universal Music|WMG|Warner Music|BMG|EMI|Avex|Pony Canyon|King Records|Lantis|Aniplex|Tencent Music|TME|NetEase Cloud Music|QQ Music|Kugou|Kuwo|滾石|相信音樂|華研|JVR Music|Licensed to YouTube by|Provided to YouTube by|Official MV|Official Music Video|Official Audio|Lyric Video|Full OST|Original Soundtrack)\b/i;

const STUDIO_VISUAL_REGEX = /\b(?:Tencent Video|腾讯视频|iQIYI|爱奇艺|Youku|优酷|MangoTV|芒果TV|哔哩哔哩独家|Netflix|Disney\+|HBO|TVB|Full Movie|Phim lẻ|Phim bộ bản quyền|Official Trailer)\b/i;

const MUSIC_KEYWORD_REGEX = /(?:\b(?:mv|ost|soundtrack|remix|cover|dj|edm|bgm|nhạc trẻ|nhạc hoa|nhạc nền|抖音神曲|op|ed|opening|ending)\b|♫|♪|🎵|🎶|🎧)/i;

export function riskLabelFromLevel(level) {
    if (level === 'high') return 'Nguy cơ Bản quyền cao';
    if (level === 'medium') return 'Lưu ý Bản quyền';
    return 'An toàn (Nguy cơ thấp)';
}

export function copyrightIconSvg(name, size = 14) {
    const attrs = `viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
    if (name === 'shield') {
        return `<svg ${attrs}><path d="M12 3l7 3v6c0 5-3.5 8.5-7 9.5C8.5 20.5 5 17 5 12V6l7-3z"/><path d="M9.5 12l1.8 1.8 3.7-3.8"/></svg>`;
    }
    if (name === 'music') {
        return `<svg ${attrs}><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>`;
    }
    if (name === 'film') {
        return `<svg ${attrs}><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4"/></svg>`;
    }
    if (name === 'scan') {
        return `<svg ${attrs}><path d="M4 8V6a2 2 0 0 1 2-2h2M4 16v2a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v2M16 20h2a2 2 0 0 0 2-2v-2"/><circle cx="12" cy="12" r="3"/></svg>`;
    }
    if (name === 'sliders') {
        return `<svg ${attrs}><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></svg>`;
    }
    if (name === 'folder') {
        return `<svg ${attrs}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>`;
    }
    if (name === 'swap') {
        return `<svg ${attrs}><path d="M7 10l-3-3 3-3"/><path d="M4 7h13a3 3 0 0 1 3 3v1"/><path d="M17 14l3 3-3 3"/><path d="M20 17H7a3 3 0 0 1-3-3v-1"/></svg>`;
    }
    if (name === 'bolt') {
        return `<svg ${attrs}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>`;
    }
    return `<svg ${attrs}><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`;
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
        warnings.unshift('Cảnh báo: Nguy cơ cao dính bản quyền Âm nhạc (YouTube Content ID Audio Claim).');
    }
    if (visualRisk === 'high') {
        warnings.push('Cảnh báo: Hình ảnh video có nguy cơ trùng bản quyền phim/chương trình hoặc chứa logo nhà đài.');
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

const FINGERPRINT_STORAGE_KEY = 'reupai:copyright-fingerprint-config';

export function readCopyrightFingerprintConfig(storage = globalThis?.localStorage) {
    try {
        const raw = storage?.getItem?.(FINGERPRINT_STORAGE_KEY);
        if (!raw) return { provider: 'audd', auddApiToken: '', acrcloudHost: '', acrcloudAccessKey: '', acrcloudAccessSecret: '' };
        const parsed = JSON.parse(raw);
        return {
            provider: parsed?.provider === 'acrcloud' ? 'acrcloud' : 'audd',
            auddApiToken: String(parsed?.auddApiToken || '').trim(),
            acrcloudHost: String(parsed?.acrcloudHost || '').trim(),
            acrcloudAccessKey: String(parsed?.acrcloudAccessKey || '').trim(),
            acrcloudAccessSecret: String(parsed?.acrcloudAccessSecret || '').trim(),
        };
    } catch {
        return { provider: 'audd', auddApiToken: '', acrcloudHost: '', acrcloudAccessKey: '', acrcloudAccessSecret: '' };
    }
}

export function writeCopyrightFingerprintConfig(storage = globalThis?.localStorage, config = {}) {
    const normalized = {
        provider: config?.provider === 'acrcloud' ? 'acrcloud' : 'audd',
        auddApiToken: String(config?.auddApiToken || '').trim(),
        acrcloudHost: String(config?.acrcloudHost || '').trim(),
        acrcloudAccessKey: String(config?.acrcloudAccessKey || '').trim(),
        acrcloudAccessSecret: String(config?.acrcloudAccessSecret || '').trim(),
    };
    try {
        storage?.setItem?.(FINGERPRINT_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        // ignore storage quota errors
    }
    return normalized;
}

export function hasFingerprintCredentials(cfg = readCopyrightFingerprintConfig()) {
    if (!cfg) return false;
    if (cfg.provider === 'acrcloud') {
        return Boolean(cfg.acrcloudHost && cfg.acrcloudAccessKey && cfg.acrcloudAccessSecret);
    }
    return Boolean(cfg.auddApiToken || (cfg.acrcloudHost && cfg.acrcloudAccessKey && cfg.acrcloudAccessSecret));
}

async function fetchMediaClipBlob(mediaUrl) {
    if (!mediaUrl || typeof fetch !== 'function') return null;
    try {
        const resp = await fetch(mediaUrl, {
            headers: { Range: 'bytes=0-2200000' },
        });
        if (!resp.ok && resp.status !== 206) return null;
        const blob = await resp.blob();
        if (!blob || !blob.size) return null;
        return blob.size > 3.5 * 1024 * 1024 ? blob.slice(0, 3.5 * 1024 * 1024, blob.type || 'video/mp4') : blob;
    } catch {
        return null;
    }
}

export async function recognizeAudioFingerprint(clipBlob, cfg = readCopyrightFingerprintConfig()) {
    if (!clipBlob || typeof fetch !== 'function' || !hasFingerprintCredentials(cfg)) {
        return null;
    }
    const form = new FormData();
    form.append('provider', cfg.provider || 'audd');
    if (cfg.auddApiToken) form.append('audd_api_token', cfg.auddApiToken);
    if (cfg.acrcloudHost) form.append('acrcloud_host', cfg.acrcloudHost);
    if (cfg.acrcloudAccessKey) form.append('acrcloud_access_key', cfg.acrcloudAccessKey);
    if (cfg.acrcloudAccessSecret) form.append('acrcloud_access_secret', cfg.acrcloudAccessSecret);
    form.append('file', clipBlob, 'sample.mp4');

    const resp = await fetch('/api/copyright/recognize', {
        method: 'POST',
        body: form,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || 'Không thể nhận diện nhạc từ đoạn âm thanh.');
    }
    return data.matched && data.track ? data.track : { matched: false, provider: data.provider || cfg.provider };
}

export async function checkVideoCopyrightWithEngine(requestJson, payload = {}) {
    const localReport = analyzeVideoCopyrightRisk(payload);
    const fpConfig = payload.fingerprintConfig || readCopyrightFingerprintConfig();
    if (typeof requestJson !== 'function') {
        return {
            ...localReport,
            scan_note: 'Chưa kết nối Local Engine nên chỉ phân tích nhanh từ thông tin nguồn.',
        };
    }

    const mergeRemoteReport = (remote, fallbackNote = '') => {
        const overallRisk = remote.overall_risk || localReport.overall_risk;
        return {
            ...localReport,
            ...remote,
            overall_risk: overallRisk,
            badge_label: riskLabelFromLevel(overallRisk),
            scan_note: remote.scan_note || fallbackNote || (remote.ai_scanned ? 'Đã quét sâu Nhạc & Hình bằng AI.' : ''),
        };
    };

    try {
        const remote = await requestJson('/api/copyright/check', {
            method: 'POST',
            timeoutMs: 55000,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...payload,
                use_ai: payload.use_ai !== false,
                audd_api_token: fpConfig.auddApiToken || undefined,
                acrcloud_host: fpConfig.acrcloudHost || undefined,
                acrcloud_access_key: fpConfig.acrcloudAccessKey || undefined,
                acrcloud_access_secret: fpConfig.acrcloudAccessSecret || undefined,
            }),
        });
        if (remote && typeof remote === 'object') {
            return mergeRemoteReport(remote);
        }
    } catch (error) {
        const status = Number(error?.status || 0);
        const isMissingRoute = status === 404 || /not found/i.test(String(error?.message || ''));
        if (!isMissingRoute) {
            return {
                ...localReport,
                scan_note: `Không quét AI được (${error?.message || 'lỗi kết nối Engine'}) — đang hiển thị đánh giá nhanh.`,
            };
        }
    }

    // Fallback for Local Engine 0.2.55:
    // 1) Audio Fingerprinting via /api/copyright/recognize (AudD / ACRCloud) if configured & media clip available
    let recognizedTrack = null;
    let fingerprintNote = '';
    if (hasFingerprintCredentials(fpConfig)) {
        const clipBlob = payload.audio_clip_blob || (payload.preview_url ? await fetchMediaClipBlob(payload.preview_url) : null);
        if (clipBlob) {
            try {
                const fpRes = await recognizeAudioFingerprint(clipBlob, fpConfig);
                if (fpRes && fpRes.title) {
                    recognizedTrack = fpRes;
                } else {
                    fingerprintNote = 'Đã dò vân tay âm thanh: chưa thấy trùng bài hát thương mại trong đoạn đầu.';
                }
            } catch (fpErr) {
                fingerprintNote = `Lỗi dò nhạc (${fpErr?.message || 'AudD/ACRCloud'}).`;
            }
        } else {
            fingerprintNote = 'Hãy bấm "Tải video để xem trước" trước để cắt âm thanh dò chính xác tên bài hát.';
        }
    }

    let enrichedReport = { ...localReport };
    if (recognizedTrack) {
        const labelSuffix = recognizedTrack.label ? ` · Hãng: ${recognizedTrack.label}` : '';
        const detectedStr = `${recognizedTrack.title} — ${recognizedTrack.artist || 'Chưa rõ nghệ sĩ'}${labelSuffix}`;
        const majorLabel = Boolean(recognizedTrack.label && /(?:Sony|Universal|Warner|SME|UMG|WMG|EMI|BMG|Believe|Tencent|NetEase|Avex|Pony Canyon|Lantis|Aniplex|JVR)/i.test(recognizedTrack.label));
        const highOrig = payload.mode === 'subtitle' || Number(payload.original_volume ?? 0.15) > 0.12;
        const musicScore = highOrig ? (majorLabel ? 92 : 84) : (majorLabel ? 46 : 35);
        const musicRisk = musicScore >= 65 ? 'high' : musicScore >= 38 ? 'medium' : 'low';
        const overallScore = Math.round(Math.max(musicScore, localReport.visual_score) * 0.7 + Math.min(musicScore, localReport.visual_score) * 0.3);
        const overallRisk = overallScore >= 65 ? 'high' : overallScore >= 38 ? 'medium' : 'low';
        const trackWarning = highOrig
            ? `Phát hiện bài hát bản quyền: "${recognizedTrack.title}" - ${recognizedTrack.artist || 'Chưa rõ'}${labelSuffix}. Rất dễ dính YouTube Content ID!`
            : `Nhận diện được nhạc: "${recognizedTrack.title}" - ${recognizedTrack.artist || 'Chưa rõ'}${labelSuffix}. Đã giảm âm gốc nhưng vẫn nên giữ ≤ 5%.`;
        enrichedReport = {
            ...localReport,
            recognized_track: recognizedTrack,
            music_score: musicScore,
            music_risk: musicRisk,
            overall_score: overallScore,
            overall_risk: overallRisk,
            badge_label: riskLabelFromLevel(overallRisk),
            detected_music: detectedStr,
            warnings: [trackWarning, ...localReport.warnings.filter((w) => w !== trackWarning)].slice(0, 4),
            ai_scanned: true,
            scan_note: `Đã nhận diện nhạc (${recognizedTrack.provider?.toUpperCase() || 'Audio Fingerprint'}).`,
        };
    }

    // 2) Gemini visual + context check via /api/assistant (available on Engine 0.2.55)
    try {
        const promptLines = [
            'Hãy kiểm tra chuyên sâu bản quyền YouTube Content ID cả ÂM NHẠC và HÌNH ẢNH VIDEO cho video này (trả lời ngắn gọn bằng tiếng Việt):',
            `- Tiêu đề: ${String(payload.title || '').slice(0, 180)}`,
            recognizedTrack ? `- Bài hát nhận diện từ âm thanh: ${recognizedTrack.title} - ${recognizedTrack.artist} (Hãng: ${recognizedTrack.label || 'Chưa rõ'})` : '',
            payload.track ? `- Nhạc/Track nguồn: ${String(payload.track).slice(0, 120)}` : '',
            payload.artist ? `- Nghệ sĩ: ${String(payload.artist).slice(0, 100)}` : '',
            payload.url ? `- Nguồn: ${String(payload.url).slice(0, 180)}` : '',
            `- Chế độ xử lý dự kiến: ${payload.mode === 'subtitle' ? 'Chỉ Phụ đề (giữ tiếng gốc)' : 'Voice + Phụ đề'}`,
            `- Âm lượng gốc: ${Math.round(Number(payload.original_volume ?? 0.15) * 100)}%`,
            `- Làm mờ watermark/logo: ${payload.auto_brand_blur || payload.has_blur_region ? 'Có' : 'Chưa bật'}`,
            'Hãy phân tích kỹ 3 phần: (1) Nguy cơ bản quyền Nhạc nền / OST; (2) Nguy cơ bản quyền Hình ảnh (nhận diện nếu khung hình là phim truyền hình, anime, show TV, MV gốc, hoặc có logo nhà đài Tencent, iQIYI, Youku, Bilibili, Netflix, TVB, VTV...); (3) Khuyến nghị xử lý an toàn nhất.',
        ].filter(Boolean).join('\n');

        const assistantRes = await requestJson('/api/assistant', {
            method: 'POST',
            timeoutMs: 60000,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: promptLines,
                kind: 'question',
                mode: payload.mode === 'subtitle' ? 'subtitle' : 'voiceover',
                image_data: payload.image_data || null,
                video_context: {
                    title: String(payload.title || '').slice(0, 180),
                    duration_seconds: Number(payload.duration_seconds || 0) || null,
                    width: Number(payload.width || 0) || null,
                    height: Number(payload.height || 0) || null,
                },
            }),
        });

        const answer = String(assistantRes?.answer || '').trim();
        if (answer) {
            const lower = answer.toLowerCase();
            let musicScore = enrichedReport.music_score;
            let visualScore = enrichedReport.visual_score;
            if (/(nguy cơ cao|dễ dính bản quyền|content id|bản quyền nặng|commercial|ost gốc|nhạc có lời)/.test(lower)) {
                musicScore = Math.max(musicScore, 72);
            }
            if (/(logo|watermark|nhà đài|tencent|iqiyi|youku|bilibili|netflix|kênh truyền hình)/.test(lower)) {
                visualScore = Math.max(visualScore, payload.auto_brand_blur || payload.has_blur_region ? 38 : 65);
            }
            const level = (s) => (s >= 65 ? 'high' : s >= 38 ? 'medium' : 'low');
            const musicRisk = level(musicScore);
            const visualRisk = level(visualScore);
            const overallScore = Math.round(Math.max(musicScore, visualScore) * 0.7 + Math.min(musicScore, visualScore) * 0.3);
            const overallRisk = level(overallScore);

            return mergeRemoteReport({
                ...enrichedReport,
                overall_risk: overallRisk,
                overall_score: overallScore,
                music_risk: musicRisk,
                music_score: musicScore,
                visual_risk: visualRisk,
                visual_score: visualScore,
                detected_music: enrichedReport.recognized_track
                    ? enrichedReport.detected_music
                    : (payload.image_data ? 'AI Gemini đã phân tích khung hình & thông tin nguồn' : 'AI Gemini đã phân tích thông tin nguồn'),
                warnings: [
                    ...(enrichedReport.recognized_track ? enrichedReport.warnings.slice(0, 1) : []),
                    answer,
                    ...localReport.warnings.filter((w) => w !== answer),
                ].slice(0, 4),
                ai_scanned: true,
                scan_note: recognizedTrack
                    ? `Đã dò nhạc (${recognizedTrack.title}) + quét khung hình bằng AI Gemini.`
                    : (fingerprintNote ? `${fingerprintNote} · Đã quét AI Gemini.` : 'Đã quét sâu bằng AI Gemini.'),
            });
        }
    } catch (fallbackErr) {
        return {
            ...enrichedReport,
            scan_note: recognizedTrack
                ? enrichedReport.scan_note
                : (fingerprintNote || fallbackErr?.message || 'Chưa kết nối Gemini trong Cài đặt nên đang dùng đánh giá nhanh.'),
        };
    }

    return {
        ...enrichedReport,
        scan_note: recognizedTrack ? enrichedReport.scan_note : (fingerprintNote || 'Đã kiểm tra nhanh theo thông tin nguồn.'),
    };
}
