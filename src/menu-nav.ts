import { useEffect } from 'react';
import type { RefObject } from 'react';

/** The pointerdown/keydown logic of `useMenuNav`, pulled out as a plain function so it can be
 *  unit-tested (tests/menu-nav.test.cjs) against fake elements without a real DOM or React —
 *  `useMenuNav` itself is a thin `useEffect` wrapper that wires these to `document`. */
export function createMenuHandlers(
  menuRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): { onPointerDown: (e: PointerEvent) => void; onKeyDown: (e: KeyboardEvent) => void } {
  return {
    onPointerDown(e) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    },
    onKeyDown(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); triggerRef.current?.focus(); return; }
      const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
          : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
      if (e.key === 'Tab') onClose();
    },
  };
}

/** The open-menu keyboard/pointer contract `ContextMenu` already gets right (#345):
 *  a pointerdown outside the menu (and outside its trigger, so the same click that
 *  toggles it open does not also read as "outside") closes it; Escape closes it and
 *  returns focus to the trigger; ArrowUp/ArrowDown/Home/End rove focus between the
 *  menu's buttons; and Tab closes it rather than leaving it floating once focus moves
 *  on. `AccountMenu` reuses this instead of duplicating it. */
export function useMenuNav(
  open: boolean,
  menuRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const { onPointerDown, onKeyDown } = createMenuHandlers(menuRef, triggerRef, onClose);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, menuRef, triggerRef]);
}
