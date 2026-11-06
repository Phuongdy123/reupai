"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { googleConsentLabel, googleConsentUrl, navigateGoogleConsent } from '../lib/google-consent';

export function GoogleConsentPrompt({ oauth }) {
  const seen = useRef(null);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const url = googleConsentUrl(oauth?.authorization_url);
  const expired = Boolean(oauth?.expires_at && oauth.expires_at * 1000 <= now);
  useEffect(() => {
    try { navigateGoogleConsent(oauth, value => window.location.assign(value), seen); }
    catch { setNotice('Trình duyệt chưa chuyển trang. Bấm Mở Google để tiếp tục.'); }
  }, [oauth?.connecting, oauth?.authorization_url, oauth?.expires_at]);
  useEffect(() => {
    if (!oauth?.connecting || !oauth?.expires_at) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [oauth?.connecting, oauth?.expires_at]);
  if (!oauth?.connecting) return null;
  async function copy() {
    try { await navigator.clipboard.writeText(url); setNotice('Đã sao chép. Dán liên kết vào trình duyệt trên máy này để cấp quyền.'); }
    catch { setNotice('Chưa sao chép được. Bạn có thể bấm Mở Google để tiếp tục.'); }
  }
  return <div className="google-consent-prompt" role="status" aria-live="polite">
    <strong>{googleConsentLabel(oauth)}</strong>
    {url && !expired ? <><p>ReupAI đang tự chuyển sang Google trong trình duyệt này. Chọn tài khoản và cho phép quyền truy cập; sau đó bạn sẽ tự quay lại Cài đặt.</p><div className="settings-actions"><a className="btn primary" href={url} rel="noreferrer">Mở Google để cấp quyền</a><button className="btn" type="button" onClick={copy}>Sao chép liên kết</button></div><small>Liên kết còn hiệu lực khoảng {Math.max(0, Math.ceil((oauth.expires_at * 1000 - now) / 1000))} giây. Chỉ mở trên máy đang chạy ReupAI.</small></>
      : expired ? <p>Liên kết đã hết hạn. Bấm Dừng chờ, rồi Kết nối Google để tạo lượt mới.</p>
      : oauth.phase ? <p>{['exchanging','checking_api'].includes(oauth.phase) ? 'Google đã gửi xác nhận. ReupAI đang hoàn tất kết nối, bạn chưa cần thao tác thêm.' : 'Đang chuẩn bị liên kết đăng nhập Google…'}</p>
      : <p>Nếu trang Google không tự mở, hãy <Link href="/local-engine">cập nhật Local Engine</Link> để dùng luồng tự động trong trình duyệt hiện tại.</p>}
    {notice && <p>{notice}</p>}
  </div>;
}
