import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { LiveStats, ReplyTelemetry, RoutingDecision } from '../types';
import { Icon } from './icons/Icon';
import { RoutingDetails } from './ChatView';

interface StatsBarProps {
  stats: LiveStats | null; // App polls /api/stats and passes it down (single poller)
  /** Exact, request-local facts from the currently visible chat's SSE stream. */
  reply?: ReplyTelemetry | null;
  /** Request-local route for the latest assistant turn in the visible chat. */
  routingDecision?: RoutingDecision | null;
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
// layout-mode.js narrows a forced "mobile" preview by capping #root's width (noevia.css), not
// the CSS viewport a desktop browser reports, so matchMedia alone misses it. Honour the forced
// layout the same way the stylesheet does, and its change event since toggling it isn't a resize.
const narrow = (): boolean => { try { return window.matchMedia(PHONE).matches || document.documentElement.dataset.layout === 'mobile'; } catch { return document.documentElement.dataset.layout === 'mobile'; } };
function usePhone(): boolean {
  const [phone, setPhone] = useState(() => { try { return narrow(); } catch { return false; } });
  useEffect(() => {
    let query: MediaQueryList | null = null;
    try { query = window.matchMedia(PHONE); } catch { /* matchMedia is optional here */ }
    const sync = () => setPhone(narrow());
    sync();
    query?.addEventListener('change', sync);
    window.addEventListener('noevia-layout-change', sync);
    return () => { query?.removeEventListener('change', sync); window.removeEventListener('noevia-layout-change', sync); };
  }, []);
  return phone;
}

/** Inference status under the composer: on a phone a single line (status, model, speed) that
 *  expands into plain-language details; on a desktop the same details, always open, laid out
 *  across the width instead of stacked. Purely presentational: App owns the /api/stats poll. */
export function StatsBar({ stats, reply, routingDecision, modelLabel }: StatsBarProps): JSX.Element {
  const phone = usePhone();
  const [userOpen, setUserOpen] = useState(readOpen);
  const rootRef = useRef<HTMLElement>(null);
  // The routing panel is an anchored popover (it must not grow the strip or squeeze the
  // chat), so give it the Escape-to-close a popover is expected to have even though the
  // underlying <details> element has no built-in keyboard dismissal.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const panel = rootRef.current?.querySelector<HTMLDetailsElement>('.routing-details[open]');
      if (!panel) return;
      panel.open = false;
      panel.querySelector('summary')?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  const active = reply?.phase === 'waiting' || reply?.phase === 'streaming';
  // A completed external-provider reply is valid even when the separately
  // polled native engine is down. Do not relabel that reply as offline.
  const up = active || reply?.phase === 'complete' || !!stats?.up;
  // No reading yet (first poll in flight, or the page opened in the background, where the
  // poll waits): say nothing is known rather than report an outage that has not happened.
  const unknown = stats === null && !active;
  const displayModel = reply?.model || modelLabel || 'Inference';
  // Once this chat has request-local telemetry, never substitute an
  // engine-wide sample that may belong to another request or account.
  const replyRate = reply ? reply.tokensPerSecond : stats?.tokensPerSecond ?? null;
  const firstToken = reply ? reply.timeToFirstToken : stats?.timeToFirstToken ?? null;
  const replyInput = reply ? reply.inputTokens : stats?.inputTokens ?? null;
  const replyOutput = reply ? reply.outputTokens : stats?.outputTokens ?? null;
  const mtp = reply?.mtp.length
    ? reply.mtp
    : reply
      ? (stats?.mtp || []).filter((sample) => sample.source !== 'last response')
      : (stats?.mtp || []);
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
      <span className="stats-label">{active ? `${displayModel} · Generating` : up || unknown ? displayModel : 'Inference offline'}</span>
      {(up || replyRate != null) && withSpeed && <span className="stats-value">{active && replyRate == null ? 'Measuring…' : fmt(replyRate)}{replyRate != null && <span className="stats-unit"> tok/s</span>}</span>}
    </>
  );
  const replyCounts = replyInput == null && replyOutput == null
    ? (active ? 'Awaiting provider usage…' : 'Not reported')
    : `${fmtCount(replyInput)} in · ${fmtCount(replyOutput)} out`;
  const totalParts = [
    stats?.inputTokensTotal == null ? null : `${fmtCount(stats.inputTokensTotal)} in`,
    stats?.outputTokensTotal == null ? null : `${fmtCount(stats.outputTokensTotal)} out`,
    stats?.requestCount == null ? null : `${fmtCount(stats.requestCount)} requests`,
  ].filter(Boolean);
  const gpuParts = [
    stats?.gpuPercent == null ? null : fmt(stats.gpuPercent, 0, '%'),
    stats?.vramGb == null ? null : `${fmt(stats.vramGb, 1, ' GB')} VRAM`,
  ].filter(Boolean);
  const replyLabel = active ? 'Current reply' : reply?.phase === 'stopped' ? 'Stopped reply' : reply?.phase === 'error' ? 'Failed reply' : 'Last reply';
  const liveAnnouncement = active
    ? `${displayModel} is generating. ${firstToken == null ? 'Waiting for first output.' : 'First output received.'}`
    : reply?.phase === 'complete' ? 'Reply telemetry updated.' : reply?.phase === 'stopped' ? 'Reply stopped.' : reply?.phase === 'error' ? 'Reply failed.' : '';
  const details = (
    <dl className="stats-details" id="stats-details">
      <div data-stat="speed"><dt title="Provider-reported generation rate for this chat reply. It appears only when the provider supplies final timings.">Speed</dt><dd>{active && replyRate == null ? 'Measuring…' : replyRate == null ? 'Not reported' : `${fmt(replyRate)} tokens/s`}</dd></div>
      <div data-stat="first-token"><dt title="Server-observed time from request handling through routing, preparation and provider prefill to the first real output.">First token</dt><dd>{firstToken == null ? (active ? 'Waiting…' : 'Not reported') : fmt(firstToken, 2, ' s')}</dd></div>
      <div data-stat="reply"><dt title="Provider-reported tokens, cumulative across every model round in this tool-loop exchange.">{replyLabel}</dt><dd>{replyCounts}</dd></div>
      <div data-stat="total"><dt title={stats?.telemetryScope || 'Engine-scoped counters; availability depends on the backend.'}>Engine total</dt><dd>{totalParts.length ? totalParts.join(' · ') : 'Unavailable from engine'}</dd></div>
      <div data-stat="gpu"><dt>GPU</dt><dd>{gpuParts.length ? gpuParts.join(' · ') : 'Unavailable from engine'}</dd></div>
      {mtp.map(m => <div className="stats-mtp" data-stat="mtp" key={m.model} title={`${m.model} · ${m.source || 'backend total'}: accepted draft tokens / proposed draft tokens`}>
        <dt>MTP acceptance{m.source === 'last response' ? (active ? ' (current reply)' : ' (last reply)') : ' (engine total)'}</dt>
        <dd>{m.rate == null ? 'Awaiting backend counters' : `${(m.rate * 100).toFixed(1)}%`}<progress aria-label={`MTP acceptance for ${m.model}`} max={1} value={m.rate ?? undefined} /></dd>
      </div>)}
    </dl>
  );

  // Wide: one row, no control — there is nothing to reveal.
  if (!phone) {
    return (
      <section ref={rootRef} className="stats-disclosure is-open is-wide" aria-label="Inference details">
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveAnnouncement}</span>
        <p className="stats-bar stats-bar-static">{status(false)}</p>
        {details}
        {routingDecision && <RoutingDetails decision={routingDecision} />}
      </section>
    );
  }

  return (
    <section ref={rootRef} className={`stats-disclosure${open ? ' is-open' : ''}`} aria-label="Inference details">
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveAnnouncement}</span>
      <button type="button" className="stats-bar" aria-expanded={open} aria-controls="stats-details" onClick={toggle}
        title={open ? 'Hide inference details' : 'Show inference details'}>
        {status(true)}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>
      {open && details}
      {routingDecision && <RoutingDetails decision={routingDecision} />}
    </section>
  );
}
