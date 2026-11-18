import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearLastConfig,
  mergeSectionIntoConfig,
  PRESETS_STORAGE_KEY,
  readActivePresetPref,
  readLastConfigLocal,
  readPresetsLocal,
  syncLastConfigFromEngine,
  syncPresetsFromEngine,
  writeActivePresetPref,
  writeLastConfig,
  writePresets,
} from '../src/lib/process-config-store.js';

function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
}

test('presets save locally even when Engine is offline, and sync cleanly when online', async () => {
  const storage = createMemoryStorage();
  const offlineRes = await writePresets(storage, async () => { throw new Error('offline'); }, {
    News: { processVoice: 'Hoài My', processTtsSpeed: '1.15', boost_gpu: true },
  });
  assert.equal(offlineRes.ok, true);
  assert.equal(offlineRes.synced, false);
  assert.equal(readPresetsLocal(storage).News.processVoice, 'Hoài My');

  const putCalls = [];
  const onlineRes = await writePresets(storage, async (path, options) => {
    putCalls.push({ path, body: JSON.parse(options.body) });
    return { ok: true };
  }, {
    News: { processVoice: 'Hoài My', processTtsSpeed: '1.15', boost_gpu: true },
  });
  assert.equal(onlineRes.synced, true);
  assert.equal(putCalls[0].path, '/api/library/ui-state/process_presets_v2');
  assert.equal(putCalls[0].body.value.News.boost_gpu, true);
});

test('syncPresetsFromEngine merges remote presets with local presets', async () => {
  const storage = createMemoryStorage({
    [PRESETS_STORAGE_KEY]: JSON.stringify({ LocalOnly: { processVoice: 'Trúc Ly' } }),
  });
  const result = await syncPresetsFromEngine(storage, async () => ({
    value: { CloudPreset: { processVoice: 'Nam Minh', processAspectRatio: '9:16' } },
  }));
  assert.equal(result.updated, true);
  assert.deepEqual(Object.keys(result.presets).sort(), ['CloudPreset', 'LocalOnly']);
  assert.equal(readPresetsLocal(storage).CloudPreset.processAspectRatio, '9:16');
});

test('lastConfig persists locally, chooses newer timestamp from Engine, and clears cleanly', async () => {
  const storage = createMemoryStorage();
  const saved = await writeLastConfig(storage, null, {
    config: { processVoice: 'Nam Minh', processSubtitleStyle: 'bold' },
    savedAt: 1000,
    presetName: 'TikTok Vertical',
  });
  assert.equal(saved.ok, true);
  assert.equal(readLastConfigLocal(storage).presetName, 'TikTok Vertical');

  const olderEngine = await syncLastConfigFromEngine(storage, async () => ({
    value: { config: { processVoice: 'Old' }, savedAt: 500, presetName: '' },
  }));
  assert.equal(olderEngine.config.processVoice, 'Nam Minh');

  const newerEngine = await syncLastConfigFromEngine(storage, async () => ({
    value: { config: { processVoice: 'SyncedNew' }, savedAt: 2000, presetName: 'YouTube' },
  }));
  assert.equal(newerEngine.config.processVoice, 'SyncedNew');
  assert.equal(readLastConfigLocal(storage).presetName, 'YouTube');

  await clearLastConfig(storage, null);
  assert.equal(readLastConfigLocal(storage), null);
});

test('writeLastConfig falls back gracefully when logo_data triggers storage quota error', async () => {
  let attempts = 0;
  const quotaStorage = {
    store: new Map(),
    getItem(k) { return this.store.get(k) ?? null; },
    setItem(k, v) {
      attempts += 1;
      if (attempts === 1) throw new Error('QuotaExceededError');
      this.store.set(k, String(v));
    },
    removeItem(k) { this.store.delete(k); },
  };
  const result = await writeLastConfig(quotaStorage, null, {
    config: { processVoice: 'Trúc Ly', logo_data: 'data:image/png;base64,HUGE', logo_filename: 'logo.png' },
    savedAt: 1234,
  });
  assert.equal(result.ok, true);
  const restored = readLastConfigLocal(quotaStorage);
  assert.equal(restored.config.processVoice, 'Trúc Ly');
  assert.equal(restored.config.logo_data, null);
  assert.equal(restored.config.logo_filename, 'logo.png');
});

test('active preset preference defaults autoRemember=true and merges sections accurately', () => {
  const storage = createMemoryStorage();
  assert.deepEqual(readActivePresetPref(storage), { name: '', autoRemember: true });
  writeActivePresetPref(storage, { name: 'Shorts', autoRemember: false });
  assert.deepEqual(readActivePresetPref(storage), { name: 'Shorts', autoRemember: false });

  const base = { processVoice: 'Trúc Ly', processLogoMode: 'none', processLogoText: '' };
  const current = { processVoice: 'Nam Minh', processLogoMode: 'text', processLogoText: '@ReupAI', processLogoSize: '40', processLogoX: '10', processLogoY: '20', logo_data: null, logo_filename: null };
  const merged = mergeSectionIntoConfig(base, current, 'logo');
  assert.equal(merged.processVoice, 'Trúc Ly');
  assert.equal(merged.processLogoMode, 'text');
  assert.equal(merged.processLogoText, '@ReupAI');
});
