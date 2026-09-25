// Return-target bookkeeping for the Settings shell (#304, #305).
//
// The app renders a handful of views (Models & routing, Customise/plugins, Archived chats,
// Diary) that Settings can launch as a detour from wherever the user actually was. If those
// detours were allowed to become "the place Settings returns you to", closing Settings from
// one of them just re-shows the same detour — the back/close loop reported in #304. Keeping
// this bookkeeping in a small pure module makes it unit-testable without mounting React.

export interface NavState<V> {
  /** The last view that was NOT a Settings-launched detour: where Settings' close/back lands. */
  returnView: V;
  /** The Settings section the current view was launched from, if any (null once you are back
   *  on a normal view). Used to re-open Settings at the right page rather than the last one. */
  cameFromSettings: string | null;
}

export function initialNavState<V>(view: V): NavState<V> {
  return { returnView: view, cameFromSettings: null };
}

/** Views Settings can launch as a detour: never a valid return target (see module doc). */
export const SETTINGS_LAUNCHABLE_KINDS: ReadonlySet<string> = new Set(['models', 'plugins', 'archived', 'diary']);

/** Bootstraps nav state for a *restored* view (a reload). Reloading is the same as calling
 *  initialNavState with whatever `readLastPlace()` returned — normally a real chat/project view,
 *  since #304's fix also stops a detour from ever being written as the last place. But data
 *  written before that fix (or any other stale/corrupted record) can still hand back a detour
 *  kind directly; treating that as the return target would resolve Settings' close right back
 *  into the same detour forever. `freshFallback` (a brand new chat) is used instead whenever the
 *  restored view is a detour. */
export function restoreNavState<V extends { kind: string }>(view: V, freshFallback: V): NavState<V> {
  return { returnView: SETTINGS_LAUNCHABLE_KINDS.has(view.kind) ? freshFallback : view, cameFromSettings: null };
}

/** What to persist as "last place" (#304 reload loop): a Settings-launched detour is never
 *  written as-is — the return target underneath it is, so a reload never restores mid-loop. A
 *  detour reached directly (not from Settings) is unaffected: `cameFromSettings` is only set for
 *  the former. */
export function persistedView<V>(state: NavState<V>, view: V): V {
  return state.cameFromSettings ? state.returnView : view;
}

type ChatLike = { kind: string; chatId?: string; projectId?: string | null };
type ProjectLike = { kind: string; id?: string; projectId?: string | null };

/** A deleted chat must never remain the return target (Settings' close would resolve back into
 *  it) even when it is not the view currently on screen — e.g. it was open, Models & routing was
 *  opened from there, and the chat was then deleted from Archived chats elsewhere. */
export function withoutChat<V extends ChatLike>(state: NavState<V>, chatId: string, fallback: V): NavState<V> {
  return state.returnView.kind === 'chat' && state.returnView.chatId === chatId
    ? { ...state, returnView: fallback }
    : state;
}

/** As withoutChat, for a deleted project — and any chat inside it, whose project no longer
 *  exists either. */
export function withoutProject<V extends ProjectLike>(state: NavState<V>, projectId: string, fallback: V): NavState<V> {
  const target = state.returnView;
  const stale = (target.kind === 'project' && target.id === projectId) || (target.kind === 'chat' && target.projectId === projectId);
  return stale ? { ...state, returnView: fallback } : state;
}

/** Call this whenever the app's main view changes. `fromSettingsSection`, when set, means the
 *  new view is a Settings-launched detour (e.g. Models & routing) — the return target is left
 *  untouched so it keeps pointing at the real chat/project view underneath. Any other view
 *  (including a Settings-launched detour reached from elsewhere) becomes the new return target. */
export function nextNavState<V>(
  state: NavState<V>,
  nextView: V,
  opts: { fromSettingsSection?: string | null } = {},
): NavState<V> {
  const fromSettings = opts.fromSettingsSection ?? null;
  if (fromSettings) return { returnView: state.returnView, cameFromSettings: fromSettings };
  return { returnView: nextView, cameFromSettings: null };
}

/** What Settings' X / Escape / top-level back should hand the app back to, and the nav state to
 *  carry forward afterward (the detour is forgotten, so a second close never re-opens it). */
export function resolveSettingsClose<V>(state: NavState<V>): { view: V; next: NavState<V> } {
  return { view: state.returnView, next: { returnView: state.returnView, cameFromSettings: null } };
}
