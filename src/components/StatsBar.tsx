import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import type { LiveStats, ReplyTelemetry, RoutingDecision } from '../types';
import { Icon } from './icons/Icon';
import { RoutingDetails } from './ChatView';
import { isDisplayableRoutingDecision } from '../current-routing';
import { useT } from '../i18n';
import { senderLabelText } from '../chat-labels';
import { appLocale } from '../user-preferences';
import { formatCompact, formatNumber, formatPercent, formatSizeUnit } from '../number-format';
import { LOCAL_MODEL_FALLBACK } from '../model-guidance';
import { engineEmptyKey } from '../stats-engine-text';
import { anchorAboveComposer, type AnchorAbove } from '../stats-anchor';

interface StatsBarProps {
  stats: LiveStats | null; // App polls /api/stats and passes it down (single poller)
  /** Exact, request-local facts from the currently visible chat's SSE stream. */
  reply?: ReplyTelemetry | null;
  /** Request-local route for the latest assistant turn in the visible chat. */
  routingDecision?: RoutingDecision | null;
  /** What the composer says it will send to — so the strip names the model that answered. */
  modelLabel?: string;
  /** #527, phone-sized space: `announce` keeps only the screen-reader live line in the page, and
   *  `sheet` is the visible block inside the model sheet (one line that expands, as on a phone,
   *  without a second live region). The default is unchanged. */
  variant?: 'default' | 'sheet' | 'announce';
}

