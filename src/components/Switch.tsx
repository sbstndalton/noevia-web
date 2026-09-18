import type { JSX } from 'react';

/** An on/off switch with a glass knob (materials.css .glass-switch). Name it with `label`. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }): JSX.Element {
  return <button type="button" role="switch" className="glass-switch" aria-checked={checked} aria-label={label} disabled={disabled}
    onClick={() => onChange(!checked)}><span className="knob glass glass-lens"/></button>;
}
