"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

export function GeminiProjectPicker({ client, supported, oauth, onSelected, onBusyChange }) {
  const [result, setResult] = useState(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const request = useRef(null), attempted = useRef(null), alive = useRef(true);
  const owner = oauth?.google_subject || oauth?.google_email || '';
  const currentOwner = useRef(owner); currentOwner.current = owner;
  useEffect(() => {
    alive.current = true; attempted.current = null; setResult(null); setNotice(''); setChoice(''); setBusy(false);
    return () => {
      alive.current = false; request.current?.controller.abort(); request.current = null; onBusyChange(false);
    };
  }, [owner, onBusyChange]);
  const run = useCallback(async (action, force = false) => {
    if (!supported || !oauth?.connected || request.current) return;
    const entry = { controller: new AbortController(), owner };
    request.current = entry; setBusy(true); onBusyChange(true); setNotice('');
    try {
      if (action === 'select') {
        await client.json('/api/gemini/project', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ project_id:choice }), signal:entry.controller.signal });
        if (!alive.current || currentOwner.current !== entry.owner) return;
        await onSelected(choice); setNotice('Đã lưu project bạn chọn. Đang kiểm tra kết nối Gemini.');
      } else {
        const value = await client.json('/api/gemini/projects/detect', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ force }), signal:entry.controller.signal, timeoutMs:45000 });
        if (!alive.current || currentOwner.current !== entry.owner) return;
        setResult(value); setChoice(value.project_id || '');
        if (value.project_id) await onSelected(value.project_id);
      }
    } catch (error) {
      if (alive.current && !entry.controller.signal.aborted && currentOwner.current === entry.owner) {
        setNotice(error.status === 404 ? 'Cập nhật Local Engine để tự tìm project. Bạn vẫn có thể nhập ID thủ công bên dưới.' : error.message || 'Chưa tìm được project. Bấm Tìm lại để thử.');
      }
    } finally {
      if (request.current === entry) {
        request.current = null; onBusyChange(false); if (alive.current) setBusy(false);
      }
    }
  }, [supported, oauth?.connected, owner, choice, client, onSelected, onBusyChange]);
  useEffect(() => {
    if (!supported || !oauth?.connected || oauth.connecting || oauth.project_id || !owner || attempted.current === owner) return;
    attempted.current = owner; void run('detect');
  }, [supported, oauth?.connected, oauth?.connecting, oauth?.project_id, owner, run]);
  if (!oauth?.connected || oauth.connecting) return null;
  const data = result || oauth.project_discovery;
  const options = Array.isArray(data?.projects) ? data.projects : [];
  return <section className="gemini-project-picker" aria-label="Tự chọn Google Cloud project">
    <strong>{oauth.project_id ? 'Project đã kết nối' : 'Google đã cấp quyền · Chọn project để dùng Gemini'}</strong>
    <p role="status">{busy ? 'Đang tìm project của tài khoản Google này…' : notice || (oauth.project_id ? `Đang dùng ${oauth.project_id}.` : data?.message || 'ReupAI tự tìm project; nếu chỉ có một project phù hợp, ứng dụng sẽ tự điền và lưu ID.')}</p>
    {supported ? <>
      {options.length > 0 && (!data?.project_id || options.length > 1) && <div className="settings-form"><label htmlFor="gemini-project-options">Project của {oauth.google_email || 'bạn'}<select id="gemini-project-options" value={choice} onChange={event => setChoice(event.target.value)} disabled={busy}><option value="">Chọn project…</option>{options.map(item => <option value={item.project_id} key={item.project_id}>{item.display_name} · {item.project_id}</option>)}</select></label><button className="btn primary" type="button" disabled={busy || !choice} onClick={() => run('select')}>Dùng project này</button></div>}
      <div className="settings-actions"><button className="btn" type="button" disabled={busy} onClick={() => run('detect', true)}>{busy ? 'Đang tìm…' : 'Tìm lại project'}</button><a className="btn" href="https://console.cloud.google.com/cloud-resource-manager" target="_blank" rel="noreferrer">Xem / Tạo project Google Cloud</a></div>
    </> : <p><Link href="/local-engine">Cập nhật Local Engine</Link> để tự tìm và điền Project ID.</p>}
    {!oauth.project_id && <small>Nếu chưa có project, mở Google Cloud bằng đúng tài khoản vừa cấp quyền để tạo. ReupAI không dùng project của nhà phát triển thay cho khách.</small>}
  </section>;
}
