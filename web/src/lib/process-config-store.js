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
        'processLogoPath',
        'processLogoText',
        'processLogoSize',
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
