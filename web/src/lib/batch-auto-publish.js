export const BATCH_AUTO_PUBLISH_PREF_KEY = 'reup.batch.autoPublishPref.v1';

const SOCIAL_SAVED_KEY_PREFIX = 'reupai:social-saved:';

/**
 * Chuẩn hóa chủ đề/prompt chung của series theo số tập.
 * Hỗ trợ:
 * - Placeholder `{ep}`, `{tap}`, `{tập}`
 * - Nếu người dùng gõ sẵn "... tập 1" hoặc "... tap 1" ở cuối câu, tự động tăng thành "tập 2, 3, 4..." cho các video tiếp theo.
 * - Nếu chỉ gõ tên series (vd: "Xuyên không dị giới"), tự động ghép "<Series> - Tập <ep>".
 */
export function formatEpisodeTopic(basePrompt, episodeNumber, fallbackTitle = '') {
    const ep = Math.max(1, Number(episodeNumber) || 1);
    const raw = String(basePrompt || '').trim();
    if (!raw) {
        const cleanFallback = String(fallbackTitle || '').trim();
        return cleanFallback ? `${cleanFallback} - Tập ${ep}` : `Tập ${ep}`;
    }

    if (/\{(?:ep|tap|tập)\}/i.test(raw)) {
        return raw.replace(/\{(?:ep|tap|tập)\}/gi, String(ep));
    }

    const trailingEpisodeRegex = /(\b(?:tập|tap|ep|episode)\s*)(\d+)(\s*)$/i;
    if (trailingEpisodeRegex.test(raw)) {
        return raw.replace(trailingEpisodeRegex, (_, prefix, _num, suffix) => `${prefix}${ep}${suffix}`);
    }

    return `${raw} - Tập ${ep}`;
}

export function extractSeriesBaseName(basePrompt) {
    const raw = String(basePrompt || '').trim();
    if (!raw) return '';
    return raw
        .replace(/\{(?:ep|tap|tập)\}/gi, '')
        .replace(/[\s\-–—:|]*\b(?:tập|tap|ep|episode)\s*\d+\s*$/i, '')
        .replace(/[\s\-–—:|]+$/, '')
        .trim();
}

export function buildEpisodeAiInstructions({
    basePrompt = '',
    episodeNumber = 1,
    totalEpisodes = 1,
    originalTitle = '',
} = {}) {
    const ep = Math.max(1, Number(episodeNumber) || 1);
    const total = Math.max(1, Number(totalEpisodes) || 1);
    const episodeTopic = formatEpisodeTopic(basePrompt, ep, originalTitle);
    const seriesName = extractSeriesBaseName(basePrompt) || episodeTopic;

    const lines = [
        `Đây là Tập ${ep}${total > 1 ? ` (trong chuỗi ${total} tập liên tiếp)` : ''} của series: "${seriesName}".`,
        `Chủ đề trọng tâm của tập này: "${episodeTopic}".`,
        `Yêu cầu bắt buộc: Tiêu đề phải có cụm "Tập ${ep}" rõ ràng, hấp dẫn, tự nhiên bằng tiếng Việt, phù hợp đăng YouTube / Facebook Reels / TikTok.`,
        'Viết mô tả cuốn hút, tóm tắt kịch tính theo chủ đề trên và kèm hashtag liên quan đến series + #Tap' + ep + '.',
    ];
    if (originalTitle && String(originalTitle).trim()) {
        lines.push(`Tiêu đề/ngữ cảnh gốc tham khảo: "${String(originalTitle).trim()}".`);
    }
    return lines.join('\n');
}

export function buildFallbackEpisodeMetadata({
    basePrompt = '',
    episodeNumber = 1,
    totalEpisodes = 1,
    originalTitle = '',
} = {}) {
    const ep = Math.max(1, Number(episodeNumber) || 1);
    const episodeTopic = formatEpisodeTopic(basePrompt, ep, originalTitle);
    const seriesName = extractSeriesBaseName(basePrompt) || episodeTopic;

    const slugTag = seriesName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .replace(/[^a-zA-Z0-9]+/g, '')
        .toLowerCase();

    const tags = [
        seriesName,
        `Tập ${ep}`,
        `Tap${ep}`,
        slugTag || 'reupai',
        'xuyenkhong',
        'hoathinh',
    ].filter(Boolean);

    const description = [
        `${episodeTopic}`,
        totalEpisodes > 1
            ? `Đón xem trọn bộ series ${seriesName} (Tập ${ep}/${totalEpisodes}) trên kênh nhé!`
            : `Đón xem ${seriesName} - Tập ${ep}. Nhớ bấm theo dõi kênh để không bỏ lỡ tập tiếp theo!`,
        `#Tap${ep} ${slugTag ? `#${slugTag}` : ''} #xuyenkhong #reupai`.trim(),
    ].join('\n\n');

    return {
        title: episodeTopic.slice(0, 100),
        description,
        tags,
        socialMessage: `${episodeTopic}\n\n${description}`.slice(0, 2000),
    };
}

