import type { JSX, ReactNode } from 'react';
import { ShellIcon } from './ShellIcon';

/** An empty state's symbol is decorative and two-tone (#1623): its inner part is in the theme accent.
 *  The plain chat, code and search glyphs have no inner part, so an empty state draws a variant of
 *  the same symbol that has one (text lines in the bubble, brackets in a frame, a cross in the lens).
 *  Every other name passes through; tests/client/icon-tones.test.cjs holds that every symbol an
 *  EmptyState is given ends up with an accent part. */
export const EMPTY_STATE_GLYPHS: Readonly<Record<string, string>> = {
  chat: 'message-square-text',
  code: 'square-code',
  search: 'search-x',
};

/** What is missing, why it matters, and what to do next — one calm symbol, one line, at most one action. */
export function EmptyState({ icon, title, children, action, compact = false, role = 'status' }: { icon: string; title: string; children?: ReactNode; action?: ReactNode; compact?: boolean; role?: 'status' | 'alert' }): JSX.Element {
  const glyph = EMPTY_STATE_GLYPHS[icon] ?? icon;
  return (
    <div className={`empty-state-card${compact ? ' is-compact' : ''}`} role={role}>
      <span className="empty-state-icon" aria-hidden="true"><ShellIcon name={glyph} size={compact ? 18 : 22} tone="decorative"/></span>
      <p className="empty-state-title">{title}</p>
      {children && <p className="empty-state-text">{children}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
