"use client";

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useEngine } from './engine-provider';
import { hasPendingGeminiSetup, queueGeminiSetup } from '../lib/gemini-onboarding';

export function GeminiSetupRedirect() {
  const { status } = useEngine();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const fromConfirmation = new URLSearchParams(window.location.search).get('onboarding') === '1';
    if (fromConfirmation) queueGeminiSetup(window.localStorage);
    if (pathname === '/settings' || status !== 'connected') return;
    if (fromConfirmation || hasPendingGeminiSetup(window.localStorage)) {
      router.replace('/settings?onboarding=1#diagnostics');
    }
  }, [pathname, router, status]);
  return null;
}
