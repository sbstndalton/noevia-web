import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';

type Row = { category: string; state: string; value: { ctx?: number; rate?: number } | null; at: number | null; suite: { name: string; version: number } | null; limitations: string[] };
const LABEL: Record<string, string> = { context_capacity: 'Context capacity', vision: 'Image input', mtp_acceptance: 'MTP acceptance', throughput: 'Measured speed' };
const STATE: Record<string, string> = {
  verified: 'Verified for this configuration', failed: 'Failed on this configuration', stale: 'Stale — settings or files changed since',
  reported: 'Reported', unverified: 'Not measured yet', unavailable: 'Unavailable — engine or model file not readable',
};

/** Evidence tied to the model's exact current configuration. Never a score. */
export function EvidenceList({ model }: { model: string }): JSX.Element | null {
  const [rows, setRows] = useState<Row[] | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    apiFetch(`/api/models/evidence?model=${encodeURIComponent(model)}`).then(async (r) => {
      if (r.status === 404) { if (live) setRows([]); return; }
      const v = await r.json(); if (!r.ok) throw Error(v.error || 'Evidence unavailable');
      if (live) setRows(v.tracked ? v.categories : []);
    }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Evidence unavailable'); });
    return () => { live = false; };
  }, [model]);
  if (error) return <p className="mm-note" role="status">{error}</p>;
  if (!rows?.length) return null;
  return <section className="mm-evidence" aria-label={`Qualification evidence for ${model}`}>
    <h4>Qualification evidence</h4>
    <ul>{rows.map((row) => <li key={row.category} data-state={row.state}>
      <strong>{LABEL[row.category] || row.category}</strong>
      <span>{STATE[row.state] || row.state}{row.category === 'context_capacity' && row.value?.ctx ? ` · ${row.value.ctx.toLocaleString('en-US')} tokens` : ''}{row.category === 'mtp_acceptance' && typeof row.value?.rate === 'number' ? ` · ${Math.round(row.value.rate * 100)}% accepted` : ''}{row.category === 'throughput' && typeof row.value?.rate === 'number' ? ` · ${row.value.rate} tokens/s` : ''}{row.at ? ` · ${new Date(row.at).toLocaleDateString()}` : ''}</span>
      {row.limitations.length > 0 && row.state !== 'unverified' && <small>{row.limitations.join(' · ')}</small>}
    </li>)}</ul>
  </section>;
}
