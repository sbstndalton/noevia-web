import { createElement } from 'react';
import type { JSX } from 'react';
import { LUCIDE } from './lucide';
import { ICON_ACCENTS } from './accents';

/** 'control': anything you can press (buttons, menu items, links, toggles); one neutral colour,
 *  and hover/focus/active states carry the emphasis. 'decorative': information only (status, a
 *  section or empty-state symbol, a type marker beside text); the same outline with one inner part
 *  in the theme accent (#1623). The default is 'control', so an icon is never two-tone by accident. */
export type IconTone = 'control' | 'decorative';

/** One outline icon from the vendored Lucide subset. Hidden from assistive tech (aria-hidden); give
 *  the surrounding control the accessible name. Unknown names fall back to a neutral circle.
 *  The accent part carries class "ic-a" (stroked) or "ic-af" (filled); system/components.css
 *  colours it with --icon-accent, which every theme family and palette derives from its accent. */
export function Icon({ name, size = 18, strokeWidth = 1.75, color = 'currentColor', tone = 'control' }: { name: string; size?: number; strokeWidth?: number; color?: string; tone?: IconTone }): JSX.Element {
  const nodes = LUCIDE[name] || LUCIDE.circle;
  const accent = tone === 'decorative' && LUCIDE[name] ? ICON_ACCENTS[name] : undefined;
  const strokeParts = new Set(accent?.stroke ?? []);
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon={name} data-tone={tone}>
      {accent?.fill?.map(([tag, attrs], i) => createElement(tag, { key: `f${i}`, ...attrs, className: 'ic-af', stroke: 'none' }))}
      {nodes.map(([tag, attrs], i) => createElement(tag, strokeParts.has(i) ? { key: i, ...attrs, className: 'ic-a' } : { key: i, ...attrs }))}
    </svg>
  );
}
