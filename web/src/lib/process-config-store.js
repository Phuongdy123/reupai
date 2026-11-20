export const PRESETS_STORAGE_KEY = 'reup.process.presets.v2';
export const LAST_CONFIG_STORAGE_KEY = 'reup.process.lastConfig.v1';
export const ACTIVE_PRESET_STORAGE_KEY = 'reup.process.activePreset.v1';

export const ENGINE_PRESETS_KEY = 'process_presets_v2';
export const ENGINE_LAST_CONFIG_KEY = 'process_last_config_v1';

export const PRESET_SECTION_FIELDS = {
    sub: [
        'processBlurPreset',
        'processBlurX',
        'processBlurY',
        'processBlurWidth',
        'processBlurHeight',
        'source_subtitle_mode',
        'auto_brand_blur',
    ],
    custom: [
        'processCustomBlurX',
        'processCustomBlurY',
        'processCustomBlurWidth',
        'processCustomBlurHeight',
        'blur_intervals',
    ],
    logo: [
        'processLogoMode',
        'processLogoShape',
        'processLogoPath',
        'processLogoText',
        'processLogoSize',
        'processLogoWidth',
        'processLogoHeight',
        'processLogoX',
        'processLogoY',
        'logo_data',
        'logo_filename',
    ],
};

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readJsonStorage(storage, key, fallback = null) {
    if (!storage) return fallback;
    try {
        const raw = storage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return isPlainObject(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

export function writeJsonStorage(storage, key, value) {
    if (!storage) return false;
    try {
        storage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        // Fallback when inline base64 logo data exceeds localStorage quota.
        if (isPlainObject(value) && (value.logo_data || value.config?.logo_data)) {
            try {
                const trimmed = value.config
                    ? { ...value, config: { ...value.config, logo_data: null } }
                    : { ...value, logo_data: null };
                storage.setItem(key, JSON.stringify(trimmed));
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }
}

export function readPresetsLocal(storage) {
    return readJsonStorage(storage, PRESETS_STORAGE_KEY, {});
}

export async function writePresets(storage, requestJson, presets) {
    const clean = isPlainObject(presets) ? presets : {};
    writeJsonStorage(storage, PRESETS_STORAGE_KEY, clean);
    if (typeof requestJson !== 'function') {
        return { ok: true, synced: false };
    }
    try {
        await requestJson(`/api/library/ui-state/${ENGINE_PRESETS_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: clean }),
        });
        return { ok: true, synced: true };
    } catch (error) {
        return {
            ok: true,
            synced: false,
            error: error?.message || 'Chưa đồng bộ được lên Engine.',
        };
    }
}

export async function syncPresetsFromEngine(storage, requestJson) {
    const local = readPresetsLocal(storage);
    if (typeof requestJson !== 'function') {
        return { presets: local, updated: false };
    }
    try {
        const data = await requestJson(`/api/library/ui-state/${ENGINE_PRESETS_KEY}`);
        const remote = isPlainObject(data?.value) ? data.value : {};
        const merged = { ...local, ...remote };
        const changed = JSON.stringify(merged) !== JSON.stringify(local);
        if (changed) {
            writeJsonStorage(storage, PRESETS_STORAGE_KEY, merged);
        }
        return { presets: merged, updated: changed };
    } catch {
        return { presets: local, updated: false };
    }
}

export function readActivePresetPref(storage) {
    const saved = readJsonStorage(storage, ACTIVE_PRESET_STORAGE_KEY, null);
    if (!saved) {
        return { name: '', autoRemember: true };
    }
    return {
        name: typeof saved.name === 'string' ? saved.name : '',
        autoRemember: saved.autoRemember !== false,
    };
}

export function writeActivePresetPref(storage, pref = {}) {
    const normalized = {
        name: typeof pref.name === 'string' ? pref.name : '',
        autoRemember: pref.autoRemember !== false,
    };
    writeJsonStorage(storage, ACTIVE_PRESET_STORAGE_KEY, normalized);
    return normalized;
}

export function readLastConfigLocal(storage) {
    const saved = readJsonStorage(storage, LAST_CONFIG_STORAGE_KEY, null);
    if (!saved || !isPlainObject(saved.config)) return null;
    return {
        config: saved.config,
        savedAt: Number(saved.savedAt || 0),
        presetName: typeof saved.presetName === 'string' ? saved.presetName : '',
    };
}

export async function writeLastConfig(storage, requestJson, payload, { syncRemote = true } = {}) {
    if (!isPlainObject(payload?.config)) {
        return { ok: false, synced: false };
    }
    const record = {
        config: payload.config,
        savedAt: Number(payload.savedAt || Date.now()),
        presetName: typeof payload.presetName === 'string' ? payload.presetName : '',
    };
    writeJsonStorage(storage, LAST_CONFIG_STORAGE_KEY, record);
    if (!syncRemote || typeof requestJson !== 'function') {
        return { ok: true, synced: false, record };
    }
    try {
        await requestJson(`/api/library/ui-state/${ENGINE_LAST_CONFIG_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: record }),
        });
        return { ok: true, synced: true, record };
    } catch (error) {
        return {
            ok: true,
            synced: false,
            record,
            error: error?.message || 'Chưa đồng bộ được lên Engine.',
        };
    }
}

export async function syncLastConfigFromEngine(storage, requestJson) {
    const local = readLastConfigLocal(storage);
    if (typeof requestJson !== 'function') {
        return local;
    }
    try {
        const data = await requestJson(`/api/library/ui-state/${ENGINE_LAST_CONFIG_KEY}`);
        const remote = isPlainObject(data?.value) && isPlainObject(data.value.config)
            ? {
                config: data.value.config,
                savedAt: Number(data.value.savedAt || 0),
                presetName: typeof data.value.presetName === 'string' ? data.value.presetName : '',
            }
            : null;
        if (!remote) return local;
        if (!local || remote.savedAt > local.savedAt) {
            writeJsonStorage(storage, LAST_CONFIG_STORAGE_KEY, remote);
            return remote;
        }
        return local;
    } catch {
        return local;
    }
}

export async function clearLastConfig(storage, requestJson) {
    if (storage) {
        try {
            storage.removeItem(LAST_CONFIG_STORAGE_KEY);
        } catch {
            // ignore storage errors
        }
    }
    if (typeof requestJson !== 'function') return;
    try {
        await requestJson(`/api/library/ui-state/${ENGINE_LAST_CONFIG_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: {} }),
        });
    } catch {
        // ignore offline errors
    }
}

export function mergeSectionIntoConfig(baseConfig, currentConfig, section) {
    const fields = PRESET_SECTION_FIELDS[section] || [];
    const next = { ...(isPlainObject(baseConfig) ? baseConfig : {}) };
    if (!isPlainObject(currentConfig)) return next;
    fields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(currentConfig, field)) {
            next[field] = currentConfig[field];
        }
    });
    return next;
}

export function buildProcessPayloadFromSavedPreset(presetConfig, defaults = {}) {
    const base = { ...(isPlainObject(defaults) ? defaults : {}) };
    if (!isPlainObject(presetConfig)) return base;

    const str = (key, fallback = '') => {
        const val = presetConfig[key];
        return val === undefined || val === null ? fallback : String(val);
    };
    const numOrNull = (key) => {
        const raw = str(key, '').trim();
        if (!raw) return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const blur = {};
    [['x', 'X'], ['y', 'Y'], ['width', 'Width'], ['height', 'Height']].forEach(([key, suffix]) => {
        const parsed = numOrNull(`processBlur${suffix}`);
        if (parsed !== null) blur[key] = parsed;
    });

    const customBlurComplete = ['X', 'Y', 'Width', 'Height'].every(
        (suffix) => numOrNull(`processCustomBlur${suffix}`) !== null,
    );
    const customBlurRegion = customBlurComplete
        ? {
            x: numOrNull('processCustomBlurX'),
            y: numOrNull('processCustomBlurY'),
            width: numOrNull('processCustomBlurWidth'),
            height: numOrNull('processCustomBlurHeight'),
        }
        : null;

    const blurIntervals = Array.isArray(presetConfig.blur_intervals)
        ? presetConfig.blur_intervals
            .map((item) => ({
                start: Number(item?.start),
                end: Number(item?.end),
                x: Number(numOrNull('processCustomBlurX') ?? 0),
                y: Number(numOrNull('processCustomBlurY') ?? 0),
                width: Number(numOrNull('processCustomBlurWidth') ?? 0),
                height: Number(numOrNull('processCustomBlurHeight') ?? 0),
            }))
            .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
        : [];

    const musicVolumeNum = Number(str('processMusicVolume', '0.25'));

    return {
        ...base,
        preview_seconds: numOrNull('processPreviewSeconds'),
        subtitle_font_size: numOrNull('processFontSize'),
        source_language: str('processSourceLanguage', base.source_language || 'auto') || 'auto',
        target_language: str('processTargetLanguage', base.target_language || 'vi') || 'vi',
        translation_model: str('processTranslationModel', base.translation_model || 'gemini-3.1-flash-lite') || 'gemini-3.1-flash-lite',
        transcript_source: str('processTranscriptSource', base.transcript_source || 'audio') || 'audio',
        output_format: 'video',
        ocr_language: str('processOcrLanguage', base.ocr_language || 'auto') || 'auto',
        ocr_fps: numOrNull('processOcrFps') ?? base.ocr_fps ?? 2,
        ocr_min_confidence: numOrNull('processOcrConfidence') ?? base.ocr_min_confidence ?? 0.45,
        ocr_parallelism: numOrNull('processOcrParallelism') ?? base.ocr_parallelism ?? 2,
        ocr_use_gpu: Boolean(presetConfig.ocr_use_gpu ?? base.ocr_use_gpu),
        boost_gpu: Boolean(presetConfig.boost_gpu ?? presetConfig.ocr_use_gpu ?? base.boost_gpu),
        stability_mode: true,
        ocr_merge_similar: presetConfig.ocr_merge_similar !== undefined
            ? Boolean(presetConfig.ocr_merge_similar)
            : (base.ocr_merge_similar ?? true),
        ocr_similarity_threshold: numOrNull('processOcrSimilarity') ?? base.ocr_similarity_threshold ?? 0.82,
        subtitle_style: str('processSubtitleStyle', base.subtitle_style || 'minimal') || 'minimal',
        original_volume: numOrNull('processOriginalVolume') ?? 0.15,
        voice_volume: numOrNull('processVoiceVolume') ?? 1,
        tts_speed: numOrNull('processTtsSpeed') ?? 1.0,
        voice: str('processVoice', base.voice || 'Trúc Ly') || 'Trúc Ly',
        music_url: str('processMusicUrl', '').trim() || null,
        music_volume: Number.isFinite(musicVolumeNum) ? Math.min(2, Math.max(0, musicVolumeNum)) : 0.25,
        auto_brand_blur: Boolean(presetConfig.auto_brand_blur),
        blur_mode: str('processEraseMode', 'blur') || 'blur',
        glossary: str('processGlossary', '').trim() || null,
        vocal_separation: Boolean(presetConfig.vocal_separation),
        trim_silence: Boolean(presetConfig.trim_silence),
        multi_voice: Boolean(presetConfig.multi_voice),
        secondary_voice: str('processSecondaryVoice', 'Nam Minh') || 'Nam Minh',
        bgm_mood: str('processBgmMood', '') || null,
        outro_cta_enabled: Boolean(presetConfig.outro_cta_enabled),
        outro_cta_text: str('processOutroCtaText', '').trim() || null,
        anti_reuse: Boolean(presetConfig.anti_reuse),
        anti_reuse_zoom: 1.04,
        anti_reuse_speed: 1.03,
        anti_reuse_mirror: Boolean(presetConfig.anti_reuse_mirror),
        anti_reuse_color: Boolean(presetConfig.anti_reuse_color),
        secondary_sub_blur: presetConfig.secondary_sub_blur !== false,
        secondary_sub_style: str('processSecondarySubStyle', 'box') || 'box',
        secondary_sub_font_size: numOrNull('processSecondarySubFontSize'),
        source_subtitle_mode: presetConfig.source_subtitle_mode === 'none' ? 'none' : 'auto',
        aspect_ratio: str('processAspectRatio', '') || null,
        blur_preset: str('processBlurPreset', '') || null,
        logo_size: numOrNull('processLogoSize'),
        logo_width: numOrNull('processLogoWidth'),
        logo_height: numOrNull('processLogoHeight'),
        logo_x: numOrNull('processLogoX'),
        logo_y: numOrNull('processLogoY'),
        blur_region: Object.keys(blur).length ? blur : null,
        custom_blur_region: customBlurRegion,
        blur_intervals: blurIntervals,
        logo_mode: str('processLogoMode', base.logo_mode || 'none') || 'none',
        logo_shape: str('processLogoShape', 'rect') || 'rect',
        logo_path: str('processLogoPath', '') || null,
        logo_text: str('processLogoText', '') || null,
        logo_data: presetConfig.logo_data || null,
        logo_filename: presetConfig.logo_filename || null,
    };
}
