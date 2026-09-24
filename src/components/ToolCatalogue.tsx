import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { fetchPermittedTools } from '../api';
import { filterCatalogue, type CatalogueEntry, type PermittedBox } from '../tool-catalogue';
import type { ChatMode } from '../chat-mode';
import { ShellIcon } from './ShellIcon';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

const PERMISSION_LABEL: Record<CatalogueEntry['permission'], MessageKey> = {
  allowed: 'tools.allowed', 'needs-approval': 'tools.asksFirst', unavailable: 'capabilities.unavailable',
};

/**
 * The searchable composer catalogue (#237): the tools this account may use this turn, from
 * /api/toolboxes/permitted. Choosing a tool inserts an @mention; choosing a box adds it for the
 * next message only. Unavailable entries stay listed with their reason and cannot be chosen.
 * Keyboard: type to filter, arrows/Home/End to move, Enter to choose, Escape to close.
 */
export function ToolCatalogue({ open, onOpenChange, projectId, mode, toggled, onToggle, onMention, onBoxes, disabled }: {
  open: boolean; onOpenChange: (open: boolean) => void; projectId: string | null; mode: ChatMode;
  toggled: string[]; onToggle: (boxId: string) => void; onMention: (name: string) => void;
  onBoxes: (boxes: PermittedBox[]) => void; disabled: boolean;
}): JSX.Element {
  const id = useId();
  const t = useT();
  const [boxes, setBoxes] = useState<PermittedBox[] | null>(null);
  // A server message is shown as sent; our own failure is a code, translated at render.
  const [error, setError] = useState<{ kind: 'load' } | { kind: 'server'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Refreshed on project or mode change (the server caches per account for a short TTL).
  useEffect(() => { setBoxes(null); }, [projectId, mode]);
  useEffect(() => {
    if (!open || boxes) return;
    let live = true;
    setError(null);
    fetchPermittedTools(projectId, mode)
      .then(v => { if (live) { setBoxes(v.boxes); onBoxes(v.boxes); } })
      .catch(err => { if (live) setError(err instanceof Error && err.message ? { kind: 'server', text: err.message } : { kind: 'load' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, boxes, projectId, mode]);
  useEffect(() => {
    if (!open) return;
    setQuery(''); setActive(0);
    requestAnimationFrame(() => input.current?.focus());
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onOpenChange(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, onOpenChange]);
  const rows = useMemo(() => filterCatalogue(boxes ?? [], query), [boxes, query]);
  useEffect(() => { setActive(0); }, [query]);
  const choose = (row: CatalogueEntry | undefined) => {
    if (!row || row.permission === 'unavailable') return;
    if (row.kind === 'tool') { onMention(row.name); close(); }
    else if (!row.active) onToggle(row.boxId);
  };
  const close = () => { onOpenChange(false); requestAnimationFrame(() => trigger.current?.focus()); };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = rows.length - 1;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(a => Math.min(last, a + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(Math.max(0, last)); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(rows[active]); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  };
  useEffect(() => { document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, id]);
  const turnCount = toggled.length;
  return <div className="tool-catalogue" ref={root}>
    <button ref={trigger} type="button" className="tool-catalogue-trigger btn btn-ghost" aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? `${id}-list` : undefined} disabled={disabled} onClick={() => onOpenChange(!open)} title={t('tools.browse')}>
      <ShellIcon name="tools" size={16}/><span>{t('tools.trigger')}{turnCount ? ` · ${t('tools.forMessage', { count: turnCount })}` : ''}</span>
    </button>
    {open && <div className="tool-catalogue-panel overlay" role="dialog" aria-label={t('tools.catalogue')}>
      <input ref={input} className="tool-catalogue-search" type="search" role="combobox" aria-expanded="true" aria-autocomplete="list"
        aria-controls={`${id}-list`} aria-activedescendant={rows.length ? `${id}-opt-${active}` : undefined}
        placeholder={t('tools.search')} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} />
      <p className="tool-catalogue-boundary">{t(projectId ? 'tools.boundaryProject' : 'tools.boundaryAccount')}</p>
      {!boxes && !error && <p className="tool-catalogue-note" role="status">{t('composer.loadingTools')}</p>}
      {error && <p className="tool-catalogue-note" role="alert">{error.kind === 'server' ? error.text : t('tools.loadError')}</p>}
      {boxes && <ul id={`${id}-list`} className="tool-catalogue-list" role="listbox" aria-label={t('tools.trigger')}>
        {rows.map((row, i) => {
          const on = row.kind === 'box' && (row.active || toggled.includes(row.boxId));
          return <li key={row.key} id={`${id}-opt-${i}`} role="option" aria-selected={i === active}
            aria-disabled={row.permission === 'unavailable' || (row.kind === 'box' && row.active)} data-kind={row.kind} data-permission={row.permission}
            className={i === active ? 'is-active' : undefined} onPointerMove={() => setActive(i)} onClick={() => choose(row)}>
            <span className="tool-catalogue-main">
              <span className="tool-catalogue-label">{row.kind === 'tool' ? `@${row.name}` : row.label}</span>
              <small>{row.reason || row.description}</small>
            </span>
            <span className="tool-catalogue-state">{row.kind === 'box' && row.active ? t('tools.onForChat') : on ? t('tools.thisMessage') : t(PERMISSION_LABEL[row.permission])}</span>
          </li>;
        })}
        {!rows.length && <li className="tool-catalogue-note" role="option" aria-disabled="true" aria-selected="false">{t('tools.noMatch', { query })}</li>}
      </ul>}
    </div>}
  </div>;
}
