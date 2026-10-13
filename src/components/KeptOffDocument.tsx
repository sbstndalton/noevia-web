// Keeps a subtree alive (React state, in-flight work) while taking its DOM out of the document when
// it is not shown (#1635). `display:none` is not enough for private content: the hidden text is
// still in the page, and an element's innerText returns all of it while the element is not rendered.
//
// The children render through a portal into one host element that lives as long as this component.
// While `shown`, the host sits in a `display: contents` slot at this point of the tree; otherwise it
// is detached. The slot's ref callback moves the host: React runs it in the layout phase, after the
// DOM updates and before the children's own layout effects, so a newly shown subtree is already in
// the document when its effects run. Scroll offsets are lost when a node leaves the document, so
// they are recorded on the way out and put back on the way in.
import { useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Offset = [Element, number, number];

export function KeptOffDocument({ shown, className, children }: { shown: boolean; className?: string; children: ReactNode }) {
  const [host] = useState(() => {
    const el = document.createElement('div');
    if (className) el.className = className;
    el.style.display = 'contents';
    return el;
  });
  const [saved] = useState<{ offsets: Offset[] }>(() => ({ offsets: [] }));
  const slot = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    if (shown) {
      if (host.parentNode !== el) el.appendChild(host);
      for (const [node, top, left] of saved.offsets) if (host.contains(node)) { node.scrollTop = top; node.scrollLeft = left; }
      saved.offsets = [];
    } else if (host.parentNode) {
      saved.offsets = [...host.querySelectorAll('*')].filter((n) => n.scrollTop || n.scrollLeft).map((n): Offset => [n, n.scrollTop, n.scrollLeft]);
      host.remove();
    }
    // A cleanup (React 19) instead of a call with null: the next callback decides where the host goes,
    // and on unmount the host leaves the document with the slot.
    return () => undefined;
  }, [shown, host, saved]);
  return <><div ref={slot} style={{ display: 'contents' }} />{createPortal(children, host)}</>;
}
