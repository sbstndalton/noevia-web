import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JSX, ReactNode } from 'react';
import { ShellIcon } from './ShellIcon';
import { shouldRefocusTrigger } from '../menu-focus';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Renders in --danger and sits below a separator. */
  danger?: boolean;
  separator?: boolean;
  icon?: ReactNode;
  /** A choice in a set of choices: rendered as a checked menu item, not as a label prefix. */
  selected?: boolean;
  /** A second, muted line under the label (Claude's model menu: name, then what it is for). */
  description?: string;
}

/** A menu anchored to a viewport point. Position is fixed because the sidebar
 *  lists are overflow-y:auto and would clip an absolutely-positioned dropdown,
 *  and it renders into <body>: the phone drawer's transform and backdrop-filter
 *  make it the containing block for fixed children, which offset and clipped it.
 *  Opened from either a right-click or a hamburger button — both callers hand
 *  us a point, so there is one implementation rather than two. */
export function ContextMenu({
  at,
  items,
  onClose,
  placement = 'below',
  label,
}: {
  at: { x: number; y: number };
  items: MenuItem[];
  onClose: () => void;
  /** 'above' opens upward from `at` (a composer control near the bottom of the screen). */
  placement?: 'below' | 'above';
  label?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const trigger = useRef(document.activeElement as HTMLElement | null);

  // Flip back inside the viewport rather than letting the menu run off the
  // edge — a right-click near the bottom right is the normal case, not an edge
  // case. Before paint, so the unclamped position never flashes.
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const viewport = window.visualViewport;
      const height = viewport && viewport.scale === 1 ? viewport.height : window.innerHeight;
      const y = placement === 'above' ? at.y - r.height - 6 : at.y;
      setPos({
        x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)),
        y: Math.max(8, Math.min(y, height - r.height - 8)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [at.x, at.y, placement]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); trigger.current?.focus(); }
      const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') || []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length-1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
      if (e.key === 'Tab') onClose();
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  return createPortal(
    <div className={`ctx-menu overlay${items.some((it) => it.description) ? ' has-descriptions' : ''}`} role="menu" aria-label={label} ref={ref} style={{ top: pos.y, left: pos.x, visibility: pos === at && placement === 'above' ? 'hidden' : undefined }}>
      {items.map((it, i) => (
        <button
          key={i}
          role={it.selected === undefined ? 'menuitem' : 'menuitemradio'}
          aria-checked={it.selected === undefined ? undefined : it.selected}
          className={`ctx-item${it.danger ? ' is-danger' : ''}${it.separator ? ' has-separator' : ''}`}
          onClick={() => {
            onClose();
            it.onSelect();
            // The Escape path (above) already refocuses the trigger; choosing an item
            // dropped that same courtesy, so a screen reader / keyboard user landed
            // nowhere afterward. Some actions (rename) open an input synchronously in
            // response to onSelect, and that input should keep focus rather than be
            // yanked back to the trigger.
            if (shouldRefocusTrigger(document.activeElement, document.body)) trigger.current?.focus();
          }}
        >
          {/* Every row keeps the symbol column, so labels line up whether or not this
              particular item has one. */}
          {it.description
            ? <><span className="ctx-item-text">{it.label}<small>{it.description}</small></span><span className="ctx-item-check" aria-hidden="true">{it.selected && <ShellIcon name="check"/>}</span></>
            : <>{it.icon ?? (it.selected ? <ShellIcon name="check"/> : <span className="ctx-item-gap" aria-hidden="true"/>)}<span>{it.label}</span></>}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** Blocking confirm for an action that destroys or hides something. Delete
 *  defaults to nothing and names what is being deleted, because "are you
 *  sure?" with no subject is how people delete the wrong thing. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    // Focus Cancel, not the destructive button: a stray Enter should not
    // confirm a delete.
    ref.current?.querySelector<HTMLButtonElement>('.confirm-cancel')?.focus();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);
  return (
    <dialog
      className="confirm-dialog aero dialog-sheet"
      ref={ref}
      aria-label={title}
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
    >
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="confirm-actions">
        <button className="btn btn-secondary confirm-cancel" onClick={onCancel}>Cancel</button>
        <button
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
