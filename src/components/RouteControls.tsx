// #778 routing modes: the chat-side pieces. A small local/cloud badge on each routed reply (the
// reason on hover), the "This looks sensitive" card that holds a turn until the person answers,
// and the per-chat Force local toggle. All visible and changeable in the chat.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useT } from '../i18n';
import type { RouteFlag, RouteReason, RouteTarget } from '../types';

const REASON_KEY: Record<RouteReason, 'chat.routing.reason.mode' | 'chat.routing.reason.userChoice' | 'chat.routing.reason.forceLocal' | 'chat.routing.reason.sensitiveRule' | 'chat.routing.reason.failClosed' | 'chat.routing.reason.remembered'> = {
  mode: 'chat.routing.reason.mode',
  'user-choice': 'chat.routing.reason.userChoice',
  'force-local': 'chat.routing.reason.forceLocal',
  'sensitive-rule': 'chat.routing.reason.sensitiveRule',
  'fail-closed': 'chat.routing.reason.failClosed',
  remembered: 'chat.routing.reason.remembered',
};

const FLAG_KEY: Record<RouteFlag, 'chat.routing.flag.diary' | 'chat.routing.flag.secret' | 'chat.routing.flag.iban' | 'chat.routing.flag.card' | 'chat.routing.flag.router' | 'chat.routing.flag.unavailable'> = {
  diary: 'chat.routing.flag.diary',
  secret: 'chat.routing.flag.secret',
  iban: 'chat.routing.flag.iban',
  card: 'chat.routing.flag.card',
  router: 'chat.routing.flag.router',
  unavailable: 'chat.routing.flag.unavailable',
};

export function isRouteTarget(v: unknown): v is RouteTarget {
  const o = v as RouteTarget | null;
  return !!o && (o.route === 'local' || o.route === 'cloud') && typeof o.reason === 'string' && o.reason in REASON_KEY;
}

export function RouteBadge({ target }: { target: RouteTarget }): JSX.Element {
  const t = useT();
  const route = target.route === 'cloud' ? t('chat.routing.cloud') : t('chat.routing.local');
  const label = t('chat.routing.badgeLabel', { route, reason: t(REASON_KEY[target.reason]) });
  return <small className="route-badge" data-route={target.route} data-reason={target.reason} data-testid="route-badge" title={label} aria-label={label}>{route}</small>;
}

export function RoutePendingCard({ flag, busy, onDecide }: { flag: RouteFlag; busy?: boolean; onDecide: (choice: 'cloud' | 'local', remember: boolean) => void }): JSX.Element {
  const t = useT();
  const [remember, setRemember] = useState(false);
  return (
    <div className="route-pending" role="group" aria-label={t('chat.routing.pending', { reason: t(FLAG_KEY[flag] ?? FLAG_KEY.unavailable) })} data-testid="route-pending">
      <p>{t('chat.routing.pending', { reason: t(FLAG_KEY[flag] ?? FLAG_KEY.unavailable) })}</p>
      <div className="route-pending-actions">
        <button className="modal-btn secondary" disabled={busy} onClick={() => onDecide('cloud', remember)}>{t('chat.routing.sendCloud')}</button>
        <button className="modal-btn primary" disabled={busy} onClick={() => onDecide('local', remember)}>{t('chat.routing.keepLocal')}</button>
        <label className="route-remember"><input type="checkbox" checked={remember} disabled={busy} onChange={(e) => setRemember(e.target.checked)} /> {t('chat.routing.remember')}</label>
      </div>
    </div>
  );
}

export function ForceLocalToggle({ forceLocal, allowCloud, onChange }: { forceLocal: boolean; allowCloud: boolean; onChange: (patch: { forceLocal?: boolean; allowCloud?: boolean }) => void }): JSX.Element {
  const t = useT();
  // Shown at once; the stored meta catches up when the list save returns (and wins if it differs).
  const [on, setOn] = useState(forceLocal);
  const [cloudOk, setCloudOk] = useState(allowCloud);
  useEffect(() => { setOn(forceLocal); }, [forceLocal]);
  useEffect(() => { setCloudOk(allowCloud); }, [allowCloud]);
  return (
    <span className="route-chat-controls">
      <label className="route-force-local" title={t('chat.routing.forceLocalHint')}>
        <input type="checkbox" role="switch" aria-checked={on} checked={on} data-testid="force-local"
          onChange={(e) => { const next = e.target.checked; setOn(next); if (next) setCloudOk(false); onChange(next ? { forceLocal: true, allowCloud: false } : { forceLocal: false }); }} />
        {t('chat.routing.forceLocal')}
      </label>
      {cloudOk && !on && (
        <span className="route-allow-cloud">{t('chat.routing.cloudAllowed')} <button className="link-button" onClick={() => { setCloudOk(false); onChange({ allowCloud: false }); }}>{t('chat.routing.askAgain')}</button></span>
      )}
    </span>
  );
}
