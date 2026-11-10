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
  assert.equal(isDirectVideoInput('https://space.bilibili.com/1234'), false);
  assert.equal(isDirectVideoInput('https://bilibili.com.evil.test/video/BV1S7446fEFw/'), false);
});

test('missing library rows recover the selected Bilibili episode and legacy AV ID', () => {
  assert.equal(videoUrlForIdentity('BV1S7446fEFw_p2'), 'https://www.bilibili.com/video/BV1S7446fEFw/?p=2');
  assert.equal(videoUrlForIdentity('av170001'), 'https://www.bilibili.com/video/av170001/');
  assert.equal(videoUrlForIdentity('BV1S7446fE'), '');
});
