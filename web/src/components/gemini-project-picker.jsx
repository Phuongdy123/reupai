"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

export function GeminiProjectPicker({ client, supported, canCreate, oauth, onSelected, onBusyChange, onReconnect }) {
  const [result, setResult] = useState(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionInFlight, setActionInFlight] = useState('');
  const request = useRef(null), attempted = useRef(null), alive = useRef(true);
  const pollDeadline = useRef(0);
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
    request.current = entry; setBusy(true); setActionInFlight(action); onBusyChange(true); setNotice('');
    try {
      if (action === 'select') {
        await client.json('/api/gemini/project', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ project_id:choice }), signal:entry.controller.signal });
        if (!alive.current || currentOwner.current !== entry.owner) return;
        await onSelected(choice); setNotice('Đã lưu project bạn chọn. Đang kiểm tra kết nối Gemini.');
      } else {
        if (action !== 'poll') pollDeadline.current = Date.now() + 120000;
        let value;
        if (canCreate) {
          value = await client.json('/api/gemini/projects/setup', {
            method:action === 'create' ? 'POST' : 'GET', cache:'no-store',
            ...(action === 'create' ? { headers:{'Content-Type':'application/json'}, body:JSON.stringify({ confirmed:true }) } : {}),
            signal:entry.controller.signal, timeoutMs:action === 'create' ? 90000 : 45000,
          });
        }
        if (!value || action === 'detect' && (value.state === 'idle' || force && value.state === 'selected')) {
          value = await client.json('/api/gemini/projects/detect', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ force }), signal:entry.controller.signal, timeoutMs:45000 });
        }
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
  }, [supported, canCreate, oauth?.connected, owner, choice, client, onSelected, onBusyChange]);
  useEffect(() => {
    if (!canCreate || !oauth?.connected || result?.state !== 'creating' || busy) return;
    if (Date.now() >= pollDeadline.current) {
      setNotice('Google cần thêm thời gian. Bấm Tiếp tục kiểm tra để xem kết quả; lần tạo được giữ khi bạn rời trang.');
      return;
    }
    const timer = window.setTimeout(() => { void run('poll'); }, 2500);
    return () => window.clearTimeout(timer);
  }, [canCreate, oauth?.connected, result?.state, busy, run]);
  useEffect(() => {
    if (!supported || !oauth?.connected || oauth.connecting || oauth.project_id || !owner || attempted.current === owner) return;
    attempted.current = owner; void run('detect');
  }, [supported, oauth?.connected, oauth?.connecting, oauth?.project_id, owner, run]);
  if (!oauth?.connected || oauth.connecting) return null;
  const data = result || oauth.project_discovery;
  const options = Array.isArray(data?.projects) ? data.projects : [];
  return <section className="gemini-project-picker" aria-label="Tự chọn Google Cloud project">
    <strong>{oauth.project_id ? 'Project đã kết nối' : 'Google đã cấp quyền · Chọn project để dùng Gemini'}</strong>
    <p role="status">{busy ? actionInFlight === 'create' ? 'Đang tạo project riêng của bạn…' : 'Đang kiểm tra project của tài khoản Google này…' : notice || (oauth.project_id ? `Đang dùng ${oauth.project_id}.` : data?.message || 'ReupAI tự tìm project; nếu chỉ có một project phù hợp, ứng dụng sẽ tự điền và lưu ID.')}</p>
    {supported ? <>
      {data?.state === 'reauthorization_required' && onReconnect && <button className="btn primary" type="button" disabled={busy} onClick={onReconnect}>Cấp lại quyền Google</button>}
      {canCreate && !oauth.project_id && ['no_projects','retry_required','terms_required','permission_required'].includes(data?.state) && <div className="gemini-project-create"><button className="btn primary" type="button" disabled={busy} onClick={() => run('create')}>{data.state === 'no_projects' ? 'Tự tạo project và kết nối' : 'Thử tạo lại project'}</button><small>Tạo project riêng trong tài khoản Google này, lưu ID và bật Gemini. ReupAI không liên kết tài khoản thanh toán; Google có thể yêu cầu bạn hoàn tất điều khoản hoặc cấp quyền tạo project.</small></div>}
      {options.length > 0 && (!data?.project_id || options.length > 1) && <div className="settings-form"><label htmlFor="gemini-project-options">Project của {oauth.google_email || 'bạn'}<select id="gemini-project-options" value={choice} onChange={event => setChoice(event.target.value)} disabled={busy}><option value="">Chọn project…</option>{options.map(item => <option value={item.project_id} key={item.project_id}>{item.display_name} · {item.project_id}</option>)}</select></label><button className="btn primary" type="button" disabled={busy || !choice} onClick={() => run('select')}>Dùng project này</button></div>}
      <div className="settings-actions"><button className="btn" type="button" disabled={busy} onClick={() => run('detect', true)}>{busy ? 'Đang kiểm tra…' : data?.state === 'creating' ? 'Tiếp tục kiểm tra' : 'Tìm lại project'}</button><a className="btn" href="https://console.cloud.google.com/cloud-resource-manager" target="_blank" rel="noreferrer">Mở Google Cloud</a></div>
    </> : <p><Link href="/local-engine">Cập nhật Local Engine</Link> để tự tìm và điền Project ID.</p>}
    {!oauth.project_id && !canCreate && <small>Cập nhật Local Engine để có nút tự tạo project. Bạn vẫn có thể mở Google Cloud bằng đúng tài khoản vừa cấp quyền để tạo thủ công.</small>}
  </section>;
}
