// The address bar (#359). Every place the app can show has one canonical path, so Back/Forward
// step through what you actually looked at, a reload lands on the same place, and a chat or
// project can be linked. This module is the whole path <-> place mapping and nothing else: pure
// functions, no React, no browser globals, so it is unit-tested directly (tests/routes.test.cjs).
// server/spa-routes.cjs is the server's half — which paths get index.html — and a test keeps the
// two in step.
//
//   /                              a new, unsent chat
//   /c/<chatId>                    a chat (free or in a project; the chat list knows which)
//   /p/<projectId>                 a project, on its Chats tab
//   /p/<projectId>/<tab>           a project on another tab (sources, research, code, browser)
//   /p/<projectId>/new             a new, unsent chat in that project
//   /projects                      the projects library
//   /settings/<section>            Settings, open on a section (an overlay: see App.tsx)
//   /customise/<tab>               Customise (skills, connectors, plugins)
//   /models  /models/<model>       Models & routing, optionally one model's page
//   /diary  /archived  /code       the Diary, Archived chats, the Code workspace
//
// Anything else — junk, a truncated link, a path from a future version — reads as a new chat;
// parsing never throws. Ids are only ever *names* here: whether a chat or project exists, and
// whose it is, is decided by the server's account-scoped reads, never by the URL.

export type ProjectTab = 'chats' | 'sources' | 'research' | 'code' | 'browser';
export type CustomiseTab = 'skills' | 'connectors' | 'plugins';

export type Route =
  | { kind: 'new'; projectId?: string | null }
  | { kind: 'chat'; chatId: string }
  | { kind: 'project'; id: string; tab?: ProjectTab }
  | { kind: 'projects' }
  | { kind: 'settings'; section: string }
  | { kind: 'customise'; tab: CustomiseTab }
  | { kind: 'models'; model?: string }
  | { kind: 'diary' }
  | { kind: 'archived' }
  | { kind: 'code' };

export const PROJECT_TABS: readonly ProjectTab[] = ['chats', 'sources', 'research', 'code', 'browser'];
export const CUSTOMISE_TABS: readonly CustomiseTab[] = ['skills', 'connectors', 'plugins'];

/** Old Settings section ids that moved: links and saved places resolve to the new home. Lives
 *  here (SettingsShell re-exports it) so a URL is canonical before the Settings chunk loads. */
export const SETTINGS_SECTION_ALIASES: Record<string, string> = { general: 'appearance', archived: 'data', language: 'appearance', shortcuts: 'keyboard', instructions: 'personalization', account: 'profile' };

// Chat and project ids are stored sanitised to this alphabet (server/chat-lists.cjs safeChatId,
// projects.cjs `proj-…`), so anything else cannot name one and is not worth a round trip.
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const SECTION = /^[a-z][a-z0-9-]{0,39}$/;
const MODEL_MAX = 200;

/** Customise's tab from a path segment; the ids it used to have still land on the right tab. */
export function customiseTabFrom(value: string | null | undefined): CustomiseTab {
  if (value === 'skills') return 'skills';
  if (value === 'plugins' || value === 'mcp') return 'plugins';
  return 'connectors';
}

export function canonicalSection(section: string): string {
  return SETTINGS_SECTION_ALIASES[section] ?? section;
}

function segments(pathname: string): string[] | null {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) return null;
  if (pathname.length > 512 || pathname.includes('\\')) return null;
  const raw = pathname.slice(1).replace(/\/+$/, '');
  if (!raw) return [];
  const parts = raw.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part) return null; // "a//b": never produced by toPath
    try { out.push(decodeURIComponent(part)); } catch { return null; }
  }
  return out;
}

/** The place a path names, or null when it names none (the caller decides the fallback). */
export function matchPath(pathname: string): Route | null {
  const s = segments(pathname);
  if (!s) return null;
  const [head, a, b, ...rest] = s;
  if (rest.length) return null;
  if (s.length === 0) return { kind: 'new' };
  switch (head) {
    case 'chat': return s.length === 1 ? { kind: 'new' } : null; // the old SPA path
    case 'c': return s.length === 2 && ID.test(a) ? { kind: 'chat', chatId: a } : null;
    case 'p': {
      if (!a || !ID.test(a)) return null;
      if (s.length === 2) return { kind: 'project', id: a };
      if (b === 'new') return { kind: 'new', projectId: a };
      const tab = PROJECT_TABS.find((t) => t === b);
      return tab ? (tab === 'chats' ? { kind: 'project', id: a } : { kind: 'project', id: a, tab }) : null;
    }
    case 'projects': return s.length === 1 ? { kind: 'projects' } : null;
    case 'diary': return s.length === 1 ? { kind: 'diary' } : null;
    case 'archived': return s.length === 1 ? { kind: 'archived' } : null;
    case 'code': return s.length === 1 ? { kind: 'code' } : null;
    case 'settings':
      if (s.length === 1) return { kind: 'settings', section: 'appearance' };
      return s.length === 2 && SECTION.test(a) ? { kind: 'settings', section: canonicalSection(a) } : null;
    case 'customise': case 'customize': case 'plugins':
      if (s.length === 1) return { kind: 'customise', tab: 'connectors' };
      return s.length === 2 && ['skills', 'connectors', 'plugins', 'mcp', 'connected'].includes(a) ? { kind: 'customise', tab: customiseTabFrom(a) } : null;
    case 'models':
      if (s.length === 1) return { kind: 'models' };
      // A model name is free text (a file or preset name); it only has to be printable and short.
      return s.length === 2 && a.length <= MODEL_MAX && !/[\u0000-\u001f\u007f]/.test(a) ? { kind: 'models', model: a } : null;
    default: return null;
  }
}

