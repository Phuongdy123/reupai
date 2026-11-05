"use client";

import { useEffect, useState } from 'react';
import { useEngine } from './engine-provider';
import { newerVersion } from '../lib/engine-version';

const busyStates = new Set(['checking', 'downloading', 'waiting', 'installing']);
export function EngineUpdateNotice() {
  const { version, capabilities, status, client } = useEngine();
  const [release, setRelease] = useState(null);
  const [update, setUpdate] = useState(null);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const polling = requested && release && newerVersion(release.version, version) && busyStates.has(update?.state);
  useEffect(() => {
    if (!capabilities?.verified_updates || status !== 'connected' || requested || !release || !newerVersion(release.version, version)) return;
    let active = true;
    client.json('/api/updates', { timeoutMs: 8000 }).then(result => {
      if (active && ['downloading', 'waiting', 'installing'].includes(result.state)) {
        setUpdate(result); setRequested(true);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [capabilities?.verified_updates, status, client, requested, release, version]);
  useEffect(() => {
    let active = true;
    fetch('/api/engine/release').then(response => response.ok ? response.json() : null).then(value => {
      if (active) setRelease(value?.release || null);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!capabilities?.verified_updates || status !== 'connected' || !polling) return;
    let active = true, timer;
    const poll = async () => {
      try { const result = await client.json('/api/updates', { timeoutMs: 8000 }); if (active) setUpdate(result); }
      catch { /* The Engine disconnects briefly while the installer replaces it. */ }
      if (active) timer = setTimeout(poll, 2000);
    };
    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [capabilities?.verified_updates, status, client, polling]);

  const available = release && newerVersion(release.version, version);
  const completed = requested && release && version && !newerVersion(release.version, version);
  if (!available && !completed) return null;
  const running = busy || busyStates.has(update?.state);
  const labels = {
    checking: 'Đang kiểm tra bản cập nhật…', downloading: `Đang tải bộ cài: ${update?.progress || 0}%`,
    waiting: 'Đã tải xong. Chờ công việc đang chạy hoàn tất để cài đặt.',
    installing: 'Đang cài bản mới. ReupAI sẽ tự kết nối lại khi hoàn tất.', cancelled: 'Đã hủy cập nhật.',
  };
  const message = completed ? `Đã cập nhật Local Engine ${version}.` : labels[update?.state] || `Bản ${release.version} đã sẵn sàng. Bạn đang dùng ${version}.`;
  async function start() {
    if (running) return;
    setBusy(true); setError('');
    try {
      const result = await client.json('/api/updates/start', { method: 'POST', timeoutMs: 15000 });
      setUpdate(result); setRequested(true);
    } catch (caught) { setError(caught.message || 'Chưa bắt đầu được cập nhật.'); }
    finally { setBusy(false); }
  }
  return <section className="engine-update-notice" role="status" aria-live="polite">
    <div><strong>{completed ? 'Cập nhật thành công' : 'Có bản Local Engine mới'}</strong><p>{message}</p>{(error || update?.error) && <small>{error || update.error}</small>}</div>
    <div className="engine-update-actions">
      {completed ? <button type="button" onClick={() => setRequested(false)}>Đóng</button> : capabilities?.verified_updates
        ? <button type="button" disabled={running || status !== 'connected'} onClick={start}>{running ? 'Đang cập nhật…' : 'Cập nhật ngay'}</button>
        : <a href="/api/engine/download">Tải bản mới · {Math.round(release.size / 1024 / 1024)} MB</a>}
      {!completed && ['downloading', 'waiting'].includes(update?.state) && <button type="button" className="secondary" onClick={() => client.json('/api/updates/cancel', { method: 'POST' }).then(setUpdate).catch(caught => setError(caught.message))}>Hủy</button>}
      {!completed && capabilities?.verified_updates && update?.state === 'error' && <a className="secondary" href="/api/engine/download">Tải để cài thủ công</a>}
    </div>
  </section>;
}
