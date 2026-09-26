import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, JSX, KeyboardEvent } from 'react';
import { fetchPermittedTools } from '../api';
import { filterCatalogue, placeCatalogue, type CatalogueEntry, type PermittedBox } from '../tool-catalogue';
import type { ChatMode } from '../chat-mode';
import { ShellIcon } from './ShellIcon';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { keepFocusOnMouseDown, shouldClosePanelOnBlur } from '../tool-catalogue-focus';

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
  const [layout, setLayout] = useState<CSSProperties>({});
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Refreshed on project or mode change (the server caches per account for a short TTL).
  useEffect(() => { setBoxes(null); }, [projectId, mode]);
  // Flip below the trigger when there isn't enough room above; always clamp to what fits (#353).
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      setLayout(placeCatalogue(rect, window.innerHeight));
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
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
  // Only the search input is focusable inside the panel, so Tab always moves focus to
  // somewhere outside the root — closing here is how the panel stops floating once
  // keyboard focus leaves it, matching ContextMenu's "Tab closes" contract (#345).
  const onBlurRoot = (event: FocusEvent<HTMLDivElement>) => {
    if (!open) return;
    if (shouldClosePanelOnBlur(root.current, event.relatedTarget as Node | null)) onOpenChange(false);
  };
  const rows = useMemo(() => filterCatalogue(boxes ?? [], query), [boxes, query]);
  useEffect(() => { setActive(0); }, [query]);
  const choose = (row: CatalogueEntry | undefined) => {
    if (!row || row.permission === 'unavailable') return;
    if (row.kind === 'tool') { onMention(row.name); close(); }
    else if (!row.active) onToggle(row.boxId);
  };
  // #345 (reopened): closing used to call onOpenChange(false) first and defer the trigger's
  // .focus() to the next animation frame. onOpenChange(false) unmounts the search input — the
  // element that has focus at this point — synchronously, within the same event; the browser
  // resolves a focused element's removal by moving focus to <body> immediately, before that
  // deferred frame ever runs. The rAF's own .focus() call landed too late to matter live (it
  // raced the unmount and lost — reproduced consistently there even though this repo's own
  // synthetic tests, running lighter frames, didn't always lose the race). Fixed to match this
  // app's own working pattern for the same problem (ContextMenu.tsx, ComposerActions.tsx):
  // move focus to the trigger FIRST, synchronously, while the input this call is racing against
  // still holds it — an ordinary focus handoff with a real relatedTarget, not a fall-to-<body>
  // — and only then unmount the panel.
  const close = () => { trigger.current?.focus(); onOpenChange(false); };
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
  return <div className="tool-catalogue" ref={root} onBlur={onBlurRoot}>
    <button ref={trigger} type="button" className="tool-catalogue-trigger btn btn-ghost" aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? `${id}-list` : undefined} disabled={disabled} onClick={() => onOpenChange(!open)} title={t('tools.browse')}>
      <ShellIcon name="tools" size={16}/><span>{t('tools.trigger')}{turnCount ? ` · ${t('tools.forMessage', { count: turnCount })}` : ''}</span>
    </button>
    {/* No dialog role: this is a combobox (the search input) plus a listbox (below), not a
        modal — a dialog role here would contradict the trigger's aria-haspopup="listbox" (#345). */}
    {open && <div className="tool-catalogue-panel overlay" style={layout} aria-label={t('tools.catalogue')}>
      <input ref={input} className="tool-catalogue-search" type="search" role="combobox" aria-expanded="true" aria-autocomplete="list"
        aria-controls={`${id}-list`} aria-activedescendant={rows.length ? `${id}-opt-${active}` : undefined}
        placeholder={t('tools.search')} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} />
      <p className="tool-catalogue-boundary">{t(projectId ? 'tools.boundaryProject' : 'tools.boundaryAccount')}</p>
      {!boxes && !error && <p className="tool-catalogue-note" role="status">{t('composer.loadingTools')}</p>}
      {error && <p className="tool-catalogue-note" role="alert">{error.kind === 'server' ? error.text : t('tools.loadError')}</p>}
      {boxes && <ul id={`${id}-list`} className="tool-catalogue-list" role="listbox" aria-label={t('tools.trigger')}
        onMouseDown={keepFocusOnMouseDown}>
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
