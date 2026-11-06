import test from 'node:test';
import assert from 'node:assert/strict';
import { settleGeminiEnablement as settle } from '../src/lib/gemini-enablement.js';

test('successful enable request keeps polling through Google propagation delay', () => {
  const started = settle({ state:'enabling', ready:false }, null, 'one|project', 1000);
  const delayed = settle({ state:'disabled', ready:false }, started.pending, 'one|project', 6000);
  assert.equal(delayed.result.state, 'enabling');
  assert.equal(delayed.result.ready, false);
  assert.equal(delayed.pending.until, 301000);
  assert.equal(settle({ state:'disabled' }, delayed.pending, 'one|project', 301001).result.state, 'disabled');
});
test('readiness, account switch and permission denial end the pending state', () => {
  const pending = { key:'one|project', until:301000 };
  assert.equal(settle({ ready:true }, pending, 'one|project', 10000).pending, null);
  assert.equal(settle({ state:'disabled' }, pending, 'two|project', 10000).result.state, 'disabled');
  assert.equal(settle({ state:'permission_denied' }, pending, 'one|project', 10000).result.state, 'permission_denied');
});
test('transient network error keeps retrying only within the existing window', () => {
  const pending = { key:'one|project', until:301000 };
  assert.equal(settle({ state:'temporary_error' }, pending, 'one|project', 10000).result.state, 'enabling');
  assert.equal(settle({ state:'temporary_error' }, pending, 'one|project', 302000).result.state, 'temporary_error');
});
