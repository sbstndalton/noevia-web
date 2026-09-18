import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { LiveStats } from '../types';
import { Icon } from './icons/Icon';

interface StatsBarProps {
  stats: LiveStats | null; // App polls /api/stats and passes it down (single poller)
  /** What the composer says it will send to — so the strip names the model that answered. */
  modelLabel?: string;
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

/** Phones collapse the strip to one line; anything wider shows it in full, because a
 *  desktop has the width to spare and hiding live state behind a tap there is a click
 *  for nothing (user review of `ab2720a`, 2026-09-18). */
const PHONE = '(max-width: 700px)';
function usePhone(): boolean {
  const [phone, setPhone] = useState(() => { try { return window.matchMedia(PHONE).matches; } catch { return false; } });
  useEffect(() => {
    let query: MediaQueryList;
    try { query = window.matchMedia(PHONE); } catch { return; }
    const sync = () => setPhone(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return phone;
}

/** Inference status under the composer: on a phone a single line (status, model, speed) that
 *  expands into plain-language details; on a desktop the same details, always open, laid out
 *  across the width instead of stacked. Purely presentational: App owns the /api/stats poll. */
export function StatsBar({ stats, modelLabel }: StatsBarProps): JSX.Element {
  const phone = usePhone();
  const [userOpen, setUserOpen] = useState(readOpen);
  const up = !!stats?.up;
  // No reading yet (first poll in flight, or the page opened in the background, where the
  // poll waits): say nothing is known rather than report an outage that has not happened.
  const unknown = stats === null;
  const open = phone ? userOpen : true;
  const toggle = () => setUserOpen((value) => {
    const next = !value;
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* per-browser convenience only */ }
    return next;
  });
  // The collapsed line carries the speed because the details are hidden behind it; the
  // wide row does not, because the Speed pair is right there.
  const status = (withSpeed: boolean) => (
    <>
      <span className={`stats-live-dot${up ? '' : unknown ? ' unknown' : ' down'}`} aria-hidden="true" />
      <span className="stats-label">{up || unknown ? (modelLabel || 'Inference') : 'Inference offline'}</span>
      {up && withSpeed && <span className="stats-value">{fmt(stats?.tokensPerSecond ?? null)}<span className="stats-unit"> tok/s</span></span>}
    </>
  );
  const details = (
    <dl className="stats-details" id="stats-details">
      <div><dt title="Provider-reported rate. Invalid samples and samples shorter than one estimated second are omitted.">Speed</dt><dd>{fmt(stats?.tokensPerSecond ?? null)} tokens/s</dd></div>
      <div><dt>First token</dt><dd>{fmt(stats?.timeToFirstToken ?? null, 2, ' s')}</dd></div>
      <div><dt title={stats?.telemetryScope || undefined}>Last reply</dt><dd>{fmtCount(stats?.inputTokens ?? null)} in · {fmtCount(stats?.outputTokens ?? null)} out</dd></div>
      <div><dt title={stats?.telemetryScope || undefined}>Total</dt><dd>{fmtCount(stats?.inputTokensTotal ?? null)} in · {fmtCount(stats?.outputTokensTotal ?? null)} out · {fmtCount(stats?.requestCount ?? null)} requests</dd></div>
      <div><dt>GPU</dt><dd>{fmt(stats?.gpuPercent ?? null, 0, '%')} · {fmt(stats?.vramGb ?? null, 1, ' GB')} VRAM</dd></div>
      {(stats?.mtp || []).map(m => <div className="stats-mtp" key={m.model} title={`${m.model} · ${m.source || 'backend total'}: accepted draft tokens / proposed draft tokens`}>
        <dt>MTP acceptance{m.source === 'last response' ? ' (last reply)' : ''}</dt>
        <dd>{m.rate == null ? 'Awaiting backend counters' : `${(m.rate * 100).toFixed(1)}%`}<progress aria-label={`MTP acceptance for ${m.model}`} max={1} value={m.rate ?? undefined} /></dd>
      </div>)}
    </dl>
  );

  // Wide: one row, no control — there is nothing to reveal.
  if (!phone) {
    return (
      <section className="stats-disclosure is-open is-wide" aria-label="Inference details">
        <p className="stats-bar stats-bar-static">{status(false)}</p>
        {details}
      </section>
    );
  }

  return (
    <section className={`stats-disclosure${open ? ' is-open' : ''}`} aria-label="Inference details">
      <button type="button" className="stats-bar" aria-expanded={open} aria-controls="stats-details" onClick={toggle}
        title={open ? 'Hide inference details' : 'Show inference details'}>
        {status(true)}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>
      {open && details}
    </section>
  );
}
