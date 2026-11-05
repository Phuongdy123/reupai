import { createPublicKey, verify } from 'node:crypto';
import { UPDATE_PUBLIC_KEY } from './update-public-key.js';

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

export function verifiedRelease(document, publicKey = UPDATE_PUBLIC_KEY) {
  const release = document.release;
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(canonical(release)), key, Buffer.from(document.signature, 'base64'))) throw new Error('Invalid release signature');
  if (release.format !== 1 || release.platform !== 'windows-x64' || !/^\d+\.\d+\.\d+$/.test(release.version)) throw new Error('Invalid release platform/version');
  if (!/^https:\/\/github\.com\/Phuongdy123\/reupai\/releases\/download\/[^?]+\.exe$/.test(release.downloadUrl)) throw new Error('Invalid release download');
  if (!/^[a-f0-9]{64}$/.test(release.sha256) || !Number.isSafeInteger(release.size) || release.size <= 0 || release.size > 1500 * 1024 * 1024) throw new Error('Invalid release integrity data');
  return release;
}
