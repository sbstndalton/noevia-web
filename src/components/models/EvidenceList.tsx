import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { useT } from '../../i18n';
import { num } from './mm';
import type { MessageKey } from '../../i18n';

type Row = { category: string; state: string; value: { ctx?: number; rate?: number } | null; at: number | null; suite: { name: string; version: number } | null; limitations: string[] };
type CardValue = { license?: string | null; pipelineTag?: string | null; libraryName?: string | null; tags?: string[]; evaluationClaims?: { task: string | null; dataset: string | null; metric: string | null; value: string | null }[]; cardExcerpt?: string | null };
type External = { category: string; state: string; value: CardValue | null; at: number | null; suite: { name: string; version: number } | null; provenance: { sourceUrl: string; retrievedAt: number } | null; limitations: string[] };
const LABEL: Record<string, MessageKey> = { context_capacity: 'mm.evidence.label.context', vision: 'mm.evidence.label.vision', mtp_acceptance: 'mm.evidence.label.mtp', throughput: 'mm.evidence.label.throughput' };
const STATE: Record<string, MessageKey> = {
  verified: 'mm.evidence.state.verified', failed: 'mm.evidence.state.failed', stale: 'mm.evidence.state.stale',
  reported: 'mm.evidence.state.reported', unverified: 'mm.evidence.state.unverified', unavailable: 'mm.evidence.state.unavailable',
};
const EXTERNAL_STATE: Record<string, MessageKey> = {
  reported: 'mm.evidence.external.reported', stale: 'mm.evidence.external.stale', unverified: 'mm.evidence.external.unverified', unavailable: 'mm.evidence.external.unavailable',
};

/** Evidence tied to the model's exact current configuration. Never a score. */
export function EvidenceList({ model }: { model: string }): JSX.Element | null {
  const [rows, setRows] = useState<Row[] | null>(null), [error, setError] = useState(''), [checking, setChecking] = useState(false), [note, setNote] = useState('');
  const [external, setExternal] = useState<External | null>(null), [importing, setImporting] = useState(false), [importNote, setImportNote] = useState('');
  const t = useT();
  const tRef = useRef(t); tRef.current = t;
  const own = (map: Record<string, MessageKey>, id: string) => (map[id] ? t(map[id]) : id);
  useEffect(() => {
    let live = true;
    apiFetch(`/api/models/evidence?model=${encodeURIComponent(model)}`).then(async (r) => {
      if (r.status === 404) { if (live) { setRows([]); setExternal(null); } return; }
      const v = await r.json(); if (!r.ok) throw Error(v.error || tRef.current('mm.evidence.unavailable'));
      if (live) { setRows(v.tracked ? v.categories : []); setExternal(v.external || null); }
    }).catch((e) => { if (live) setError(e instanceof Error ? e.message : tRef.current('mm.evidence.unavailable')); });
    return () => { live = false; };
  }, [model]);
  // The model manager is administrator-only, so the recheck is offered here without another role check.
  const recheck = async () => {
    setChecking(true); setNote('');
    try {
      const r = await apiFetch('/api/models/evidence/recheck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, category: 'vision' }) });
      const v = await r.json().catch(() => ({})); if (!r.ok) throw Error(v.error || t('mm.evidence.recheckFailed'));
      setRows(v.categories); setNote(t('mm.evidence.rechecked'));
    } catch (e) { setNote(e instanceof Error ? e.message : t('mm.evidence.recheckFailed')); } finally { setChecking(false); }
  };
  // Fetches attributable model-card evidence from the source (#266). Best-effort on the
  // server side; a failure here just means nothing new to show, never an error the operator
  // must act on.
  const importEvidence = async () => {
    setImporting(true); setImportNote('');
    try {
      const r = await apiFetch('/api/models/evidence/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
      const v = await r.json().catch(() => ({})); if (!r.ok) throw Error(v.error || t('mm.evidence.importFailed'));
      setExternal(v.external || null);
      setImportNote(v.external?.state === 'reported' ? t('mm.evidence.updated') : t('mm.evidence.noSource'));
    } catch (e) { setImportNote(e instanceof Error ? e.message : t('mm.evidence.importFailed')); } finally { setImporting(false); }
  };
  if (error) return <p className="mm-note" role="status">{error}</p>;
  const hasExternal = external && external.state !== 'unavailable';
  if (!rows?.length && !hasExternal) return null;
  return <>
    {rows && rows.length > 0 && <section className="mm-evidence" aria-label={t('mm.evidence.qualificationFor', { model })}>
      <h4>{t('mm.evidence.qualification')}</h4>
      <ul>{rows.map((row) => <li key={row.category} data-state={row.state}>
        <strong>{own(LABEL, row.category)}</strong>
        <span>{own(STATE, row.state)}{row.category === 'context_capacity' && row.value?.ctx ? ` · ${t('mm.tokensCount', { tokens: num(row.value.ctx, 0) })}` : ''}{row.category === 'mtp_acceptance' && typeof row.value?.rate === 'number' ? ` · ${t('mm.evidence.accepted', { pct: Math.round(row.value.rate * 100) })}` : ''}{row.category === 'throughput' && typeof row.value?.rate === 'number' ? ` · ${t('mm.tokensPerSecond', { rate: num(row.value.rate) })}` : ''}{row.at ? ` · ${new Date(row.at).toLocaleDateString(t.locale)}` : ''}</span>
        {row.limitations.length > 0 && row.state !== 'unverified' && <small>{row.limitations.join(' · ')}</small>}
        {row.category === 'vision' && <button type="button" className="modal-btn secondary" disabled={checking} onClick={() => void recheck()} title={t('mm.evidence.recheckTitle')}>{checking ? t('mm.checking') : t('mm.evidence.recheck')}</button>}
      </li>)}</ul>
      {note && <p className="mm-note" role="status">{note}</p>}
    </section>}
    {hasExternal && <section className="mm-evidence mm-evidence-external" aria-label={t('mm.evidence.externalFor', { model })}>
      <h4>{t('mm.evidence.model')} <span className="mm-evidence-badge" title={t('mm.evidence.badgeTitle')}>{t('mm.evidence.badge')}</span></h4>
      <ul><li data-state={external!.state}>
        <span>{own(EXTERNAL_STATE, external!.state)}{external!.value?.license ? ` · ${t('mm.evidence.license', { license: external!.value.license })}` : ''}{external!.at ? ` · ${t('mm.evidence.retrieved', { date: new Date(external!.at).toLocaleDateString(t.locale) })}` : ''}</span>
        {external!.value?.cardExcerpt && <p>{external!.value.cardExcerpt}</p>}
        {external!.value?.evaluationClaims && external!.value.evaluationClaims.length > 0 && <ul>
          {external!.value.evaluationClaims.map((c, i) => <li key={i}>{[c.task, c.dataset, c.metric, c.value].filter(Boolean).join(' · ')}</li>)}
        </ul>}
        {external!.provenance?.sourceUrl && <small>{t('mm.evidence.source', { url: external!.provenance.sourceUrl })}</small>}
        {external!.limitations.length > 0 && <small>{external!.limitations.join(' · ')}</small>}
      </li></ul>
      <button type="button" className="modal-btn secondary" disabled={importing} onClick={() => void importEvidence()}>{importing ? t('mm.evidence.fetching') : t('mm.evidence.fetch')}</button>
      {importNote && <p className="mm-note" role="status">{importNote}</p>}
    </section>}
  </>;
}