/** The place a path names; anything unrecognised is a new chat. Never throws. */
export function parsePath(pathname: string): Route {
  return matchPath(pathname) ?? { kind: 'new' };
}

/** The canonical path for a place. Round-trips: parsePath(toPath(r)) describes the same place. */
export function toPath(route: Route): string {
  const seg = encodeURIComponent;
  switch (route.kind) {
    case 'new': return route.projectId && ID.test(route.projectId) ? `/p/${seg(route.projectId)}/new` : '/';
    case 'chat': return ID.test(route.chatId) ? `/c/${seg(route.chatId)}` : '/';
    case 'project':
      if (!ID.test(route.id)) return '/';
      return route.tab && route.tab !== 'chats' && PROJECT_TABS.includes(route.tab) ? `/p/${seg(route.id)}/${route.tab}` : `/p/${seg(route.id)}`;
    case 'projects': return '/projects';
    case 'settings': {
      const section = canonicalSection(route.section);
      return SECTION.test(section) ? `/settings/${section}` : '/settings/appearance';
    }
    case 'customise': return `/customise/${customiseTabFrom(route.tab)}`;
    case 'models': return route.model && route.model.length <= MODEL_MAX ? `/models/${seg(route.model)}` : '/models';
    case 'diary': return '/diary';
    case 'archived': return '/archived';
    case 'code': return '/code';
  }
}

/** Where to go after signing in, given the address the sign-in screen was shown at. Only ever a
 *  same-origin relative path this app itself produces: the input is parsed as a place and
 *  re-serialised, so a scheme, a `//host`, a backslash trick or any unknown path collapses to `/`.
 *  Query strings (an invite or recovery token) and fragments are dropped. */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  let pathname: string;
  try {
    const base = 'http://noevia.invalid';
    const url = new URL(raw, base);
    if (url.origin !== base) return '/';
    pathname = url.pathname;
  } catch { return '/'; }
  const route = matchPath(pathname);
  return route ? toPath(route) : '/';
}

// ── App state -> place ────────────────────────────────────────────────────────────────────

/** What App.tsx knows about the screen, reduced to what decides the path. */
export interface NavSnapshot {
  view: { kind: string; chatId?: string; projectId?: string | null; id?: string; model?: string };
  settingsOpen: boolean;
  settingsSection: string;
  /** The Code workspace is on screen (it replaces the chat views without changing `view`). */
  codeMode: boolean;
  projectTab?: ProjectTab;
  customiseTab?: CustomiseTab;
  /** The open chat is a new one nobody has written in yet: it has no address of its own. */
  freshChat?: boolean;
}

/** The place on screen, or null for a view that is never somewhere to link to (an unbuilt
 *  preview) — the address bar is then left as it was. Settings is an overlay and wins; Code
 *  replaces the chat views without touching them, so it wins over the view underneath. */
export function routeForState(s: NavSnapshot): Route | null {
  if (s.settingsOpen) return { kind: 'settings', section: s.settingsSection || 'appearance' };
  if (s.codeMode) return { kind: 'code' };
  const v = s.view;
  switch (v.kind) {
    case 'chat':
      if (!v.chatId) return null;
      return s.freshChat ? { kind: 'new', projectId: v.projectId ?? null } : { kind: 'chat', chatId: v.chatId };
    case 'project': return v.id ? (s.projectTab && s.projectTab !== 'chats' ? { kind: 'project', id: v.id, tab: s.projectTab } : { kind: 'project', id: v.id }) : null;
    case 'projects': return { kind: 'projects' };
    case 'plugins': return { kind: 'customise', tab: s.customiseTab ?? 'connectors' };
    case 'models': return v.model ? { kind: 'models', model: v.model } : { kind: 'models' };
    case 'diary': return { kind: 'diary' };
    case 'archived': return { kind: 'archived' };
    default: return null;
  }
}

/** One history write: what the address bar last showed, and which chat it belonged to. */
export interface SyncedPlace { path: string; kind: Route['kind']; chatId?: string | null }

/** How the address bar should follow a change of place.
 *  - `none`: it already shows it.
 *  - `replace`: the first sync after load (normalising whatever was typed), a redirect the app
 *    made on its own (a missing project, a deleted chat, a section this account cannot see), or
 *    a new chat getting its address once its first message is sent — none of those are a place
 *    the person chose, so Back must not stop on them.
 *  - `push`: everything the person navigated to. */
export function historyMode(prev: SyncedPlace | null, next: SyncedPlace, opts: { current: string; forceReplace?: boolean }): 'none' | 'push' | 'replace' {
  if (opts.current === next.path) return 'none';
  if (!prev || opts.forceReplace) return 'replace';
  if (prev.kind === 'new' && next.kind === 'chat' && !!prev.chatId && prev.chatId === next.chatId) return 'replace';
  return 'push';
}
