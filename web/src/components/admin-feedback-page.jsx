"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '../lib/customer-feedback';
import { Icon } from './icon';

export function AdminFeedbackPage() {
  const [items, setItems] = useState([]), [page, setPage] = useState(0), [hasMore, setHasMore] = useState(false);
  const offsets = useRef([0]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current; setLoading(true); setError('');
    try {
      const response = await fetch(`/api/admin/feedback?offset=${offsets.current[page] || 0}`, { cache: 'no-store' });
      const data = await response.json();
      if (current !== sequence.current) return;
      if (!response.ok) throw new Error(data.error || 'Không tải được phản hồi.');
      setItems(data.items || []); setHasMore(Boolean(data.hasMore));
      offsets.current[page + 1] = data.nextOffset ?? (offsets.current[page] || 0) + 20;
    } catch (caught) { if (current === sequence.current) setError(caught.message); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [page]);
  useEffect(() => { load(); return () => { sequence.current += 1; }; }, [load]);
  async function mark(id, status) {
    const current = ++sequence.current;
    setBusy(id); setError('');
    try {
      const response = await fetch('/api/admin/feedback', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
      const data = await response.json();
      if (current !== sequence.current) return;
      if (!response.ok) throw new Error(data.error || 'Không cập nhật được phản hồi.');
      setItems(values => values.map(item => item.id === id ? data.item : item));
    } catch (caught) { if (current === sequence.current) setError(caught.message); }
    finally { setBusy(''); }
  }
  return <div className="customer-feedback-page admin-feedback-page"><div className="native-toolbar"><div><h2>Hộp thư phản hồi</h2><p>Phản hồi mới nhất của khách hàng, kèm tài khoản gửi và chi tiết lỗi.</p></div><button className="btn" disabled={loading || Boolean(busy)} onClick={load}><Icon name="refresh" size={16} />Làm mới</button></div>
    {error && <p className="customer-feedback-error" role="alert">{error}</p>}
    {loading ? <p className="native-loading" role="status">Đang tải phản hồi…</p> : !error && items.length === 0 ? <div className="native-empty"><Icon name="mail" size={30} /><h3>Chưa có phản hồi</h3><p>Khách gửi từ mục Gửi phản hồi sẽ xuất hiện tại đây.</p></div> : <div className="admin-feedback-list">{items.map(item => <article key={item.id} className={`admin-feedback-card is-${item.status}`}>
      <header><span className={`customer-feedback-status is-${item.status}`}>{item.unavailable ? 'Cần kiểm tra lại' : FEEDBACK_STATUSES[item.status] || item.status}</span><span>{FEEDBACK_CATEGORIES[item.category] || 'Phản hồi'}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('vi-VN')}</time></header>
      <h3>{item.subject}</h3><p className="admin-feedback-sender">{item.displayName || 'Khách hàng'} · {item.email}</p><p className="admin-feedback-message">{item.message}</p>
      {item.link && /^https?:\/\//i.test(item.link) && <a className="admin-feedback-video-link" href={item.link} target="_blank" rel="noopener noreferrer nofollow">Mở link video <Icon name="external" size={14} /></a>}
      {item.details && <details className="customer-feedback-details"><summary>Chi tiết kỹ thuật</summary><pre>{item.details}</pre></details>}
      <footer><small>Mã: {item.id}</small>{!item.unavailable && <label>Trạng thái<select aria-label={`Trạng thái phản hồi ${item.subject}`} value={item.status} onChange={event => mark(item.id, event.target.value)} disabled={Boolean(busy)}>{Object.entries(FEEDBACK_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}</footer>
    </article>)}</div>}
    <nav className="customer-feedback-pagination" aria-label="Trang phản hồi"><button className="btn" disabled={!page || loading || Boolean(busy)} onClick={() => setPage(value => value - 1)}>Trang trước</button><span>Trang {page + 1}</span><button className="btn" disabled={!hasMore || loading || Boolean(busy)} onClick={() => setPage(value => value + 1)}>Trang sau</button></nav>
  </div>;
}
