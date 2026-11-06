export function googleConsentUrl(value) {
  try {
    const url = new URL(value);
    const callback = new URL(url.searchParams.get('redirect_uri'));
    if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.port || url.username || url.password ||
        !['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname) ||
        callback.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(callback.hostname) || !(Number(callback.port) > 0)) return null;
    return url.href;
  } catch { return null; }
}

export function navigateGoogleConsent(oauth, navigate, seen, now = Date.now()) {
  const url = googleConsentUrl(oauth?.authorization_url);
  if (!oauth?.connecting || !url || (oauth.expires_at && oauth.expires_at * 1000 <= now) || seen.current === url) return false;
  seen.current = url;
  navigate(url);
  return true;
}

export function googleConsentLabel(oauth) {
  if (oauth?.phase === 'preparing') return 'Đang chuẩn bị mở Google';
  if (oauth?.phase === 'exchanging') return 'Đang nhận quyền từ Google';
  if (oauth?.phase === 'checking_api') return 'Đang kiểm tra kết nối Gemini';
  return 'Đang chờ Google xác nhận';
}
