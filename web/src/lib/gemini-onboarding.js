export const GEMINI_ONBOARDING_KEY = 'reupai.gemini.onboarding';

export function queueGeminiSetup(storage) {
  try { storage.setItem(GEMINI_ONBOARDING_KEY, '1'); } catch { /* Account login still works if storage is unavailable. */ }
}

export function hasPendingGeminiSetup(storage) {
  try { return storage.getItem(GEMINI_ONBOARDING_KEY) === '1'; } catch { return false; }
}

export function hasMatchingGoogleGrant(email, state) {
  return Boolean(email && state?.google_email && state.connected && !state.needs_reauthorization &&
    email.trim().toLowerCase() === state.google_email.trim().toLowerCase());
}