export function normalizeEpisodeMetadata(aiSuggestion, {
    basePrompt = '',
    episodeNumber = 1,
    totalEpisodes = 1,
    originalTitle = '',
} = {}) {
    const ep = Math.max(1, Number(episodeNumber) || 1);
    const fallback = buildFallbackEpisodeMetadata({
        basePrompt,
        episodeNumber: ep,
        totalEpisodes,
        originalTitle,
    });

    if (!aiSuggestion || typeof aiSuggestion !== 'object') {
        return fallback;
    }

    let title = String(aiSuggestion.title || '').trim() || fallback.title;
    const hasEpisodeTag = new RegExp(`\\b(?:tập|tap|ep|episode|phần|phan)\\s*0*${ep}\\b`, 'i').test(title);
    if (!hasEpisodeTag) {
        const suffix = ` - Tập ${ep}`;
        title = title.length + suffix.length <= 100
            ? `${title}${suffix}`
            : `${title.slice(0, Math.max(10, 100 - suffix.length)).trim()}${suffix}`;
    } else {
        title = title.slice(0, 100);
    }

    const description = String(aiSuggestion.description || '').trim() || fallback.description;
    const rawTags = Array.isArray(aiSuggestion.tags)
        ? aiSuggestion.tags
        : String(aiSuggestion.tags || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    const tags = rawTags.length ? rawTags : fallback.tags;
    const hashtagLine = tags
        .slice(0, 6)
        .map((tag) => `#${String(tag).replace(/^#+/, '').replace(/\s+/g, '')}`)
        .join(' ');

    const socialMessage = [
        title,
        description,
        hashtagLine,
    ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 2000);

    return {
        title,
        description,
        tags,
        socialMessage,
    };
}

export function sortFilesForEpisodes(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    return files.sort((a, b) => {
        const nameA = String(a?.name || '');
        const nameB = String(b?.name || '');
        return nameA.localeCompare(nameB, 'vi', { numeric: true, sensitivity: 'base' });
    });
}

export function mapFilesToEpisodeSlots(files, slotCount, currentSlots = []) {
    const total = Math.max(0, Number(slotCount) || 0);
    const sorted = sortFilesForEpisodes(files);
    const next = Array.from({ length: total }, (_, idx) => currentSlots[idx] || null);
    for (let i = 0; i < total && i < sorted.length; i += 1) {
        next[i] = sorted[i];
    }
    return next;
}

/**
 * Kéo thả đổi vị trí / thay thế tập trong danh sách episodeVideos.
 * Khi mode === 'swap': hoán đổi trực tiếp video ở vị trí fromIndex và toIndex.
 * Khi mode === 'move': chèn video từ fromIndex sang vị trí toIndex.
 */
export function reorderEpisodeVideos(videos, fromIndex, toIndex, { mode = 'swap' } = {}) {
    const list = Array.isArray(videos) ? [...videos] : [];
    const from = Number(fromIndex);
    const to = Number(toIndex);
    if (
        !Number.isInteger(from)
        || !Number.isInteger(to)
        || from < 0
        || to < 0
        || from >= list.length
        || to >= list.length
        || from === to
    ) {
        return list;
    }
    if (mode === 'move') {
        const [moved] = list.splice(from, 1);
        list.splice(to, 0, moved);
        return list;
    }
    const temp = list[from];
    list[from] = list[to];
    list[to] = temp;
    return list;
}

/**
 * Thay thế video ở một tập (targetIndex) bằng một video nguồn khác (replacementVideo).
 * Nếu replacementVideo đã nằm ở một tập khác trong danh sách, tự động hoán đổi 2 tập.
 */
export function replaceEpisodeVideoAt(videos, targetIndex, replacementVideo) {
    const list = Array.isArray(videos) ? [...videos] : [];
    const idx = Number(targetIndex);
    if (!replacementVideo || !Number.isInteger(idx) || idx < 0 || idx >= list.length) {
        return list;
    }
    const existingIdx = list.findIndex(
        (item) => String(item?.video_id) === String(replacementVideo.video_id),
    );
    if (existingIdx !== -1 && existingIdx !== idx) {
        return reorderEpisodeVideos(list, existingIdx, idx, { mode: 'swap' });
    }
    list[idx] = replacementVideo;
    return list;
}

export async function fileToThumbnailDataUrl(file, {
    maxWidth = 1280,
    maxHeight = 720,
    quality = 0.86,
} = {}) {
    if (!file) return null;
    if (typeof file === 'string' && file.startsWith('data:image/')) {
        return file;
    }
    const rawDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Không đọc được tệp ảnh bìa.'));
        reader.readAsDataURL(file);
    });

    if (typeof window === 'undefined' || typeof window.Image !== 'function' || typeof document === 'undefined') {
        return rawDataUrl;
    }

    try {
        const img = await new Promise((resolve, reject) => {
            const image = new window.Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Ảnh không hợp lệ'));
            image.src = rawDataUrl;
        });
        const srcW = Number(img.naturalWidth || img.width || 1280);
        const srcH = Number(img.naturalHeight || img.height || 720);
        const scale = Math.min(1, maxWidth / Math.max(1, srcW), maxHeight / Math.max(1, srcH));
        const targetW = Math.max(1, Math.round(srcW * scale));
        const targetH = Math.max(1, Math.round(srcH * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetW, targetH);
        return canvas.toDataURL('image/jpeg', quality);
    } catch {
        return rawDataUrl;
    }
}

