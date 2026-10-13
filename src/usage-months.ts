// Usage activity grouped by calendar month for the touch day list (#1467). Pure: no React, no DOM,
// so the grouping is tested on its own (tests/client/usage-touch-months-1467.test.cjs).

export interface UsageMonth<T extends { day: string }> {
  /** 'YYYY-MM', stable across renders; the key the open month is remembered by. */
  key: string;
  year: number;
  /** 1-12. */
  month: number;
  days: T[];
}

/** Groups the days by calendar month, in the order the days arrive (the server sends them oldest
 *  first). A day string is 'YYYY-MM-DD' in the usage time zone, so the month is its first seven
 *  characters; nothing here reads a clock or a time zone. */
export function groupUsageDaysByMonth<T extends { day: string }>(days: readonly T[]): UsageMonth<T>[] {
  const byKey = new Map<string, UsageMonth<T>>();
  for (const day of days) {
    const key = day.day.slice(0, 7);
    let month = byKey.get(key);
    if (!month) {
      month = { key, year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)), days: [] };
      byKey.set(key, month);
    }
    month.days.push(day);
  }
  return [...byKey.values()];
}
