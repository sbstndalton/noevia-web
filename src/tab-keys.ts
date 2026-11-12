// Arrow-key movement for a tab list (WAI-ARIA tabs, automatic activation): ArrowLeft/ArrowRight step with wrap-around,
// Home/End jump to the ends. Pure so the key table is unit-tested without mounting React (tests/client/tab-keys-2460.test.cjs).
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count < 1) return null;
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
