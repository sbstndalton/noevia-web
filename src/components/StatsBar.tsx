import type { JSX } from 'react';
import type { LiveStats } from '../types';

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

/** Slim live readout docked at the bottom of the chat column.
 *  Purely presentational: App owns the /api/stats poll loop (one poller total). */
export function StatsBar({ stats }: StatsBarProps): JSX.Element {
  return (
    <section className="stats-disclosure" aria-label="Inference details">

      <div className="stats-bar">
      <span className={`stats-live-dot${stats?.up ? '' : ' down'}`} />
      <span className="stats-item">
        <span className="stats-label" title="Provider-reported rate. Invalid samples and samples shorter than one estimated second are omitted.">reported tok/s</span>
        <span className="stats-value">{fmt(stats?.tokensPerSecond ?? null)}</span>
      </span>
      <span className="stats-item">
        <span className="stats-label">TTFT</span>
        <span className="stats-value">{fmt(stats?.timeToFirstToken ?? null, 2, 's')}</span>
      </span>
      <span className="stats-sep" />
      <span className="stats-item">
        <span className="stats-label">in</span>
        <span className="stats-value">
          {fmtCount(stats?.inputTokens ?? null)}
          <span className="stats-dim"> / {fmtCount(stats?.inputTokensTotal ?? null)}</span>
        </span>
      </span>
      <span className="stats-item">
        <span className="stats-label">out</span>
        <span className="stats-value">
          {fmtCount(stats?.outputTokens ?? null)}
          <span className="stats-dim"> / {fmtCount(stats?.outputTokensTotal ?? null)}</span>
        </span>
      </span>
      <span className="stats-item">
        <span className="stats-label">reqs</span>
        <span className="stats-value">{fmtCount(stats?.requestCount ?? null)}</span>
      </span>
      <span className="stats-sep" />
      <span className="stats-item">
        <span className="stats-label">GPU</span>
        <span className="stats-value">{fmt(stats?.gpuPercent ?? null, 0, '%')}</span>
      </span>
      <span className="stats-item">
        <span className="stats-label">VRAM</span>
        <span className="stats-value">{fmt(stats?.vramGb ?? null, 1, ' GB')}</span>
      </span>
      {(stats?.mtp || []).map(m=><span className="stats-mtp" key={m.model} title={`${m.model} · cumulative accepted draft tokens / proposed draft tokens for this loaded backend`}>
        <span>MTP acceptance · {m.rate == null ? 'Awaiting backend counters' : `${(m.rate*100).toFixed(1)}%`}</span>
        <progress aria-label={`MTP acceptance for ${m.model}`} max={1} value={m.rate ?? undefined} />
      </span>)}
      <span className="stats-grow" />
      <span className="stats-src">Inference</span>
      </div>
    </section>
  );
}
