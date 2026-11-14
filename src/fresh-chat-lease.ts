// #2579: a bare `/` returns to the saved last place (last-view.ts), and that can be a new chat nobody has written in yet. Two tabs
// opened on `/` would both adopt that chat's id, send into one chat and answer each other's history save with a 409. A tab showing
// an empty new chat leases its id here (a heartbeat per chat id in localStorage, shared by the tabs of one browser); a tab that loads
// while another tab holds the lease on the saved chat starts its own new chat instead, and remembers it for its own reloads
// (sessionStorage, which belongs to the tab). A tab gives its lease up when it leaves (reload included) or the chat gets a message,
// and a crashed tab's lease runs out by itself.
const KEY = 'noevia:fresh-chat-leases';
const OWN_KEY = 'noevia:tab-new-chat';
export const LEASE_MS = 10_000;
export const LEASE_BEAT_MS = 3_000;
const TAB = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Leases = Record<string, { tab: string; at: number }>;

/** The live leases: unreadable storage, a malformed entry and an expired one read as no lease. */
function read(now: number): Leases {
  const live: Leases = {};
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}') as unknown;
    if (!all || typeof all !== 'object') return live;
    for (const [chatId, v] of Object.entries(all as Record<string, unknown>)) {
      const e = v as { tab?: unknown; at?: unknown } | null;
      if (e && typeof e.tab === 'string' && typeof e.at === 'number' && e.at <= now && now - e.at < LEASE_MS) live[chatId] = { tab: e.tab, at: e.at };
    }
  } catch { /* nothing leased */ }
  return live;
}
function write(leases: Leases): void {
  try { localStorage.setItem(KEY, JSON.stringify(leases)); } catch { /* storage blocked: tabs share the place as before */ }
}

/** True while another tab of this browser is showing `chatId` as an empty new chat. */
export function leasedByAnotherTab(chatId: string, now = Date.now()): boolean {
  const lease = read(now)[chatId];
  return !!lease && lease.tab !== TAB;
}

/** This tab shows `chatId` as an empty new chat: take the lease, or renew it. */
export function holdFreshChat(chatId: string, now = Date.now()): void {
  const leases = read(now);
  leases[chatId] = { tab: TAB, at: now };
  write(leases);
}

/** Give the lease on `chatId` up if this tab holds it (the chat has a message, or the tab is leaving). */
export function releaseFreshChat(chatId: string, now = Date.now()): void {
  const leases = read(now);
  if (leases[chatId]?.tab !== TAB) return;
  delete leases[chatId];
  write(leases);
}

/** The new chat this tab started because another tab held the saved one: kept for this tab's reloads only. */
export function ownNewChat(): string | null {
  try { return sessionStorage.getItem(OWN_KEY); } catch { return null; }
}
export function rememberOwnNewChat(chatId: string | null): void {
  try { if (chatId) sessionStorage.setItem(OWN_KEY, chatId); else sessionStorage.removeItem(OWN_KEY); } catch { /* the reload starts another chat */ }
}
