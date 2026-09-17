import type { JSX, ReactNode } from 'react';
import { ShellIcon } from './ShellIcon';

/** What is missing, why it matters, and what to do next — one calm symbol, one line, at most one action. */
export function EmptyState({ icon, title, children, action, compact = false }: { icon: string; title: string; children?: ReactNode; action?: ReactNode; compact?: boolean }): JSX.Element {
  return (
    <div className={`empty-state-card${compact ? ' is-compact' : ''}`} role="status">
      <span className="empty-state-icon" aria-hidden="true"><ShellIcon name={icon} size={compact ? 18 : 22} /></span>
      <p className="empty-state-title">{title}</p>
      {children && <p className="empty-state-text">{children}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
