import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';

type Row = { category: string; state: string; value: { ctx?: number; rate?: number } | null; at: number | null; suite: { name: string; version: number } | null; limitations: string[] };
type CardValue = { license?: string | null; pipelineTag?: string | null; libraryName?: string | null; tags?: string[]; evaluationClaims?: { task: string | null; dataset: string | null; metric: string | null; value: string | null }[]; cardExcerpt?: string | null };
type External = { category: string; state: string; value: CardValue | null; at: number | null; suite: { name: string; version: number } | null; provenance: { sourceUrl: string; retrievedAt: number } | null; limitations: string[] };
const LABEL: Record<string, string> = { context_capacity: 'Context capacity', vision: 'Image input', mtp_acceptance: 'MTP acceptance', throughput: 'Measured speed' };
const STATE: Record<string, string> = {
  verified: 'Verified for this configuration', failed: 'Failed on this configuration', stale: 'Stale — settings or files changed since',
  reported: 'Reported', unverified: 'Not measured yet', unavailable: 'Unavailable — engine or model file not readable',
};
const EXTERNAL_STATE: Record<string, string> = {
  reported: 'From source', stale: 'From source — for a different artifact', unverified: 'Not imported yet', unavailable: 'Unavailable — model file not readable',
};

/** Evidence tied to the model's exact current configuration. Never a score. */
export function EvidenceList({ model }: { model: string }): JSX.Element | null {
  const [rows, setRows] = useState<Row[] | null>(null), [error, setError] = useState(''), [checking, setChecking] = useState(false), [note, setNote] = useState('');
  const [external, setExternal] = useState<External | null>(null), [importing, setImporting] = useState(false), [importNote, setImportNote] = useState('');
  useEffect(() => {
    let live = true;
    apiFetch(`/api/models/evidence?model=${encodeURIComponent(model)}`).then(async (r) => {
      if (r.status === 404) { if (live) { setRows([]); setExternal(null); } return; }
      const v = await r.json(); if (!r.ok) throw Error(v.error || 'Evidence unavailable');
      if (live) { setRows(v.tracked ? v.categories : []); setExternal(v.external || null); }
    }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Evidence unavailable'); });
    return () => { live = false; };
  }, [model]);
  // The model manager is administrator-only, so the recheck is offered here without another role check.
  const recheck = async () => {
    setChecking(true); setNote('');
    try {
      const r = await apiFetch('/api/models/evidence/recheck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, category: 'vision' }) });
      const v = await r.json().catch(() => ({})); if (!r.ok) throw Error(v.error || 'Recheck failed');
      setRows(v.categories); setNote('Image input rechecked.');
    } catch (e) { setNote(e instanceof Error ? e.message : 'Recheck failed'); } finally { setChecking(false); }
  };
  // Fetches attributable model-card evidence from the source (#266). Best-effort on the
  // server side; a failure here just means nothing new to show, never an error the operator
  // must act on.
  const importEvidence = async () => {
    setImporting(true); setImportNote('');
    try {
      const r = await apiFetch('/api/models/evidence/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
      const v = await r.json().catch(() => ({})); if (!r.ok) throw Error(v.error || 'Evidence import failed');
      setExternal(v.external || null);
      setImportNote(v.external?.state === 'reported' ? 'Source evidence updated.' : 'No source evidence available for this model.');
    } catch (e) { setImportNote(e instanceof Error ? e.message : 'Evidence import failed'); } finally { setImporting(false); }
  };
  if (error) return <p className="mm-note" role="status">{error}</p>;
  const hasExternal = external && external.state !== 'unavailable';
  if (!rows?.length && !hasExternal) return null;
  return <>
    {rows && rows.length > 0 && <section className="mm-evidence" aria-label={`Qualification evidence for ${model}`}>
      <h4>Qualification evidence</h4>
      <ul>{rows.map((row) => <li key={row.category} data-state={row.state}>
        <strong>{LABEL[row.category] || row.category}</strong>
        <span>{STATE[row.state] || row.state}{row.category === 'context_capacity' && row.value?.ctx ? ` · ${row.value.ctx.toLocaleString('en-US')} tokens` : ''}{row.category === 'mtp_acceptance' && typeof row.value?.rate === 'number' ? ` · ${Math.round(row.value.rate * 100)}% accepted` : ''}{row.category === 'throughput' && typeof row.value?.rate === 'number' ? ` · ${row.value.rate} tokens/s` : ''}{row.at ? ` · ${new Date(row.at).toLocaleDateString()}` : ''}</span>
        {row.limitations.length > 0 && row.state !== 'unverified' && <small>{row.limitations.join(' · ')}</small>}
        {row.category === 'vision' && <button type="button" className="modal-btn secondary" disabled={checking} onClick={() => void recheck()} title="Sends a 1×1 test image; loads the model if it is not loaded">{checking ? 'Checking…' : 'Recheck'}</button>}
      </li>)}</ul>
      {note && <p className="mm-note" role="status">{note}</p>}
    </section>}
    {hasExternal && <section className="mm-evidence mm-evidence-external" aria-label={`External model evidence for ${model}`}>
      <h4>Model evidence <span className="mm-evidence-badge" title="Published by the model's source, not measured locally">unverified, from source</span></h4>
      <ul><li data-state={external!.state}>
        <span>{EXTERNAL_STATE[external!.state] || external!.state}{external!.value?.license ? ` · ${external!.value.license} license` : ''}{external!.at ? ` · retrieved ${new Date(external!.at).toLocaleDateString()}` : ''}</span>
        {external!.value?.cardExcerpt && <p>{external!.value.cardExcerpt}</p>}
        {external!.value?.evaluationClaims && external!.value.evaluationClaims.length > 0 && <ul>
          {external!.value.evaluationClaims.map((c, i) => <li key={i}>{[c.task, c.dataset, c.metric, c.value].filter(Boolean).join(' · ')}</li>)}
        </ul>}
        {external!.provenance?.sourceUrl && <small>Source: {external!.provenance.sourceUrl}</small>}
        {external!.limitations.length > 0 && <small>{external!.limitations.join(' · ')}</small>}
      </li></ul>
      <button type="button" className="modal-btn secondary" disabled={importing} onClick={() => void importEvidence()}>{importing ? 'Fetching…' : 'Fetch evidence'}</button>
      {importNote && <p className="mm-note" role="status">{importNote}</p>}
    </section>}
  </>;
}
