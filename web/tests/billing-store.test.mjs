import assert from 'node:assert/strict';
import test from 'node:test';
import { createBillingStore } from '../src/lib/billing-store.js';

const pro = { configured: true, authenticated: true, plan: 'pro', proUntil: '2030-01-01T00:00:00Z' };

test('concurrent consumers share a request and use its cached result for 30 seconds', async () => {
  let calls = 0, time = 0;
  const store = createBillingStore({ now: () => time, fetcher: async () => { calls++; return Response.json(pro); } });
  const one = store.load(), two = store.load();
  assert.equal(one, two);
  await one;
  await store.load();
  assert.equal(calls, 1);
  time = 30001;
  await store.load();
  assert.equal(calls, 2);
  await Promise.all([store.load({ force: true }), store.load({ force: true })]);
  assert.equal(calls, 3);
});

test('failed refresh retains the last confirmed plan and retry clears the error', async () => {
  let fail = false;
  const store = createBillingStore({ fetcher: async () => fail ? Response.json({ error: 'Unavailable' }, { status: 503 }) : Response.json(pro) });
  await store.load(); fail = true;
  await assert.rejects(store.load({ force: true }), /Unavailable/);
  assert.equal(store.getSnapshot().account.plan, 'pro');
  assert.equal(store.getSnapshot().error, 'Unavailable');
  fail = false; await store.load();
  assert.equal(store.getSnapshot().error, null);
});

test('changing accounts clears cached data and ignores a late response from the old account', async () => {
  let resolveOld, calls = 0;
  const store = createBillingStore({ fetcher: () => ++calls === 1 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(Response.json({ ...pro, plan: 'free' })) });
  const previous = store.load(); await Promise.resolve();
  store.reset();
  assert.equal(store.getSnapshot().account, null);
  await store.load();
  resolveOld(Response.json(pro)); await previous;
  assert.equal(store.getSnapshot().account.plan, 'free');
});

test('an expired Pro plan is refreshed even while the cache is otherwise fresh', async () => {
  let time = 1000, calls = 0;
  const store = createBillingStore({ now: () => time, fetcher: async () => Response.json(++calls === 1 ? { ...pro, proUntil: new Date(2000).toISOString() } : { ...pro, plan: 'free' }) });
  await store.load(); time = 2001;
  await store.load();
  assert.equal(store.getSnapshot().account.plan, 'free');
  assert.equal(calls, 2);
});