export function readSavedSocialTarget(storage, provider) {
    if (!storage || !provider) {
        return { connected: false, token: '', target: null, label: 'Chưa kết nối' };
    }
    try {
        const raw = storage.getItem(`${SOCIAL_SAVED_KEY_PREFIX}${provider}`);
        if (!raw) return { connected: false, token: '', target: null, label: 'Chưa kết nối' };
        const parsed = JSON.parse(raw);
        const token = String(parsed?.token || '').trim();
        const target = parsed?.target && parsed.target.id ? parsed.target : null;
        if (!token || !target) {
            return { connected: false, token: '', target: null, label: 'Chưa kết nối' };
        }
        return {
            connected: true,
            token,
            target,
            label: String(target.name || target.id),
        };
    } catch {
        return { connected: false, token: '', target: null, label: 'Chưa kết nối' };
    }
}

export function readBatchAutoPublishPrefs(storage) {
    if (!storage) return {};
    try {
        const raw = storage.getItem(BATCH_AUTO_PUBLISH_PREF_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function writeBatchAutoPublishPrefs(storage, prefs = {}) {
    if (!storage) return;
    try {
        storage.setItem(BATCH_AUTO_PUBLISH_PREF_KEY, JSON.stringify(prefs));
    } catch {
        // ignore quota errors
    }
}

async function pollUploadJob(youtubeApi, pollPath, {
    label = 'MXH',
    onStage,
    intervalMs = 2000,
    maxWaitMs = 20 * 60 * 1000,
} = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        const job = await youtubeApi(pollPath);
        const pct = Number(job?.percent || 0);
        if (onStage) {
            onStage(`Đang đăng ${label} (${pct}%)…`);
        }
        if (job?.state === 'completed') {
            return job;
        }
        if (job?.state === 'failed') {
            throw new Error(job.error || `Đăng ${label} thất bại.`);
        }
    }
    throw new Error(`Quá thời gian chờ đăng ${label}.`);
}

export async function generateAndPublishEpisode({
    youtubeApi,
    accountId,
    video,
    channel = 'default',
    mode = 'voiceover',
    episodeNumber = 1,
    totalEpisodes = 1,
    basePrompt = '',
    useAiPrompt = true,
    thumbnailDataUrl = null,
    platforms = {},
    youtubeConfig = {},
    facebookSaved = null,
    tiktokSaved = null,
    onStage = null,
} = {}) {
    const identity = {
        video_id: video.video_id,
        channel: channel || video.channel || 'default',
        mode,
        account_id: accountId,
    };

    let aiSuggestion = null;
    if (useAiPrompt) {
        if (onStage) onStage(`AI đang tạo tiêu đề & mô tả Tập ${episodeNumber}…`);
        try {
            const instructions = buildEpisodeAiInstructions({
                basePrompt,
                episodeNumber,
                totalEpisodes,
                originalTitle: video.title || video.video_id,
            });
            aiSuggestion = await youtubeApi('suggest', {
                method: 'POST',
                timeoutMs: 95000,
                body: JSON.stringify({
                    ...identity,
                    title: formatEpisodeTopic(basePrompt, episodeNumber, video.title || video.video_id),
                    instructions,
                    images: thumbnailDataUrl ? [thumbnailDataUrl] : [],
                }),
            });
        } catch {
            aiSuggestion = null;
        }
    }

    const metadata = normalizeEpisodeMetadata(aiSuggestion, {
        basePrompt,
        episodeNumber,
        totalEpisodes,
        originalTitle: video.title || video.video_id,
    });

    const results = {};
    const errors = [];

    if (platforms.youtube) {
        if (!youtubeConfig?.channelId) {
            errors.push('YouTube: Chưa kết nối kênh YouTube');
        } else {
            try {
                if (onStage) onStage(`Đang gửi Tập ${episodeNumber} lên YouTube…`);
                const requestId = crypto.randomUUID();
                const initialJob = await youtubeApi('uploads', {
                    method: 'POST',
                    body: JSON.stringify({
                        ...identity,
                        channel_id: youtubeConfig.channelId,
                        request_id: requestId,
                        title: metadata.title,
                        description: metadata.description,
                        tags: metadata.tags,
                        thumbnail: thumbnailDataUrl || null,
                        privacy: youtubeConfig.privacy || 'public',
                        made_for_kids: Boolean(youtubeConfig.madeForKids),
                        confirmed: true,
                        publish_at: null,
                    }),
                });
                const finalJob = initialJob?.state === 'completed'
                    ? initialJob
                    : await pollUploadJob(
                        youtubeApi,
                        `uploads/${encodeURIComponent(initialJob?.id || requestId)}`,
                        { label: 'YouTube', onStage },
                    );
                results.youtube = finalJob;
            } catch (err) {
                errors.push(`YouTube: ${err?.message || 'Lỗi tải lên'}`);
            }
        }
    }

    if (platforms.facebook) {
        if (!facebookSaved?.connected || !facebookSaved?.token || !facebookSaved?.target?.id) {
            errors.push('Facebook: Chưa lưu kết nối Fanpage');
        } else {
            try {
                if (onStage) onStage(`Đang đăng Tập ${episodeNumber} lên Facebook Page…`);
                const requestId = crypto.randomUUID();
                const initialJob = await youtubeApi('social/facebook/publish', {
                    method: 'POST',
                    body: JSON.stringify({
                        ...identity,
                        token: facebookSaved.token,
                        target_id: facebookSaved.target.id,
                        request_id: requestId,
                        confirmed: true,
                        include_video: true,
                        message: metadata.socialMessage,
                    }),
                });
                const finalJob = initialJob?.state === 'completed'
                    ? initialJob
                    : await pollUploadJob(
                        youtubeApi,
                        `social/facebook/publish/${encodeURIComponent(initialJob?.id || requestId)}`,
                        { label: 'Facebook Page', onStage },
                    );
                results.facebook = finalJob;
            } catch (err) {
                errors.push(`Facebook: ${err?.message || 'Lỗi đăng bài'}`);
            }
        }
    }

    if (platforms.tiktok) {
        if (!tiktokSaved?.connected || !tiktokSaved?.token || !tiktokSaved?.target?.id) {
            errors.push('TikTok: Chưa lưu kết nối TikTok');
        } else {
            try {
                if (onStage) onStage(`Đang đăng Tập ${episodeNumber} lên TikTok…`);
                const requestId = crypto.randomUUID();
                const initialJob = await youtubeApi('social/tiktok/publish', {
                    method: 'POST',
                    body: JSON.stringify({
                        ...identity,
                        token: tiktokSaved.token,
                        target_id: tiktokSaved.target.id,
                        request_id: requestId,
                        confirmed: true,
                        include_video: true,
                        message: metadata.socialMessage,
                    }),
                });
                const finalJob = initialJob?.state === 'completed'
                    ? initialJob
                    : await pollUploadJob(
                        youtubeApi,
                        `social/tiktok/publish/${encodeURIComponent(initialJob?.id || requestId)}`,
                        { label: 'TikTok', onStage },
                    );
                results.tiktok = finalJob;
            } catch (err) {
                errors.push(`TikTok: ${err?.message || 'Lỗi đăng bài'}`);
            }
        }
    }

    return {
        metadata,
        results,
        errors,
    };
}
