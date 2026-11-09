"use client";

import { useRef, useState } from 'react';
import { Icon } from './icon';
import { FEEDBACK_CATEGORIES } from '../lib/customer-feedback';

const EMPTY = { category: 'bug', subject: '', message: '', link: '', details: '' };
export function CustomerFeedbackPage() {
  const [form, setForm] = useState(EMPTY), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [receipt, setReceipt] = useState(null);
  const attempt = useRef(null), submitting = useRef(false);
  const change = event => setForm(value => ({ ...value, [event.target.name]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setReceipt(null);
    const snapshot = JSON.stringify(form);
    if (attempt.current?.snapshot !== snapshot) attempt.current = { snapshot, requestId: crypto.randomUUID() };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, requestId: attempt.current.requestId }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) attempt.current = null;
        throw new Error(result.error || 'Chưa gửi được phản hồi. Hãy thử lại.');
      }
      setReceipt(result); setForm(EMPTY); attempt.current = null;
    } catch (caught) { setError(caught.name === 'AbortError' ? 'Kết nối chậm. Bạn có thể gửi lại; hệ thống sẽ kiểm tra để tránh gửi trùng.' : caught.message); }
    finally { clearTimeout(timer); submitting.current = false; setBusy(false); }
  }
  return <div className="customer-feedback-page">
    <div className="customer-feedback-intro"><span className="customer-feedback-symbol"><Icon name="mail" size={26} /></span><div><h2>Chia sẻ để ReupAI tốt hơn</h2><p>Bạn gặp lỗi hay có ý tưởng mới? Gửi trực tiếp cho đội ngũ ReupAI đọc và xử lý.</p></div></div>
    {receipt && <div className="customer-feedback-success" role="status"><Icon name="check" /><div><strong>Đã nhận phản hồi của bạn</strong><p>Cảm ơn bạn đã chia sẻ. Quản trị viên sẽ xem trong hộp thư phản hồi.</p><small>Mã phản hồi: {receipt.id}</small></div></div>}
    <div className="customer-feedback-layout"><form className="customer-feedback-form" onSubmit={submit}>
      <fieldset disabled={busy}><label>Loại phản hồi<select name="category" value={form.category} onChange={change}>{Object.entries(FEEDBACK_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Tiêu đề<input name="subject" value={form.subject} onChange={change} minLength={3} maxLength={120} required placeholder="Ví dụ: Không tải được video Bilibili trên máy của tôi" /></label>
      <label>Nội dung phản hồi<textarea name="message" value={form.message} onChange={change} minLength={10} maxLength={4000} required rows={6} placeholder="Bạn đang làm gì, lỗi xảy ra ở bước nào và bạn mong đợi điều gì?" /><small>{form.message.length}/4.000 ký tự</small></label>
      <label>Link video liên quan <span>(không bắt buộc)</span><input type="url" name="link" value={form.link} onChange={change} maxLength={2048} placeholder="https://www.bilibili.com/video/…" /></label>
      <details className="customer-feedback-details"><summary>Thêm chi tiết lỗi <span>Không bắt buộc</span></summary><label>Nhật ký hoặc thông báo lỗi<textarea name="details" value={form.details} onChange={change} maxLength={6000} rows={5} placeholder="Bạn có thể sao chép thông báo từ mục Chi tiết kỹ thuật rồi dán vào đây." /></label></details>
      </fieldset>
      {error && <p className="customer-feedback-error" role="alert">{error}</p>}
      <div className="customer-feedback-submit"><small>Nội dung được gửi cùng tên và email tài khoản ReupAI của bạn.</small><button className="btn primary" type="submit" disabled={busy}><Icon name="mail" size={17} />{busy ? 'Đang gửi…' : 'Gửi phản hồi'}</button></div>
    </form><aside className="customer-feedback-guide"><h3>Để hỗ trợ bạn nhanh hơn</h3><ul><li>Mô tả thao tác trước khi xảy ra lỗi.</li><li>Gửi link video nếu lỗi liên quan đến video.</li><li>Dán thông báo lỗi hoặc mã lỗi cụ thể.</li></ul><p>Không gửi mật khẩu, API key hoặc mã xác thực trong phản hồi.</p><div><Icon name="lock" size={18} /><span>Chỉ quản trị viên ReupAI có thể đọc hộp thư phản hồi.</span></div></aside></div>
  </div>;
}
