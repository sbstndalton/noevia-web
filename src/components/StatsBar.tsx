import { useState } from 'react';
import type { JSX } from 'react';
import type { LiveStats } from '../types';
import { Icon } from './icons/Icon';

interface StatsBarProps {
  stats: LiveStats | null; // App polls /api/stats and passes it down (single poller)
}

function fmt(n: number | null, digits = 1, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
}

function fmtCount(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

const OPEN_KEY = 'noevia:stats-open';
const readOpen = (): boolean => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } };

/** Inference status at the bottom of the workspace: a quiet pill (status + speed) that expands into
 *  plain-language details. Purely presentational: App owns the /api/stats poll (one poller total). */
export function StatsBar({ stats }: StatsBarProps): JSX.Element {
  const [open, setOpen] = useState(readOpen);
  const up = !!stats?.up;
  const toggle = () => setOpen((value) => {
    const next = !value;
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* per-browser convenience only */ }
    return next;
  });
  return (
    <section className={`stats-disclosure${open ? ' is-open' : ''}`} aria-label="Inference details">
      {open && <dl className="stats-details" id="stats-details">
        <div><dt title="Provider-reported rate. Invalid samples and samples shorter than one estimated second are omitted.">Speed</dt><dd>{fmt(stats?.tokensPerSecond ?? null)} tokens/s</dd></div>
        <div><dt>First token</dt><dd>{fmt(stats?.timeToFirstToken ?? null, 2, ' s')}</dd></div>
        <div><dt title={stats?.telemetryScope || undefined}>Last reply</dt><dd>{fmtCount(stats?.inputTokens ?? null)} in · {fmtCount(stats?.outputTokens ?? null)} out</dd></div>
        <div><dt title={stats?.telemetryScope || undefined}>Total</dt><dd>{fmtCount(stats?.inputTokensTotal ?? null)} in · {fmtCount(stats?.outputTokensTotal ?? null)} out · {fmtCount(stats?.requestCount ?? null)} requests</dd></div>
        <div><dt>GPU</dt><dd>{fmt(stats?.gpuPercent ?? null, 0, '%')} · {fmt(stats?.vramGb ?? null, 1, ' GB')} VRAM</dd></div>
        {(stats?.mtp || []).map(m => <div className="stats-mtp" key={m.model} title={`${m.model} · ${m.source || 'backend total'}: accepted draft tokens / proposed draft tokens`}>
          <dt>MTP acceptance{m.source === 'last response' ? ' (last reply)' : ''}</dt>
          <dd>{m.rate == null ? 'Awaiting backend counters' : `${(m.rate * 100).toFixed(1)}%`}<progress aria-label={`MTP acceptance for ${m.model}`} max={1} value={m.rate ?? undefined} /></dd>
        </div>)}
      </dl>}
      <button type="button" className="stats-bar" aria-expanded={open} aria-controls="stats-details" onClick={toggle}
        title={open ? 'Hide inference details' : 'Show inference details'}>
        <span className={`stats-live-dot${up ? '' : ' down'}`} aria-hidden="true" />
        <span className="stats-label">{up ? 'Inference' : 'Inference offline'}</span>
        {up && <><span className="stats-value">{fmt(stats?.tokensPerSecond ?? null)}</span><span className="stats-unit">tok/s</span></>}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>
    </section>
  );
}
