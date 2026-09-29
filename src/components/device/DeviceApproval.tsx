// The /device page (#555): where a signed-in person approves a native app's sign-in request.
// It renders instead of the app (main.tsx), inside AuthGate, so a signed-out visitor signs in
// first. The code can arrive in the link (?code=, RFC 8628 verification_uri_complete), but it is
// only ever looked up, never approved, until the person has seen the app's name, when (and, with
// TRUST_PROXY, where) the request came from, the code to compare with the one the app shows, and
// which account it will sign in to: on a shared browser that may not be theirs.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { useT } from '../../i18n';
import { appLocale } from '../../user-preferences';
import { fetchSession, logout } from '../../api';
import type { AuthUser } from '../../api';
import { DeviceApiError, decideDeviceCode, formatCodeInput, lookupDeviceCode } from './device-api';
import type { DeviceRequest } from './device-api';

type Step = { kind: 'enter' } | { kind: 'confirm'; request: DeviceRequest } | { kind: 'done'; approved: boolean; clientName: string };

export default function DeviceApproval({ initialCode = '' }: { initialCode?: string }): JSX.Element {
  const t = useT();
  const [code, setCode] = useState(() => formatCodeInput(initialCode));
  const [step, setStep] = useState<Step>({ kind: 'enter' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const [account, setAccount] = useState<AuthUser | null>(null);

  // The account the approval would sign the app in to (review follow-up: shared browsers).
  useEffect(() => {
    let live = true;
    fetchSession().then((s) => { if (live) setAccount(s.user); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // Sign out and come back to this page with the same code, to approve as someone else.
  const switchAccount = async () => {
    setBusy(true);
    try { await logout(); } catch { /* signed out already, or unreachable: the reload shows which */ }
    window.location.assign(`/device${code ? `?code=${encodeURIComponent(code)}` : ''}`);
  };

  // Each step change moves focus to its heading, so a screen reader announces the new question.
  useEffect(() => { if (step.kind !== 'enter') heading.current?.focus(); }, [step.kind]);

  const explain = (e: unknown): string => {
    const status = e instanceof DeviceApiError ? e.status : 0;
    if (status === 404 || status === 400) return t('device.invalid');
    if (status === 429) return t('device.tooMany');
    return t('device.failed');
  };

  const look = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { setStep({ kind: 'confirm', request: await lookupDeviceCode(code) }); }
    catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  };

  const decide = async (approve: boolean) => {
    if (step.kind !== 'confirm' || busy) return;
    setBusy(true); setError('');
    try {
      const result = await decideDeviceCode(step.request.userCode, approve);
      setStep({ kind: 'done', approved: result.approved, clientName: result.clientName });
    } catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  };

  const errorLine = error ? <p className="auth-error" role="alert">{error}</p> : null;

  if (step.kind === 'done') {
    return <main className="auth-screen"><section className="auth-card device-card" aria-labelledby="device-heading">
      <div className="auth-mark" aria-hidden="true">n</div>
      <h1 id="device-heading" ref={heading} tabIndex={-1}>{step.approved ? t('device.approvedTitle') : t('device.deniedTitle')}</h1>
      <p role="status">{step.approved ? t('device.approved', { client: step.clientName }) : t('device.denied', { client: step.clientName })}</p>
      <a className="modal-btn secondary device-link" href="/">{t('device.openApp')}</a>
    </section></main>;
  }

  if (step.kind === 'confirm') {
    const { request } = step;
    const when = new Date(request.requestedAt).toLocaleString(appLocale());
    return <main className="auth-screen"><section className="auth-card device-card" aria-labelledby="device-heading">
      <div className="auth-mark" aria-hidden="true">n</div>
      <h1 id="device-heading" ref={heading} tabIndex={-1}>{t('device.confirmTitle', { client: request.clientName })}</h1>
      <p>{t('device.compare')}</p>
      <output className="device-code" aria-label={t('device.codeLabel')}>{request.userCode}</output>
      <p>{request.ip ? t('device.requested', { ip: request.ip, time: when }) : t('device.requestedAt', { time: when })}</p>
      {account && <p className="device-account">{t('device.approvingAs', { name: account.displayName, username: account.username })}</p>}
      <p className="device-warning">{t('device.warning')}</p>
      {errorLine}
      <button type="button" disabled={busy} onClick={() => void decide(true)}>{busy ? t('device.working') : t('device.approve', { client: request.clientName })}</button>
      <button type="button" className="modal-btn secondary" disabled={busy} onClick={() => void decide(false)}>{t('device.deny')}</button>
      {account && <button type="button" className="device-switch" disabled={busy} onClick={() => void switchAccount()}>{t('device.switchAccount')}</button>}
    </section></main>;
  }

  return <main className="auth-screen">
    <form className="auth-card device-card" aria-labelledby="device-heading" onSubmit={(event) => void look(event)}>
      <div className="auth-mark" aria-hidden="true">n</div>
      <h1 id="device-heading" ref={heading} tabIndex={-1}>{t('device.title')}</h1>
      <p>{t('device.intro')}</p>
      <label htmlFor="device-code">{t('device.codeLabel')}</label>
      <input id="device-code" className="device-code-input" value={code} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false}
        inputMode="text" placeholder="BCDF-GHJK" onChange={(e) => setCode(formatCodeInput(e.target.value))} required />
      {errorLine}
      <button type="submit" disabled={busy || code.replace('-', '').length !== 8}>{busy ? t('device.working') : t('device.continue')}</button>
    </form>
  </main>;
}
