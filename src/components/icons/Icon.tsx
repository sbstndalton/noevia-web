import { createElement } from 'react';
import type { JSX } from 'react';
import { LUCIDE } from './lucide';

/** One outline icon from the vendored Lucide subset. Decorative by default (aria-hidden); give the
 *  surrounding control the accessible name. Unknown names fall back to a neutral circle. */
export function Icon({ name, size = 18, strokeWidth = 1.75, color = 'currentColor' }: { name: string; size?: number; strokeWidth?: number; color?: string }): JSX.Element {
  const nodes = LUCIDE[name] || LUCIDE.circle;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon={name}>
      {nodes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
