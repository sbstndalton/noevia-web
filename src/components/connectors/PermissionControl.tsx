import type { JSX, KeyboardEvent } from 'react';
import { useSegmentThumb } from '../SegmentedControl';
import { ShellIcon } from '../ShellIcon';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';

export type ToolMode = 'allow' | 'ask' | 'block';

export const MODE_LABEL: Record<ToolMode, MessageKey> = { allow: 'connectors.mode.allow', ask: 'connectors.mode.ask', block: 'connectors.mode.block' };
const MODES: [ToolMode, string][] = [['allow', 'check'], ['ask', 'hand'], ['block', 'ban']];

/**
 * Allow / Ask / Block for one tool: three icon segments with the sliding glass thumb. A write
 * cannot be allowed (it always shows its arguments first), so that segment is disabled and says
 * why, rather than missing.
 */
export function PermissionControl({ tool, value, write, busy, onChange }: {
  tool: string; value: ToolMode; write: boolean; busy?: boolean; onChange: (mode: ToolMode) => void;
}): JSX.Element {
  const t = useT();
  const { track, moving } = useSegmentThumb([value]);
  const usable = MODES.filter(([m]) => !(write && m === 'allow')).map(([m]) => m);
  const choose = (next: ToolMode) => { if (next === value || busy || !usable.includes(next)) return; moving(); onChange(next); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = usable[(usable.indexOf(value) + step + usable.length) % usable.length];
    choose(next);
    requestAnimationFrame(() => track.current?.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus());
  };
  return <div ref={track} className="glass-seg permission-control" role="radiogroup" aria-label={t('connectors.permissionFor', { tool })} aria-busy={busy || undefined} onKeyDown={onKey}>
    {MODES.map(([mode, icon]) => {
      const locked = write && mode === 'allow';
      const label = locked ? t('connectors.mode.allowLocked') : t(MODE_LABEL[mode]);
      return <button key={mode} type="button" role="radio" data-mode={mode} className={mode} aria-checked={value === mode}
        aria-label={label} title={label} aria-disabled={locked || undefined} tabIndex={value === mode ? 0 : -1}
        onClick={() => choose(mode)}><ShellIcon name={icon} size={15}/></button>;
    })}
    <span className="glass-thumb glass" aria-hidden="true"/>
  </div>;
}
