import { useLayoutEffect, useRef } from 'react';

/** Follow new output only while the reader is at the bottom. */
export function useChatScroll(scope: string, update: unknown, active = true, layout?: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => { following.current = true; }, [scope]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (active && el && following.current) el.scrollTop = el.scrollHeight;
  }, [scope, update, active, layout]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) following.current = el.scrollHeight - el.clientHeight - el.scrollTop < 48;
  };
  const follow = () => { following.current = true; };
  return { scrollRef, onScroll, follow };
}
