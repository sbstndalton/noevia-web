// Account preferences that follow the person between browsers (#227 notifications, #230 input,
// #231 locale). The server record (/api/account/preferences) is the truth; a copy is cached in
// localStorage so the composer and notifications honour the choice before the first fetch
// returns and when the network is gone. `noevia:` key because cowork-* keys are frozen contracts.
import { useEffect, useSyncExternalStore } from 'react';
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
// #905: the account the cached copy belongs to. The cache is per account, not per device: a second
// account signing in on this browser must not get the first one's language, Enter behaviour or
// notification choices while (or if never) its own record loads.
export const PREFERENCES_OWNER_KEY = 'noevia:account-preferences-owner';

export const DEFAULT_PREFERENCES: AccountPreferences = { notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'system' };

/** Labels for each event, named by what happened. Only events noevia produces are listed. */
export const NOTIFICATION_EVENTS: { id: NotificationEvent; label: string; description: string }[] = [
  { id: 'replyFinished', label: 'Reply finished', description: 'A reply finished, or could not finish, while you were in another tab.' },
  { id: 'approvalNeeded', label: 'Approval needed', description: 'A tool wants to change something and is waiting for your decision.' },
];

/** Interface locales (#231): the language of the interface and the format of dates and numbers.
 *  Each has a catalogue in src/i18n; language names stay in their own language. */
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
// Bumped whenever the account changes, so an answer still in flight for the previous account is dropped.
let generation = 0;
export function loadPreferences(): Promise<AccountPreferences> {
  const asked = generation;
  loading ??= apiFetch('/api/account/preferences').then(async (r) => {
    if (!r.ok) throw Error('Preferences could not be loaded.');
    const next = normalisePreferences(await r.json());
    if (asked !== generation) return current;
    loaded = true;
    publish(next);
    return next;
  }).finally(() => { if (asked === generation) loading = null; });
  return loading;
}

/** Back to the defaults in memory and on the device; the next mount asks the account again. */
function forget(): void {
  generation += 1;
  current = { ...DEFAULT_PREFERENCES };
  loaded = false;
  loading = null;
  try { localStorage.removeItem(PREFERENCES_CACHE_KEY); } catch { /* storage unavailable */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PREFERENCES_CHANGED));
}

/** Sign-in (#905): keep the cached copy only when it was saved by this same account. A cache with
 *  no recorded owner predates the owner key and is treated as someone else's. */
export function claimPreferences(userId: string): void {
  if (!userId) return;
  let owner: string | null = null;
  try { owner = localStorage.getItem(PREFERENCES_OWNER_KEY); } catch { /* storage unavailable */ }
  if (owner !== userId) forget();
  try { localStorage.setItem(PREFERENCES_OWNER_KEY, userId); } catch { /* storage unavailable */ }
}

/** Sign-out (#905): nothing of this account's preferences stays on the device or in memory. */
export function clearPreferences(): void {
  forget();
  try { localStorage.removeItem(PREFERENCES_OWNER_KEY); } catch { /* storage unavailable */ }
}

export async function savePreferences(patch: { notifications?: Partial<Record<NotificationEvent, boolean>>; sendKey?: SendKey; locale?: string }): Promise<AccountPreferences> {
  const asked = generation;
  const r = await apiFetch('/api/account/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(body.error || 'Could not save. Try again.');
  const next = normalisePreferences(body);
  // #905: the account changed while the save was in flight; its answer is not this account's.
  if (asked !== generation) return next;
  publish(next);
  return next;
}

function subscribePreferences(onChange: () => void): () => void {
  window.addEventListener(PREFERENCES_CHANGED, onChange);
  return () => window.removeEventListener(PREFERENCES_CHANGED, onChange);
}

/** The cached preferences, refreshed from the account once per page load.
 *  Read through useSyncExternalStore (#635): the account's answer can arrive between a component's
 *  render and the moment its effects subscribe (a long list of replies mounting, a slow device), and a
 *  useState copy taken at render then keeps the cached language of another browser until the next
 *  reload. The store re-reads on subscribing and on every change, so no component can miss it. */
export function useAccountPreferences(): AccountPreferences {
  const value = useSyncExternalStore(subscribePreferences, currentPreferences, currentPreferences);
  useEffect(() => { if (!loaded) void loadPreferences().catch(() => undefined); }, []);
  return value;
}
