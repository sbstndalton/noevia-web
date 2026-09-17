import type { JSX } from 'react';
import { Icon } from './icons/Icon';

// Stable app-level names mapped to Lucide icons, so call sites keep their vocabulary and each
// concept has one familiar symbol everywhere (HIG: consistent, recognisable symbols).
export const SHELL_ICONS: Record<string, string> = {
  archive: 'archive', compose: 'square-pen', file: 'file-text', edit: 'pencil', book: 'book-open', pin: 'pin',
  chat: 'message-square', code: 'code', new: 'plus', search: 'search', clock: 'clock', plugins: 'puzzle',
  explore: 'compass', settings: 'settings', folder: 'folder', arrow: 'arrow-left', close: 'x', grid: 'layout-grid',
  git: 'git-branch', projects: 'library', panel: 'panel-left', user: 'user-round', down: 'chevron-down', sun: 'sun', moon: 'moon', more: 'ellipsis',
  // Settings sections: one distinct symbol each.
  profile: 'user-round', security: 'shield-check', appearance: 'palette', personalization: 'sliders-horizontal', capabilities: 'sparkles', diary: 'notebook-pen',
  providers: 'plug', usage: 'chart-column', data: 'database', planned: 'map', users: 'users', models: 'cpu', status: 'activity',
  features: 'toggle-right', backups: 'cloud-upload', research: 'telescope', trash: 'trash', check: 'check',
};

export function ShellIcon({ name, size = 18 }: { name: string; size?: number }): JSX.Element {
  return <Icon name={SHELL_ICONS[name] || name} size={size}/>;
}
