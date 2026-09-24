// Account preferences that follow the person between browsers (#227 notifications, #230 input,
// #231 locale). The server record (/api/account/preferences) is the truth; a copy is cached in
// localStorage so the composer and notifications honour the choice before the first fetch
// returns and when the network is gone. `noevia:` key because cowork-* keys are frozen contracts.
import { useEffect, useState } from 'react';
import { apiFetch } from './api';

export type NotificationEvent = 'replyFinished' | 'approvalNeeded';
export type SendKey = 'enter' | 'mod-enter';
export type AccountPreferences = {
  notifications: Record<NotificationEvent, boolean>;
  sendKey: SendKey;
  locale: string;
};

export const PREFERENCES_CACHE_KEY = 'noevia:account-preferences';
export const PREFERENCES_CHANGED = 'noevia:account-preferences-changed';

export const DEFAULT_PREFERENCES: AccountPreferences = { notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'system' };

/** Labels for each event, named by what happened. Only events noevia produces are listed. */
export const NOTIFICATION_EVENTS: { id: NotificationEvent; label: string; description: string }[] = [
  { id: 'replyFinished', label: 'Reply finished', description: 'A reply finished, or could not finish, while you were in another tab.' },
  { id: 'approvalNeeded', label: 'Approval needed', description: 'A tool wants to change something and is waiting for your decision.' },
];

/** Date and number formats noevia can apply. The interface text is English only (#231). */
export const LOCALE_OPTIONS: [string, string][] = [
  ['system', 'Match this browser'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['de-DE', 'Deutsch'], ['es-ES', 'Español'],
  ['fr-FR', 'Français'], ['it-IT', 'Italiano'], ['nb-NO', 'Norsk bokmål'], ['nl-NL', 'Nederlands'], ['pt-BR', 'Português (Brasil)'], ['sv-SE', 'Svenska'],
];

/** Any partial or damaged record becomes a complete one; unknown values fall back to defaults. */
export function normalisePreferences(value: unknown): AccountPreferences {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const n = (v.notifications && typeof v.notifications === 'object' ? v.notifications : {}) as Record<string, unknown>;
  return {
    notifications: {
      replyFinished: typeof n.replyFinished === 'boolean' ? n.replyFinished : true,
      approvalNeeded: typeof n.approvalNeeded === 'boolean' ? n.approvalNeeded : true,
    },
    sendKey: v.sendKey === 'mod-enter' ? 'mod-enter' : 'enter',
    locale: typeof v.locale === 'string' && LOCALE_OPTIONS.some(([id]) => id === v.locale) ? v.locale : 'system',
  };
}

type KeyLike = { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey?: boolean; isComposing?: boolean };

/** What Enter does in the composer. 'send' and 'newline' are handled by the caller; null leaves
 *  the key to the browser (which inserts a newline in a textarea). Never acts mid-IME. */
export function composerKeyAction(event: KeyLike, sendKey: SendKey): 'send' | 'newline' | null {
  if (event.key !== 'Enter' || event.isComposing) return null;
  const mod = event.metaKey || event.ctrlKey;
  if (sendKey === 'enter') return event.shiftKey ? null : 'send';
  // mod-enter: ⌘/Ctrl+Enter sends; plain Enter and Shift+Enter add a line.
  return mod && !event.shiftKey ? 'send' : null;
}

/** The hint under the composer, in the platform's words. */
export function sendHint(sendKey: SendKey, apple: boolean): string {
  const mod = apple ? '⌘' : 'Ctrl+';
  return sendKey === 'enter' ? `Enter to send · ${apple ? '⇧Enter' : 'Shift+Enter'} for a new line` : `${mod}Enter to send · Enter for a new line`;
}

/** The locale for Intl formatting: the saved choice, or undefined to let the browser decide. */
export function resolveLocale(preference: string): string | undefined {
  return preference && preference !== 'system' ? preference : undefined;
}

function readCache(): AccountPreferences {
  try { return normalisePreferences(JSON.parse(localStorage.getItem(PREFERENCES_CACHE_KEY) || 'null')); } catch { return { ...DEFAULT_PREFERENCES }; }
}

let current: AccountPreferences = typeof localStorage === 'undefined' ? { ...DEFAULT_PREFERENCES } : readCache();

function publish(next: AccountPreferences): void {
  current = next;
  try { localStorage.setItem(PREFERENCES_CACHE_KEY, JSON.stringify(next)); } catch { /* this session only */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PREFERENCES_CHANGED));
}

export function currentPreferences(): AccountPreferences { return current; }

/** Locale for dates and numbers across the app; undefined means the browser's own. */
export function appLocale(): string | undefined { return resolveLocale(current.locale); }

let loading: Promise<AccountPreferences> | null = null;
let loaded = false;
export function loadPreferences(): Promise<AccountPreferences> {
  loading ??= apiFetch('/api/account/preferences').then(async (r) => {
    if (!r.ok) throw Error('Preferences could not be loaded.');
    const next = normalisePreferences(await r.json());
    loaded = true;
    publish(next);
    return next;
  }).finally(() => { loading = null; });
  return loading;
}

export async function savePreferences(patch: { notifications?: Partial<Record<NotificationEvent, boolean>>; sendKey?: SendKey; locale?: string }): Promise<AccountPreferences> {
  const r = await apiFetch('/api/account/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(body.error || 'Could not save. Try again.');
  const next = normalisePreferences(body);
  publish(next);
  return next;
}

/** The cached preferences, refreshed from the account once per page load. */
export function useAccountPreferences(): AccountPreferences {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const update = () => setValue(current);
    window.addEventListener(PREFERENCES_CHANGED, update);
    if (!loaded) void loadPreferences().catch(() => undefined);
    return () => window.removeEventListener(PREFERENCES_CHANGED, update);
  }, []);
  return value;
}
