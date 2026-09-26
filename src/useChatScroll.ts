import { useLayoutEffect, useRef, useState } from 'react';

/** How close to the bottom (in px) still counts as "at the bottom" for follow purposes — a
 *  reader who has scrolled up even slightly is deliberately reading something else. */
export const FOLLOW_THRESHOLD_PX = 48;

/** Pure: is this scroll position within the follow threshold of the bottom? Exported so the
 *  threshold itself has a test independent of any DOM or React wiring. */
export function isAtBottom(scrollHeight: number, clientHeight: number, scrollTop: number, threshold = FOLLOW_THRESHOLD_PX): boolean {
  return scrollHeight - clientHeight - scrollTop < threshold;
}

/** Pure follow-state transition (#387). A scroll position change caused by the reader decides
 *  the next state outright — away from the bottom turns follow off, back at the bottom turns it
 *  on. A change caused by the app's own "scroll to newest" write must never feed back into this
 *  decision, or the effect's own write would re-arm itself every time and the reader's scroll-up
 *  could never stick (which is exactly what the effect did before this fix, since writing
 *  `scrollTop` fires a native `scroll` event like any other). */
export function nextFollowState(current: boolean, atBottom: boolean, causedByUser: boolean): boolean {
  return causedByUser ? atBottom : current;
}

/** Follow new output only while the reader is at the bottom (#387: a scroll-up must stick until
 *  the reader returns to the bottom themselves, or calls `follow()` — sending a message already
 *  does). `atBottom` drives a "jump to latest" control in the caller; it always mirrors
 *  `following`, since the only way to be actively not-following is to not be at the bottom. */
export function useChatScroll(scope: string, update: unknown, active = true, layout?: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  // Set right before this hook's own writes to `scrollTop`, so the `scroll` event they fire is
  // not mistaken for reader input by `onScroll` (see `nextFollowState` above). Cleared by
  // whichever fires first: that `scroll` event, or the animation-frame fallback below, so a
  // write that (rarely) does not change `scrollTop` — nothing to scroll — can never leave this
  // stuck and swallow a real scroll-up.
  const programmatic = useRef(false);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = (el: HTMLDivElement) => {
    if (el.scrollTop === el.scrollHeight) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => { programmatic.current = false; });
  };

  useLayoutEffect(() => { following.current = true; setAtBottom(true); }, [scope]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (active && el && following.current) scrollToBottom(el);
  }, [scope, update, active, layout]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const causedByUser = !programmatic.current;
    programmatic.current = false;
    const atBottomNow = isAtBottom(el.scrollHeight, el.clientHeight, el.scrollTop);
    following.current = nextFollowState(following.current, atBottomNow, causedByUser);
    if (causedByUser) setAtBottom(following.current);
  };

  /** Re-enable follow and jump to the newest message: called on submit, and by a "jump to
   *  latest" control the caller renders while `atBottom` is false. */
  const follow = () => {
    following.current = true;
    setAtBottom(true);
    const el = scrollRef.current;
    if (el) scrollToBottom(el);
  };

  return { scrollRef, onScroll, follow, atBottom };
}
