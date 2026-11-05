import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifiedRelease } from '../src/lib/engine-release.js';
import { newerVersion } from '../src/lib/engine-version.js';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const release = { downloadUrl: 'https://github.com/Phuongdy123/reupai/releases/download/v0.2.35/ReupAI-Setup-0.2.35.exe', format: 1, platform: 'windows-x64', sha256: 'a'.repeat(64), size: 100, version: '0.2.35' };
const signed = value => ({ release: value, signature: sign(null, Buffer.from(JSON.stringify(value, Object.keys(value).sort())), keys.privateKey).toString('base64') });

test('release document requires its pinned signature, canonical object order and valid metadata', () => {
  const document = signed(release);
  document.release = Object.fromEntries(Object.entries(release).reverse());
  assert.equal(verifiedRelease(document, publicKey).version, '0.2.35');
  assert.throws(() => verifiedRelease({ ...document, release: { ...release, size: 101 } }, publicKey));
  assert.throws(() => verifiedRelease(document));
});
test('even signed documents cannot point outside the official release channel', () => {
  for (const changes of [{ downloadUrl: 'https://example.com/setup.exe' }, { sha256: 'bad' }, { platform: 'linux' }, { size: -1 }]) {
    assert.throws(() => verifiedRelease(signed({ ...release, ...changes }), publicKey));
  }
});
test('version comparison offers numeric upgrades only and tolerates unknown or malformed engines', () => {
  assert.equal(newerVersion('0.2.35', '0.2.9'), true);
  assert.equal(newerVersion('0.2.35', '0.2.35'), false);
  assert.equal(newerVersion('0.2.35', '0.2.36'), false);
  for (const invalid of [null, '', '0.2', 'custom']) assert.equal(newerVersion('0.2.35', invalid), false);
});
