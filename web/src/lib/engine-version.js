export function newerVersion(next, current) {
  if (!/^\d+\.\d+\.\d+$/.test(next || '') || !/^\d+\.\d+\.\d+$/.test(current || '')) return false;
  const a = next.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
