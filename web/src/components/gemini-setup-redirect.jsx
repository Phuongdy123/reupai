"use client";

import { useEffect } from 'react';
import { GEMINI_ONBOARDING_KEY } from '../lib/gemini-onboarding';

export function GeminiSetupRedirect() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(GEMINI_ONBOARDING_KEY);
    } catch {}
  }, []);
  return null;
}
