import assert from 'node:assert/strict';
import test from 'node:test';
import { createSingleFlight } from '../src/lib/single-flight.js';
import { LocalEngineClient } from '../src/lib/local-engine-client.js';

test('concurrent calls share one action and allow retry after rejection', async () => {
  const run = createSingleFlight();
  let reject, calls = 0;
  const action = () => { calls++; return new Promise((_, fail) => { reject = fail; }); };
  const first = run('video', action);
  const second = run('video', action);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  reject(new Error('network unavailable'));
  await assert.rejects(first, /network unavailable/);
  assert.equal(await run('video', () => 'retried'), 'retried');
  assert.equal(await run('other', () => 'independent'), 'independent');
});

function mockFetch() {
  globalThis.window = {
    localStorage: { getItem: () => null }, setTimeout, clearTimeout,
    fetch: (_, { signal }) => new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  };
}

test('engine requests retain their timeout when a lifetime signal is supplied', async () => {
  mockFetch();
  try {
    const lifetime = new AbortController();
    await assert.rejects(new LocalEngineClient().request('/api/test', { signal: lifetime.signal, timeoutMs: 15 }), /abort/i);
    assert.equal(lifetime.signal.aborted, false);
  } finally { delete globalThis.window; }
});

test('leaving the page aborts an engine request before its timeout', async () => {
  mockFetch();
  try {
    const lifetime = new AbortController();
    const request = new LocalEngineClient().request('/api/test', { signal: lifetime.signal, timeoutMs: 30000 });
    lifetime.abort();
    await assert.rejects(request, /abort/i);
  } finally { delete globalThis.window; }
});
