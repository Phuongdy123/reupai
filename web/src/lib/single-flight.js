// Share the in-flight result for the same action, including calls from a new card.
export function createSingleFlight() {
  const pending = new Map();
  return (key, action) => {
    if (pending.has(key)) return pending.get(key);
    const result = Promise.resolve().then(action).finally(() => pending.delete(key));
    pending.set(key, result);
    return result;
  };
}
