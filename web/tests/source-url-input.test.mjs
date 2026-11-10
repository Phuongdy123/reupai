import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSourceInput, isDirectVideoInput } from '../src/lib/source-url-input.js';

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
