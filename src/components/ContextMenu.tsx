import { useEffect, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Renders in --danger and sits below a separator. */
  danger?: boolean;
  icon?: ReactNode;
}

/** A menu anchored to a viewport point. Position is fixed because the sidebar
 *  lists are overflow-y:auto and would clip an absolutely-positioned dropdown.
 *  Opened from either a right-click or a hamburger button — both callers hand
 *  us a point, so there is one implementation rather than two. */
export function ContextMenu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number };
  items: MenuItem[];
  onClose: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);

  // Flip back inside the viewport rather than letting the menu run off the
  // edge — a right-click near the bottom right is the normal case, not an edge
  // case.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(at.x, window.innerWidth - r.width - 8),
      y: Math.min(at.y, window.innerHeight - r.height - 8),
    });
  }, [at.x, at.y]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
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

  return (
    <div className="ctx-menu" role="menu" ref={ref} style={{ top: pos.y, left: pos.x }}>
      {items.map((it, i) => (
        <button
          key={i}
          role="menuitem"
          className={`ctx-item${it.danger ? ' is-danger' : ''}`}
          onClick={() => { onClose(); it.onSelect(); }}
        >
          {it.label}
        </button>
      ))}
    </div>
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
      className="confirm-dialog"
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
