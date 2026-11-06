import assert from 'node:assert/strict';
import test from 'node:test';
import { googleConsentUrl, navigateGoogleConsent, googleConsentLabel } from '../src/lib/google-consent.js';

const url = 'https://accounts.google.com/o/oauth2/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A49123%2F&state=fixture';
const oauth = { connecting: true, phase: 'awaiting_google', authorization_url: url, expires_at: 2000 };

test('automatically navigates once per live Google attempt without requiring a popup', () => {
  const navigations = [], seen = { current: null };
  assert.equal(navigateGoogleConsent(oauth, value => navigations.push(value), seen, 1000000), true);
  assert.equal(navigateGoogleConsent(oauth, value => navigations.push(value), seen, 1000000), false);
  assert.deepEqual(navigations, [url]);
  assert.equal(navigateGoogleConsent({ ...oauth, authorization_url: url + '-retry' }, value => navigations.push(value), seen, 1000000), true);
});

test('does not navigate for expired, cancelled or invalid attempts', () => {
  const navigate = () => assert.fail('Navigation must not run');
  for (const value of [{ ...oauth, expires_at: 10 }, { ...oauth, connecting: false }, { ...oauth, authorization_url: 'javascript:alert(1)' }]) {
    assert.equal(navigateGoogleConsent(value, navigate, { current: null }, 1000000), false);
  }
  for (const value of [url.replace('accounts.google.com', 'accounts.google.com.evil.test'), url.replace('https:', 'http:'), url.replace('49123', '0'), url.replace('accounts.google.com', 'accounts.google.com:8443')]) {
    assert.equal(googleConsentUrl(value), null);
  }
});

test('labels distinguish browser consent from token exchange and API setup', () => {
  assert.equal(googleConsentLabel({ phase:'exchanging' }), 'Đang nhận quyền từ Google');
  assert.equal(googleConsentLabel({ phase:'checking_api' }), 'Đang kiểm tra kết nối Gemini');
});
