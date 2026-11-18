import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSourceInput, isDirectVideoInput, videoUrlForIdentity } from '../src/lib/source-url-input.js';

test('share text, Markdown, bare BV and locale video links select direct mode', () => {
  for (const text of ['BV1S7446fEFw', 'bilibili.com/vi/video/BV1S7446fEFw/?p=2',
    '[Video](https://www.bilibili.com/vi/video/BV1S7446fEFw/?p=2)',
    '分享 https://v.douyin.com/abc/ 复制', 'https://www.iesdouyin.com/share/video/7451234567890123456/']) {
    assert.equal(isDirectVideoInput(text), true, text);
  }
  assert.equal(prepareSourceInput('BV1S7446fEFw'), 'https://www.bilibili.com/video/BV1S7446fEFw/');
  assert.equal(prepareSourceInput('https://space.bilibili.com/vi/74443210'), 'https://space.bilibili.com/74443210');
  assert.equal(prepareSourceInput('https://m.bilibili.com/space/74443210'), 'https://space.bilibili.com/74443210');
  assert.equal(isDirectVideoInput('https://space.bilibili.com/1234'), false);
  assert.equal(isDirectVideoInput('https://space.bilibili.com/vi/74443210'), false);
  assert.equal(isDirectVideoInput('https://bilibili.com.evil.test/video/BV1S7446fEFw/'), false);
});

test('missing library rows recover the selected Bilibili episode and legacy AV ID', () => {
  assert.equal(videoUrlForIdentity('BV1S7446fEFw_p2'), 'https://www.bilibili.com/video/BV1S7446fEFw/?p=2');
  assert.equal(videoUrlForIdentity('av170001'), 'https://www.bilibili.com/video/av170001/');
  assert.equal(videoUrlForIdentity('yt_dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(videoUrlForIdentity('BV1S7446fE'), '');
});

test('all public platforms normalize and route between video and channel mode safely', () => {
  assert.equal(prepareSourceInput('Xem video https://youtu.be/dQw4w9WgXcQ nhé'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(prepareSourceInput('youtube.com/watch?v=dQw4w9WgXcQ'), 'https://youtube.com/watch?v=dQw4w9WgXcQ');
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/shorts/abcDEF12345',
    'https://vt.tiktok.com/ZS2abc/',
    'https://www.tiktok.com/@creator/video/732109876543210',
    'https://fb.watch/abcd1234/',
    'https://www.instagram.com/reel/C123456/',
    'https://x.com/user/status/1800000000',
    'https://xhslink.com/a/12345',
  ]) {
    assert.equal(isDirectVideoInput(url), true, url);
  }
  assert.equal(isDirectVideoInput('https://www.youtube.com/@handle'), false);
  assert.equal(isDirectVideoInput('https://www.youtube.com/playlist?list=PL123'), false);
  assert.equal(isDirectVideoInput('https://www.tiktok.com/@creator'), false);
  assert.equal(isDirectVideoInput('http://127.0.0.1:8080/video.mp4'), false);
});
