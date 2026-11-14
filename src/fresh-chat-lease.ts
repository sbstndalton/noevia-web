// #2579: a bare `/` returns to the saved last place (last-view.ts), and that can be a new chat nobody has written in yet. Two tabs
// opened on `/` would both adopt that chat's id, send into one chat and answer each other's history save with a 409. A tab showing
// an empty new chat leases its id here (a heartbeat in localStorage, per browser); a tab that loads while the lease is live and held
// by another tab starts its own new chat instead. A tab gives the lease up when it leaves (reload included) or the chat gets a
// message, and a crashed tab's lease runs out by itself.
const KEY = 'noevia:fresh-chat-lease';
export const LEASE_MS = 10_000;
export const LEASE_BEAT_MS = 3_000;
const TAB = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Lease = { chatId: string; tab: string; at: number };

function read(): Lease | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null') as Record<string, unknown> | null;
    return v && typeof v.chatId === 'string' && typeof v.tab === 'string' && typeof v.at === 'number' ? { chatId: v.chatId, tab: v.tab, at: v.at } : null;
  } catch { return null; }
}

/** True while another tab of this browser is showing `chatId` as an empty new chat. */
export function leasedByAnotherTab(chatId: string, now = Date.now()): boolean {
  const lease = read();
  return !!lease && lease.chatId === chatId && lease.tab !== TAB && lease.at <= now && now - lease.at < LEASE_MS;
}

/** This tab shows `chatId` as an empty new chat: take the lease, or renew it. */
export function holdFreshChat(chatId: string, now = Date.now()): void {
  try { localStorage.setItem(KEY, JSON.stringify({ chatId, tab: TAB, at: now } satisfies Lease)); } catch { /* storage blocked: tabs share the place as before */ }
}

/** Give the lease up if this tab holds it (the chat has a message, or the tab is leaving). */
export function releaseFreshChat(chatId?: string): void {
  const lease = read();
  if (!lease || lease.tab !== TAB || (chatId !== undefined && lease.chatId !== chatId)) return;
  try { localStorage.removeItem(KEY); } catch { /* nothing to release */ }
}
