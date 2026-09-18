import { useLayoutEffect, useRef } from 'react';
import type { JSX } from 'react';
import { ShellIcon } from './ShellIcon';

type Mode = 'chat' | 'code';

// The mode the switch last showed. Choosing the other mode replaces the whole sidebar, so the
// new switch would appear already settled; starting its thumb here lets it slide across.
let lastMode: Mode | null = null;

/** Chat ⇄ Code, with the liquid-glass thumb the other segmented controls use: it slides to
 *  the chosen mode and refracts while it travels (user review, 2026-09-18). */
export function ModeSwitch({ mode, onChat, onCode, compact = false }: { mode: Mode; onChat?: () => void; onCode?: () => void; compact?: boolean }): JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    const place = (target: Mode) => {
      const button = node.querySelector<HTMLElement>(`[data-mode="${target}"]`);
      if (!button) return;
      node.style.setProperty('--thumb-x', `${button.offsetLeft}px`);
      node.style.setProperty('--thumb-y', `${button.offsetTop}px`);
      node.style.setProperty('--thumb-w', `${button.offsetWidth}px`);
      node.style.setProperty('--thumb-h', `${button.offsetHeight}px`);
    };
    let timer = 0, frame = 0;
    const slide = (from: Mode) => {
      node.classList.add('is-settling');
      place(from);
      void node.offsetWidth; // commit the starting position before transitions come back
      node.classList.remove('is-settling');
      lastMode = mode;
      if (from === mode) return;
      node.classList.add('is-moving');
      cancelAnimationFrame(frame); window.clearTimeout(timer);
      frame = requestAnimationFrame(() => place(mode));
      timer = window.setTimeout(() => node.classList.remove('is-moving'), 420);
    };
    slide(lastMode ?? mode);
    // The chat sidebar is only hidden while Code is open, not replaced; when it is shown again
    // (its size goes from nothing to something) it slides across from the mode just left.
    let shown = node.offsetWidth > 0;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const now = node.offsetWidth > 0;
      if (now && !shown && lastMode && lastMode !== mode) slide(lastMode);
      else if (now && !node.classList.contains('is-moving')) place(mode);
      shown = now;
    });
    observer?.observe(node);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); observer?.disconnect(); };
  }, [mode]);
  return (
    <div ref={track} className={`app-mode-switch has-thumb${compact ? ' is-compact' : ''}`} role="group" aria-label="Workspace mode">
      <span className="glass-thumb glass glass-lens" aria-hidden="true" />
      <button type="button" data-mode="chat" className={mode === 'chat' ? 'is-selected' : ''} aria-pressed={mode === 'chat'} aria-label="Chat" title="Chat" onClick={mode === 'chat' ? undefined : onChat}><ShellIcon name="chat" size={compact ? 16 : 18}/>{!compact && 'Chat'}</button>
      <button type="button" data-mode="code" className={mode === 'code' ? 'is-selected' : ''} aria-pressed={mode === 'code'} aria-label="Code" title="Code" onClick={mode === 'code' ? undefined : onCode}><ShellIcon name="code" size={compact ? 16 : 18}/>{!compact && 'Code'}</button>
    </div>
  );
}