function fmt(n: number | null, digits = 1, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${formatNumber(n, appLocale(), digits)}${suffix}`;
}

function fmtCount(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return formatCompact(Math.round(n), appLocale());
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

/** The composer block this strip sits under (ChatView's `.composer`: context row, mode bar, box, hint). */
function composerBlock(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.chat-composer-inner')?.closest<HTMLElement>('.composer') ?? null;
}

/** #1649: the routing details, reporting its open state to the strip. It leaves the page when the strip
 *  switches between the wide row and the phone line, or when the decision stops being displayable, and the
 *  <details> that replaces it is closed, so no toggle event clears the state. Clearing it on the way out does. */
function RoutingPanel({ decision, onOpenChange }: { decision: RoutingDecision; onOpenChange: (open: boolean) => void }): JSX.Element | null {
  useLayoutEffect(() => () => onOpenChange(false), [onOpenChange]);
  return <RoutingDetails decision={decision} onOpenChange={onOpenChange} />;
}

/** Inference status under the composer: on a phone a single line (status, model, speed) that
 *  expands into plain-language details; on a desktop the same details, always open, laid out
 *  across the width instead of stacked. Purely presentational: App owns the /api/stats poll. */
export function StatsBar({ stats, reply, routingDecision, modelLabel, variant = 'default' }: StatsBarProps): JSX.Element {
  const t = useT();
  const phone = usePhone() || variant === 'sheet';
  const [userOpen, setUserOpen] = useState(readOpen);
  // #1527: where the one row cannot hold every pair, the lower-priority pairs open from a compact
  // toggle as a popover above the strip, so the composer never moves.
  const [moreOpen, setMoreOpen] = useState(false);
  // #1631: the routing details are the strip's other popover, and open over the same place.
  const [routingOpen, setRoutingOpen] = useState(false);
  // #1649: one popover at a time. Opening the routing details closes the metrics popover, and opening the
  // metrics closes the routing details (its toggle event then clears routingOpen).
  const onRoutingOpenChange = useCallback((open: boolean) => {
    setRoutingOpen(open);
    if (open) setMoreOpen(false);
  }, []);
  // #1649: the panel counts as open only while it is rendered (a displayable decision) and its state says so.
  const shownRouting = routingDecision && isDisplayableRoutingDecision(routingDecision) ? routingDecision : null;
  const routingPanelOpen = routingOpen && shownRouting !== null;
  // #1628, #1631: while a popover is open, its bottom edge is measured to sit above the composer block, so it
  // never covers the composer or the send button. Re-measured when the window or either box changes size.
  // The model sheet (variant 'sheet') lays the routing details out in flow, so there is nothing to place.
  const [moreAnchor, setMoreAnchor] = useState<AnchorAbove | null>(null);
  const anchored = moreOpen || (routingPanelOpen && variant !== 'sheet');
  const rootRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!anchored) { setMoreAnchor(null); return undefined; }
    const place = () => {
      const strip = rootRef.current?.getBoundingClientRect();
      const box = composerBlock()?.getBoundingClientRect();
      const next = strip && box && box.height > 0 ? anchorAboveComposer(strip.bottom, box.top) : null;
      setMoreAnchor(previous => (previous?.bottom === next?.bottom && previous?.maxHeight === next?.maxHeight ? previous : next));
    };
    place();
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (rootRef.current) observer?.observe(rootRef.current);
    // #1649: the composer is observed as the element that is on screen now. A replaced composer (the chat
    // changes under an open popover) is unobserved and the new one observed, found by a MutationObserver on
    // the strip's parent, which holds the chat view and the strip as siblings.
    let composer: HTMLElement | null = null;
    const follow = () => {
      const next = composerBlock();
      if (next === composer) return;
      if (composer) observer?.unobserve(composer);
      composer = next;
      if (next) observer?.observe(next);
      place();
    };
    follow();
    const parent = rootRef.current?.parentElement ?? null;
    const watch = parent && typeof MutationObserver !== 'undefined' ? new MutationObserver(follow) : null;
    if (parent) watch?.observe(parent, { childList: true, subtree: true });
    return () => { window.removeEventListener('resize', place); watch?.disconnect(); observer?.disconnect(); };
  }, [anchored]);
  // #1649: opening the metrics closes the routing details (one popover at a time).
  useEffect(() => {
    if (!moreOpen) return;
    const panel = rootRef.current?.querySelector<HTMLDetailsElement>('.routing-details[open]');
    if (panel) panel.open = false;
  }, [moreOpen]);
  // The routing panel is an anchored popover (it must not grow the strip or squeeze the
  // chat), so give it the Escape-to-close a popover is expected to have even though the
  // underlying <details> element has no built-in keyboard dismissal.
  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [moreOpen]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (moreOpen) {
        setMoreOpen(false);
        moreRef.current?.focus();
        event.preventDefault();
        return;
      }
      const panel = rootRef.current?.querySelector<HTMLDetailsElement>('.routing-details[open]');
      if (!panel) return;
      panel.open = false;
      panel.querySelector('summary')?.focus();
      // In the model sheet this Escape closes the routing panel, not the sheet around it.
      if (variant === 'sheet') event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [variant, moreOpen]);
  const active = reply?.phase === 'waiting' || reply?.phase === 'streaming';
  // A completed external-provider reply is valid even when the separately
  // polled native engine is down. Do not relabel that reply as offline.
  const up = active || reply?.phase === 'complete' || !!stats?.up;
  // No reading yet (first poll in flight, or the page opened in the background, where the
  // poll waits): say nothing is known rather than report an outage that has not happened.
  const unknown = stats === null && !active;
  // modelChoiceLabel (model-guidance.ts, loaded outside React so it stays translation-free)
  // falls back to the LOCAL_MODEL_FALLBACK sentinel; translate that one case here.
  // The Auto labels are stored as language-neutral tokens; senderLabelText words them in the interface language (#643).
  const displayModel = senderLabelText(t, reply?.model || (modelLabel === LOCAL_MODEL_FALLBACK ? t('stats.localModel') : modelLabel) || t('stats.inference'));
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
      <span className="stats-label">{active ? t('stats.generating', { model: displayModel }) : up || unknown ? displayModel : t('stats.inferenceOffline')}</span>
      {(up || replyRate != null) && withSpeed && <span className="stats-value">{active && replyRate == null ? t('stats.measuring') : fmt(replyRate)}{replyRate != null && <span className="stats-unit"> {t('stats.tokPerSecUnit')}</span>}</span>}
    </>
  );
  const replyCounts = replyInput == null && replyOutput == null
    ? (active ? t('stats.awaitingProviderUsage') : t('stats.notReported'))
    : t('stats.inOut', { input: fmtCount(replyInput), output: fmtCount(replyOutput) });
  const totalParts = [
    stats?.inputTokensTotal == null ? null : t('stats.inCount', { count: fmtCount(stats.inputTokensTotal) }),
    stats?.outputTokensTotal == null ? null : t('stats.outCount', { count: fmtCount(stats.outputTokensTotal) }),
    stats?.requestCount == null ? null : t.plural('stats.requestsCount', stats.requestCount, { count: fmtCount(stats.requestCount) }),
  ].filter(Boolean);
  const gpuParts = [
    stats?.gpuPercent == null ? null : formatPercent(stats.gpuPercent, appLocale(), 0),
    stats?.vramGb == null ? null : t('stats.vram', { value: formatSizeUnit(stats.vramGb, 'GB', appLocale(), 1) }),
  ].filter(Boolean);
  const replyLabel = active ? t('stats.currentReply') : reply?.phase === 'stopped' ? t('stats.stoppedReply') : reply?.phase === 'error' ? t('stats.failedReply') : t('stats.lastReply');
  const liveAnnouncement = active
    ? t('stats.liveGenerating', { model: displayModel, status: firstToken == null ? t('stats.waitingFirstOutput') : t('stats.firstOutputReceived') })
    : reply?.phase === 'complete' ? t('stats.replyTelemetryUpdated') : reply?.phase === 'stopped' ? t('stats.replyStoppedAnnouncement') : reply?.phase === 'error' ? t('stats.replyFailedAnnouncement') : '';
  const details = (
    <dl className="stats-details" id="stats-details">
      <div data-stat="speed" data-priority="high"><dt title={t('stats.speedHint')}>{t('stats.speed')}</dt><dd>{active && replyRate == null ? t('stats.measuring') : replyRate == null ? t('stats.notReported') : t('stats.tokensPerSecond', { value: fmt(replyRate) })}</dd></div>
      <div data-stat="first-token" data-priority="low"><dt title={t('stats.firstTokenHint')}>{t('stats.firstToken')}</dt><dd>{firstToken == null ? (active ? t('stats.waiting') : t('stats.notReported')) : fmt(firstToken, 2, ' s')}</dd></div>
      <div data-stat="reply" data-priority="low"><dt title={t('stats.replyHint')}>{replyLabel}</dt><dd>{replyCounts}</dd></div>
      <div data-stat="total" data-priority="low"><dt title={stats?.telemetryScope || t('stats.engineTotalDefaultHint')}>{t('stats.engineTotal')}</dt><dd>{totalParts.length ? totalParts.join(' · ') : t(engineEmptyKey(reply))}</dd></div>
      <div data-stat="gpu" data-priority="low"><dt>{t('stats.gpu')}</dt><dd>{gpuParts.length ? gpuParts.join(' · ') : t(engineEmptyKey(reply))}</dd></div>
      {mtp.map(m => <div className="stats-mtp" data-stat="mtp" data-priority="low" key={m.model} title={t('stats.mtpTitle', { model: m.model, source: m.source || t('stats.mtpSourceEngineTotal') })}>
        <dt>{t('stats.mtpAcceptance')}{m.source === 'last response' ? (active ? t('stats.mtpCurrentReply') : t('stats.mtpLastReply')) : t('stats.mtpEngineTotal')}</dt>
        <dd>{m.rate == null ? t('stats.mtpAwaiting') : t('stats.mtpPercent', { value: formatNumber(m.rate * 100, appLocale(), 1) })}<progress aria-label={t('stats.mtpAriaLabel', { model: m.model })} max={1} value={m.rate ?? undefined} /></dd>
      </div>)}
    </dl>
  );

  const anchorStyle = anchored && moreAnchor ? { '--stats-more-bottom': `${moreAnchor.bottom}px`, '--stats-more-max': `${moreAnchor.maxHeight}px` } as CSSProperties : undefined;
  const announcer = <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveAnnouncement}</span>;
  if (variant === 'announce') return <div className="stats-announcer">{announcer}</div>;
  // Wide: one row. Where the row is too narrow for every pair, the low-priority pairs sit behind
  // the compact toggle (CSS picks the width; the toggle is hidden where the row fits).
  if (!phone) {
    return (
      <section ref={rootRef} className={`stats-disclosure is-open is-wide${moreOpen ? ' is-more-open' : ''}`} aria-label={t('stats.ariaLabel')}
        style={anchorStyle}>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveAnnouncement}</span>
        <p className="stats-bar stats-bar-static">{status(false)}</p>
        {details}
        <button ref={moreRef} type="button" className="stats-more" aria-expanded={moreOpen} aria-controls="stats-details"
          aria-label={moreOpen ? t('stats.hide') : t('stats.show')} title={moreOpen ? t('stats.hide') : t('stats.show')}
          onClick={() => setMoreOpen(value => !value)}><Icon name="chevron-right" size={14} /></button>
        {shownRouting && <RoutingPanel decision={shownRouting} onOpenChange={onRoutingOpenChange} />}
      </section>
    );
  }

  return (
    <section ref={rootRef} className={`stats-disclosure${open ? ' is-open' : ''}${variant === 'sheet' ? ' is-sheet' : ''}`} aria-label={t('stats.ariaLabel')} style={anchorStyle}>
      {variant !== 'sheet' && announcer}
      <button type="button" className="stats-bar" aria-expanded={open} aria-controls="stats-details" onClick={toggle}
        title={open ? t('stats.hide') : t('stats.show')}>
        {status(true)}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>
      {open && details}
      {shownRouting && <RoutingPanel decision={shownRouting} onOpenChange={onRoutingOpenChange} />}
    </section>
  );
}
