import assert from 'node:assert/strict';
import test from 'node:test';
import { GEMINI_ONBOARDING_KEY, queueGeminiSetup, hasPendingGeminiSetup, hasMatchingGoogleGrant } from '../src/lib/gemini-onboarding.js';

test('registration keeps a pending Gemini step until it can be completed after account login', () => {
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
  assert.equal(hasPendingGeminiSetup(storage), false);
  queueGeminiSetup(storage);
  assert.equal(hasPendingGeminiSetup(storage), true);
  assert.equal(values.get(GEMINI_ONBOARDING_KEY), '1');
});

test('a storage failure does not turn web registration into an Engine prerequisite', () => {
  const storage = { setItem() { throw new Error('Unavailable'); }, getItem() { throw new Error('Unavailable'); } };
  assert.doesNotThrow(() => queueGeminiSetup(storage));
  assert.equal(hasPendingGeminiSetup(storage), false);
});

test('only an unexpired Google grant belonging to this web account can skip consent', () => {
  const state = { connected: true, google_email: 'customer@example.com', needs_reauthorization: false };
  assert.equal(hasMatchingGoogleGrant('CUSTOMER@example.com', state), true);
  assert.equal(hasMatchingGoogleGrant('other@example.com', state), false);
  assert.equal(hasMatchingGoogleGrant('', state), false);
  assert.equal(hasMatchingGoogleGrant('customer@example.com', { ...state, needs_reauthorization: true }), false);
  assert.equal(hasMatchingGoogleGrant('customer@example.com', { ...state, connected: false }), false);
});
