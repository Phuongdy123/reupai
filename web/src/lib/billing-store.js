const CACHE_MS = 30000;

// This cache is for display only. Job quota and checkout remain server-authoritative.
export function createBillingStore({ fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
  const initial = { account: null, error: null, refreshing: false };
  let snapshot = initial;
  let fetchedAt = null;
  let pending = null;
  let controller;
  let generation = 0;
  let started = false;
  const listeners = new Set();
  const publish = (value) => { snapshot = value; listeners.forEach((listener) => listener()); };
  const load = ({ force = false } = {}) => {
    started = true;
    if (pending) return pending;
    const proExpired = snapshot.account?.plan === 'pro' && Date.parse(snapshot.account.proUntil) <= now();
    if (!force && !proExpired && !snapshot.error && fetchedAt !== null && now() - fetchedAt < CACHE_MS) return Promise.resolve(snapshot.account);
    const requestGeneration = generation;
    controller = new AbortController();
    const signal = controller.signal;
    pending = Promise.resolve().then(async () => {
      const response = await fetcher('/api/billing/me', { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
      const account = await response.json();
      if (!response.ok) throw new Error(account.error || 'Không đọc được thông tin gói.');
      if (!account || typeof account !== 'object' || Array.isArray(account)) throw new Error('Thông tin gói trả về không hợp lệ.');
      if (requestGeneration === generation) {
        fetchedAt = now();
        publish({ account, error: null, refreshing: false });
      }
      return account;
    }).catch((error) => {
      if (requestGeneration === generation) publish({ ...snapshot, error: error.message || 'Không đọc được thông tin gói.', refreshing: false });
      throw error;
    }).finally(() => { if (requestGeneration === generation) pending = null; });
    publish({ ...snapshot, refreshing: true });
    return pending;
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    load,
    reset() {
      generation++;
      controller?.abort();
      pending = null;
      fetchedAt = null;
      publish(initial);
    },
    isUsed: () => started,
  };
}
