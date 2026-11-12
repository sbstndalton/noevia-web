import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useT } from '../../i18n';
import '../../i18n/coworkers';
import type { Space } from '../../spaces-api';
import type { Specialist } from '../../specialists-api';
import { ShellIcon } from '../ShellIcon';
import { CoworkerGlyph } from './Glyph';
import { CoworkerSettings } from './CoworkerSettings';
import './coworkers.css';

/** What a coworker may do, in one line: the Spaces it can write to and the default one. */
export function statusLine(t: ReturnType<typeof useT>, c: Pick<Specialist, 'spaces' | 'defaultSpace'>, spaces: Space[] | null): string {
  if (c.spaces.length === 0) return t('coworkers.statusNoSpaces');
  const base = t.plural('coworkers.statusSpaces', c.spaces.length);
  const name = c.defaultSpace ? spaces?.find((s) => s.id === c.defaultSpace)?.name : undefined;
  return name ? `${base} · ${t('coworkers.statusDefault', { name })}` : base;
}

/** The strip above a coworker's conversation: glyph, name, a status line and the settings button. */
export function CoworkerHeader({ record, spaces, onSaved, onDeleted, focusOnMount = false }: {
  record: { revision: number; specialist: Specialist }; spaces: Space[] | null;
  onSaved: (record: { revision: number; specialist: Specialist }) => void; onDeleted: () => void;
  /** The page was just opened (from the list or a new coworker): focus lands on the name. */
  focusOnMount?: boolean;
}): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const c = record.specialist;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusOnMount) heading.current?.focus(); }, [focusOnMount]);
  return (
    <header className="cw-header">
      <CoworkerGlyph coworker={c} size="lg" />
      <div className="cw-header-text">
        <h1 ref={heading} tabIndex={-1}>{c.name}</h1>
        <p className="cw-status">{statusLine(t, c, spaces)}</p>
      </div>
      <button type="button" className="btn btn-secondary cw-settings-btn" aria-label={t('coworkers.settingsFor', { name: c.name })} onClick={() => setOpen(true)}>
        <ShellIcon name="settings" size={16} /><span>{t('coworkers.settings')}</span>
      </button>
      {open && <CoworkerSettings mode={{ kind: 'edit', record }} onSaved={onSaved} onDeleted={onDeleted} onClose={() => setOpen(false)} />}
    </header>
  );
}
