import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileSearchReport, FileSearchFilters } from '../../diary-file-search';
import { localGraph } from '../../diary-local-graph';
import { useT } from '../../i18n';

type Props = {
  path: string; text: string; root: string; busy: boolean;
  onSearch: (path: string, query: string, signal: AbortSignal, kind?: 'text'|'backlinks', filters?: FileSearchFilters) => Promise<FileSearchReport>;
  onOpen: (path: string) => void;
};

const R = 100; // drawing radius in viewBox units
const short = (text: string) => (text.length > 16 ? `${text.slice(0, 15)}…` : text);

/**
 * One hop around the open file. Links out come from the text on screen (so a link typed a moment
 * ago shows); links in come from the same bounded scan as "Find links to this file", run only
 * when the section is opened. Nothing is indexed or written.
 */
export function LocalGraph({ path, text, root, busy, onSearch, onOpen }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; backlinks: string[]; partial: boolean; error: string }>({ status: 'idle', backlinks: [], partial: false, error: '' });
  const abort = useRef<AbortController | null>(null);

  const [attempt, setAttempt] = useState(0);
  const search = useRef(onSearch); search.current = onSearch;
  useEffect(() => {
    setState({ status: 'idle', backlinks: [], partial: false, error: '' });
    if (!open || !path) return;
    const controller = new AbortController(); abort.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 15000);
    setState((s) => ({ ...s, status: 'loading' }));
    search.current('', path, controller.signal, 'backlinks')
      .then((report) => { if (!controller.signal.aborted) setState({ status: 'done', backlinks: report.results.map((r) => r.path), partial: report.partial, error: '' }); })
      .catch((e) => { if (abort.current === controller) setState({ status: 'error', backlinks: [], partial: false, error: controller.signal.aborted ? t('diary.graph.scanStopped') : e instanceof Error ? e.message : t('diary.graph.scanFailed') }); })
      .finally(() => window.clearTimeout(timer));
    return () => { window.clearTimeout(timer); abort.current = null; controller.abort(); };
  }, [open, path, attempt]);

  const graph = useMemo(() => localGraph({ path, text, root, backlinks: state.backlinks }), [path, text, root, state.backlinks]);
  // Past eight neighbours the names collide; the drawing becomes an overview and the list below
  // carries the names (hover and focus still show each one).
  const labelled = graph.nodes.length <= 9;
  const groups = (['both', 'out', 'in'] as const).map((relation) => ({ relation, nodes: graph.nodes.filter((n) => n.relation === relation) })).filter((g) => g.nodes.length);
  const counts = graph.nodes.reduce((c, n) => ({ ...c, [n.relation]: (c[n.relation] || 0) + 1 }), {} as Record<string, number>);
  const relationLabel = (relation: 'both'|'out'|'in') => relation === 'both' ? t('diary.graph.bothWays') : relation === 'out' ? t('diary.graph.linksOut') : t('diary.graph.linksIn');

  return (
    <details className="diary-local-graph" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{t('diary.graph.localGraph')}</summary>
      <p>{t('diary.graph.description')}</p>
      {state.status === 'loading' && <p role="status">{t('diary.graph.findingLinks')}</p>}
      {state.status === 'error' && <p role="alert">{state.error} <button type="button" className="popup-tab" onClick={() => setAttempt((n) => n + 1)}>{t('diary.graph.retry')}</button></p>}
      {open && (
        <figure className="diary-local-graph-figure">
          <svg viewBox={`${-R - 22} ${-R - 22} ${2 * R + 44} ${2 * R + 44}`} role="group" aria-label={t('diary.graph.ariaLabel', { name: graph.nodes[0].label })}>
            {graph.nodes.slice(1).map((n) => (
              <line key={`e-${n.id}`} x1={0} y1={0} x2={n.x * R} y2={n.y * R} className={`graph-edge graph-edge-${n.relation}`} />
            ))}
            {graph.nodes.map((n) => {
              const self = n.relation === 'self';
              const labelBelow = n.y >= -0.05;
              return (
                <g key={n.id} className={`graph-node graph-node-${n.relation}`} transform={`translate(${n.x * R} ${n.y * R})`}
                  role={self ? undefined : 'button'} tabIndex={self || busy ? undefined : 0}
                  aria-label={self ? undefined : t('diary.graph.openNode', { name: n.id, relation: n.relation === 'both' ? t('diary.graph.linksBothWays') : n.relation === 'out' ? t('diary.graph.linkedFromFile') : t('diary.graph.linksToFile') })}
                  onClick={self || busy ? undefined : () => onOpen(n.id)}
                  onKeyDown={self || busy ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(n.id); } }}>
                  <title>{n.id}</title>
                  <circle r={self ? 9 : 6} />
                  {/* The centre label sits on a chip: edges run under it in every direction. */}
                  {self && <rect className="graph-self-chip" x={-(short(n.label).length * 2.9 + 7)} y={12} width={short(n.label).length * 5.8 + 14} height={14} rx={7} />}
                  {(self || labelled) && <text y={self ? 22.5 : labelBelow ? 16 : -11} textAnchor="middle">{short(n.label)}</text>}
                </g>
              );
            })}
          </svg>
          <figcaption>
            <span className="graph-key graph-key-out">{t('diary.graph.linksOutCount', { count: (counts.out || 0) + (counts.both || 0) })}</span>
            <span className="graph-key graph-key-in">{t('diary.graph.linksInCount', { count: (counts.in || 0) + (counts.both || 0) })}</span>
            {graph.hidden > 0 && <span>{t('diary.graph.moreNotShown', { count: graph.hidden })}</span>}
            {state.partial && <span>{t('diary.graph.partialNote')}</span>}
          </figcaption>
          {groups.length > 0 && <div className="graph-list">
            {groups.map((g) => <section key={g.relation} aria-label={relationLabel(g.relation)}>
              <h3>{t('diary.graph.groupCount', { label: relationLabel(g.relation), count: g.nodes.length })}</h3>
              {g.nodes.map((n) => <button key={n.id} type="button" className="popup-tab" disabled={busy} title={n.id} onClick={() => onOpen(n.id)}>{n.label}</button>)}
            </section>)}
          </div>}
        </figure>
      )}
    </details>
  );
}
