"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

export function GeminiProjectPicker({ client, supported, canCreate, canReplace, oauth, access, onSelected, onBusyChange, onReconnect }) {
  const [result, setResult] = useState(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionInFlight, setActionInFlight] = useState('');
  const request = useRef(null), attempted = useRef(null), autoStepAttempted = useRef(new Set()), alive = useRef(true);
  const pollDeadline = useRef(0);
  const owner = oauth?.google_subject || oauth?.google_email || '';
  const currentOwner = useRef(owner); currentOwner.current = owner;
  useEffect(() => {
    alive.current = true; attempted.current = null; autoStepAttempted.current.clear(); setResult(null); setNotice(''); setChoice(''); setBusy(false);
    return () => {
      alive.current = false; request.current?.controller.abort(); request.current = null; onBusyChange(false);
    };
  }, [owner, onBusyChange]);
  const run = useCallback(async (action, force = false, explicitProjectId = '') => {
    if (!supported || !oauth?.connected || request.current) return;
    const selectedId = explicitProjectId || choice;
    const entry = { controller: new AbortController(), owner };
    request.current = entry; setBusy(true); setActionInFlight(action); onBusyChange(true); setNotice('');
    try {
      if (action === 'select') {
        if (!selectedId) return;
        await client.json('/api/gemini/project', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ project_id:selectedId }), signal:entry.controller.signal });
        if (!alive.current || currentOwner.current !== entry.owner) return;
        setChoice(selectedId);
        await onSelected(selectedId); setNotice(`Đã tự chọn project ${selectedId}. Đang kích hoạt Gemini…`);
      } else {
        if (action !== 'poll') pollDeadline.current = Date.now() + 120000;
        let value;
        if (canCreate) {
          value = await client.json('/api/gemini/projects/setup', {
            method:['create', 'replace'].includes(action) ? 'POST' : 'GET', cache:'no-store',
            ...(['create', 'replace'].includes(action) ? { headers:{'Content-Type':'application/json'}, body:JSON.stringify({ confirmed:true, ...(action === 'replace' ? { replace_project:oauth.project_id } : {}) }) } : {}),
            signal:entry.controller.signal, timeoutMs:['create', 'replace'].includes(action) ? 90000 : 45000,
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
  }, [supported, canCreate, oauth?.connected, oauth?.project_id, owner, choice, client, onSelected, onBusyChange]);
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
  const data = result || oauth?.project_discovery;
  const options = Array.isArray(data?.projects) ? data.projects : [];
  useEffect(() => {
    if (!supported || !oauth?.connected || oauth.connecting || busy || !owner) return;
    if (!oauth.project_id && options.length > 0 && data?.state === 'choose_project') {
      const key = `auto-select:${owner}`;
      if (!autoStepAttempted.current.has(key)) {
        autoStepAttempted.current.add(key);
        const preferred = options.find((p) => String(p.project_id || '').startsWith('reupai-') && p.setup_eligible !== false)
          || options.find((p) => p.setup_eligible !== false)
          || options[0];
        if (preferred?.project_id) {
          void run('select', false, preferred.project_id);
          return;
        }
      }
    }
    if (canCreate && !oauth.project_id && ['no_projects', 'no_suitable_projects'].includes(data?.state)) {
      const key = `auto-create:${owner}`;
      if (!autoStepAttempted.current.has(key)) {
        autoStepAttempted.current.add(key);
        void run('create');
        return;
      }
    }
    if (canCreate && canReplace && oauth.project_id && ['administrator_required', 'quota_permission_required', 'permission_denied'].includes(access?.state)) {
      const key = `auto-replace:${owner}:${oauth.project_id}`;
      if (!autoStepAttempted.current.has(key)) {
        autoStepAttempted.current.add(key);
        void run('replace');
      }
    }
  }, [supported, canCreate, canReplace, oauth?.connected, oauth?.connecting, oauth?.project_id, busy, owner, data?.state, options, access?.state, run]);
  if (!oauth?.connected || oauth.connecting) return null;
  return <section className="gemini-project-picker" aria-label="Tự chọn Google Cloud project">
    <strong>{oauth.project_id ? `Project đang dùng: ${oauth.project_id}` : 'Đang tự động hoàn tất Project Gemini…'}</strong>
    <p role="status">{busy ? (['create', 'replace'].includes(actionInFlight) ? 'Đang tự động tạo project Google Cloud riêng cho bạn…' : actionInFlight === 'select' ? 'Đang lưu và kích hoạt Gemini API…' : 'Đang tự tìm project phù hợp…') : notice || (oauth.project_id ? (access?.ready ? 'Đã tự động thiết lập xong Project và bật Gemini API.' : `Đang dùng ${oauth.project_id}.`) : data?.message || 'ReupAI đang tự động chọn hoặc tạo project và bật Gemini cho bạn.')}</p>
    {supported ? <>
      {data?.state === 'reauthorization_required' && onReconnect && <button className="btn primary" type="button" disabled={busy} onClick={onReconnect}>Cấp lại quyền Google</button>}
      {canCreate && !oauth.project_id && ['retry_required', 'terms_required', 'permission_required'].includes(data?.state) && <div className="gemini-project-create"><button className="btn primary" type="button" disabled={busy} onClick={() => run('create')}>Thử tạo lại project</button><small>Tạo project riêng trong tài khoản Google này, lưu ID và bật Gemini. ReupAI không liên kết tài khoản thanh toán; Google có thể yêu cầu bạn hoàn tất điều khoản hoặc cấp quyền tạo project.</small></div>}
      {options.length > 1 && <details style={{ marginTop: '8px' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.88rem', opacity: 0.85 }}>Đổi sang project khác ({options.length} project)</summary>
        <div className="settings-form" style={{ marginTop: '8px' }}>
          <label htmlFor="gemini-project-options">Project của {oauth.google_email || 'bạn'}<select id="gemini-project-options" value={choice || oauth.project_id || ''} onChange={event => setChoice(event.target.value)} disabled={busy}><option value="">Chọn project…</option>{options.map(item => <option value={item.project_id} key={item.project_id}>{item.display_name} · {item.project_id}</option>)}</select></label>
          <div className="settings-actions">
            <button className="btn primary" type="button" disabled={busy || !choice} onClick={() => run('select')}>Dùng project này</button>
            <button className="btn" type="button" disabled={busy} onClick={() => run('detect', true)}>{busy ? 'Đang kiểm tra…' : 'Tìm lại project'}</button>
          </div>
        </div>
      </details>}
      {data?.state === 'creating' && <div className="settings-actions"><button className="btn" type="button" disabled={busy} onClick={() => run('poll')}>Tiếp tục kiểm tra</button></div>}
    </> : <p><Link href="/local-engine">Cập nhật Local Engine</Link> để tự tìm và điền Project ID.</p>}
    {!oauth.project_id && !canCreate && <small>Cập nhật Local Engine để có nút tự tạo project. Bạn vẫn có thể mở Google Cloud bằng đúng tài khoản vừa cấp quyền để tạo thủ công.</small>}
  </section>;
}
