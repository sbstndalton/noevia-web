import type { UsageSummary } from './types';
import type { AuthUser } from './api';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
const count = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const totals = (value: unknown) => record(value) && ['input', 'output', 'replies'].every(key => count(value[key]));

/** Treat an invalid successful response as a load failure, not empty real data. */
export function parseUsage(value: unknown): UsageSummary {
  if (!record(value) || !['allTime', 'last7', 'last30'].every(key => totals(value[key])) ||
      !['activeDays', 'currentStreak', 'longestStreak', 'retentionDays'].every(key => count(value[key])) ||
      typeof value.timeZone !== 'string' || !Array.isArray(value.days) || !Array.isArray(value.models) ||
      !value.days.every(day => record(day) && totals(day) && typeof day.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.day) && Number.isFinite(Date.parse(day.day))) ||
      !value.models.every(model => record(model) && totals(model) && typeof model.name === 'string')) {
    throw new Error('The server returned an invalid usage response.');
  }
  return value as unknown as UsageSummary;
}

export function parseUsers(value: unknown): { users: AuthUser[] } {
  if (!record(value) || !Array.isArray(value.users) || !value.users.every(user =>
    record(user) && ['id', 'username', 'displayName'].every(key => typeof user[key] === 'string') &&
    (user.role === 'admin' || user.role === 'member'))) {
    throw new Error('The server returned an invalid users response.');
  }
  return value as { users: AuthUser[] };
}
