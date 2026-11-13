"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { createBillingStore } from '../lib/billing-store';
import { isSupabaseConfigured } from '../lib/supabase/config';

const BillingContext = createContext(null);

const guestSnapshot = { account: null, error: null, refreshing: false };
const guestStore = {
  subscribe: () => () => {}, getSnapshot: () => guestSnapshot, getServerSnapshot: () => guestSnapshot,
  load: async () => null,
};

export function BillingGuestProvider({ children }) {
  return <BillingContext.Provider value={guestStore}>{children}</BillingContext.Provider>;
}

export function BillingProvider({ children }) {
  const [store] = useState(() => createBillingStore());
  useEffect(() => {
    const reload = (force = false) => {
      if (store.isUsed() && document.visibilityState === 'visible') store.load({ force }).catch(() => {});
    };
    const onVisible = () => reload();
    const onChanged = () => reload(true);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('reupai:billing-changed', onChanged);
    document.addEventListener('visibilitychange', onVisible);
    let expiryTimer;
    const scheduleExpiry = () => {
      window.clearTimeout(expiryTimer);
      const account = store.getSnapshot().account;
      const remaining = Date.parse(account?.proUntil) - Date.now();
      if (account?.plan === 'pro' && remaining > 0) expiryTimer = window.setTimeout(onChanged, Math.min(remaining + 1000, 2147483647));
    };
    const unsubscribe = store.subscribe(scheduleExpiry);
    let previousUser;
    let active = true;
    let subscription;
    if (isSupabaseConfigured()) import('../lib/supabase/client').then(({ createClient }) => {
      if (!active) return;
      subscription = createClient().auth.onAuthStateChange((event, session) => {
        const user = session?.user?.id || null;
        if ((previousUser !== undefined && previousUser !== user) || event === 'SIGNED_OUT') {
          store.reset();
          reload(true);
        }
        previousUser = user;
      }).data.subscription;
    }).catch(() => {});
    return () => {
      active = false;
      unsubscribe();
      subscription?.unsubscribe();
      window.clearTimeout(expiryTimer);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('reupai:billing-changed', onChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store]);
  return <BillingContext.Provider value={store}>{children}</BillingContext.Provider>;
}

export function useBilling() {
  const store = useContext(BillingContext);
  if (!store) throw new Error('useBilling requires BillingProvider');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => { store.load().catch(() => {}); }, [store]);
  return { ...snapshot, refresh: store.load };
}

export function BillingNotice({ error, refresh }) {
  if (!error) return null;
  return <div className="billing-load-notice" role="status"><span>Chưa cập nhật được thông tin gói. {error}</span><button type="button" onClick={() => refresh({ force: true }).catch(() => {})}>Thử lại</button></div>;
}
