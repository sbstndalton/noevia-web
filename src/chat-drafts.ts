// Per-chat unsent composer drafts (#393).
//
// Switching chats — including across projects — must never carry an unsent
// draft into the newly opened chat: the model, routing, tools and project
// context all change with the chat, so a stale draft is one Enter press away
// from going somewhere the person never intended. At the same time, silently
// discarding a draft the moment you glance at another chat is worse than
// keeping it around, so each chat's draft is restored when you come back to
// it — including after a full page reload, which was a related gap noted in
// #393 (drafts previously lived only in un-keyed component state).
//
// Kept in localStorage, like the other `noevia:` per-device preferences
// (preferences.ts, last-view.ts) rather than synced through the account:
// an unsent draft is exactly the kind of thing you don't want following you
// to a different browser. Bounded on both axes — a cap on how many chats'
// drafts are retained (oldest-touched evicted first) and a cap on a single
// draft's length — so a browsing session that touches hundreds of chats, or
// one enormous paste, can't grow the stored blob without limit.

const KEY = 'noevia:chat-drafts';
// #791: the account the stored drafts were typed under. Drafts are keyed by chat id only, so a
// second account signing in on the same browser must never be shown (or keep around) the first
// one's unsent text: they are cleared on sign-out and dropped on a sign-in by anyone else.
const OWNER_KEY = 'noevia:chat-drafts-owner';
const MAX_CHATS = 50;
const MAX_DRAFT_CHARS = 20_000;

type DraftStore = Record<string, { text: string; updatedAt: number }>;

function readStore(): DraftStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const store: DraftStore = {};
    for (const [chatId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!chatId || !entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.text === 'string' && typeof e.updatedAt === 'number') store[chatId] = { text: e.text, updatedAt: e.updatedAt };
    }
    return store;
  } catch {
    // Unavailable or corrupt storage: behave as if no draft was ever saved.
    return {};
  }
}

function writeStore(store: DraftStore): void {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage off: this session only */ }
}

/** The draft left in `chatId` last time it was open, or '' if there isn't one. */
export function readDraft(chatId: string): string {
  if (!chatId) return '';
  return readStore()[chatId]?.text ?? '';
}

/** Save the draft for `chatId`. An empty string clears it (same as `clearDraft`)
 *  rather than storing an empty entry, so an untouched or just-sent chat never
 *  counts against the retention cap. Evicts the least-recently-touched other
 *  chat first once more than `MAX_CHATS` drafts are held. */
export function writeDraft(chatId: string, text: string): void {
  if (!chatId) return;
  if (!text) { clearDraft(chatId); return; }
  const store = readStore();
  store[chatId] = { text: text.slice(0, MAX_DRAFT_CHARS), updatedAt: Date.now() };
  const ids = Object.keys(store);
  if (ids.length > MAX_CHATS) {
    ids.sort((a, b) => store[a].updatedAt - store[b].updatedAt);
    for (const id of ids.slice(0, ids.length - MAX_CHATS)) delete store[id];
  }
  writeStore(store);
}

/** Sent, or explicitly discarded: nothing left to restore for this chat. */
export function clearDraft(chatId: string): void {
  if (!chatId) return;
  const store = readStore();
  if (!(chatId in store)) return;
  delete store[chatId];
  writeStore(store);
}

/** Sign-out (#791): no unsent text from this account stays on the device. */
export function clearAllDrafts(): void {
  try { localStorage.removeItem(KEY); localStorage.removeItem(OWNER_KEY); } catch { /* storage off: nothing kept */ }
}

/** Called once the signed-in account is known and before any chat renders (#791). Drafts held for
 *  another account are dropped; drafts saved before owners were recorded are kept only when the
 *  device's last place (`legacyOwner`, from last-view.ts) says they were this account's. */
export function claimDrafts(userId: string, legacyOwner: string | null): void {
  if (!userId) return;
  try {
    const owner = localStorage.getItem(OWNER_KEY);
    if (owner === userId) return;
    if (owner !== null || legacyOwner !== userId) localStorage.removeItem(KEY);
    localStorage.setItem(OWNER_KEY, userId);
  } catch { /* storage off: there are no stored drafts to protect */ }
}
