// Where the Diary panel is in the page (#1635). The Diary is the owner's private journal, so its panel
// is in the document only while it is the view on screen:
//   - `absent`   never opened in this tab: nothing is mounted, nothing is fetched;
//   - `shown`    the Diary is the view (opened by a click, a /diary address or Back/Forward) and the
//                chat views are not covered by the Code workspace;
//   - `detached` opened earlier and then left: kept alive (an unsent draft, an open editor, an
//                in-flight save survive the round trip) but out of the document.
// It used to stay mounted behind every view with display:none. A display:none element's innerText is
// its whole textContent, so a page-text reader that takes the longest <main> (browser assistants,
// reader modes, translation extensions) read the hidden Diary instead of a short chat. Pure functions,
// no React, unit-tested in tests/client/diary-presence-1635.test.cjs.

export type DiaryPresence = 'absent' | 'detached' | 'shown';

/** Whether the Diary has been opened in this tab. Only the Diary being the view sets it; turning the
 *  Diary off clears it, so its kept state goes with it. Nothing else (a reply finishing, a chat-list
 *  refresh, a storage status change) can set it. */
export function diaryOpened(prev: boolean, s: { enabled: boolean; viewKind: string }): boolean {
  if (!s.enabled) return false;
  return prev || s.viewKind === 'diary';
}

/** `covered`: the Code workspace replaces the chat views (they are display:none underneath it), so a
 *  Diary that is still the chat-side view is kept out of the document like any other left Diary. */
export function diaryPresence(s: { enabled: boolean; viewKind: string; opened: boolean; covered?: boolean }): DiaryPresence {
  if (!s.enabled) return 'absent';
  if (s.viewKind === 'diary' && !s.covered) return 'shown';
  return s.opened || s.viewKind === 'diary' ? 'detached' : 'absent';
}
