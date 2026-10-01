import { useEffect, useRef, useState, type JSX } from 'react';
import { apiFetch } from '../api';
import { useT } from '../i18n';

type Sharing = { available: boolean; scope: 'off' | 'lan' | 'public'; endpointScope?: 'lan' | 'public'; cleartext: boolean; url: string; eligible: boolean };
type Result = { url: string; username: string; password: string };
type FieldKey = 'url' | 'username' | 'password';

/** Read-only value that wraps and grows to show all of it (a long address or password must never be cut off at
 *  375 px). A textarea keeps select-all and copy working like the input it replaces. */
function AutoText({ value, label }: { value: string; label: string }): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } };
  useEffect(() => { fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit); }, [value]);
  return <textarea ref={ref} aria-label={label} className="modal-input connect-device-value" rows={1} value={value} readOnly autoComplete="off" spellCheck={false} onFocus={e => e.currentTarget.select()} />;
}

/** #733: one panel for the whole device setup. It reuses the two existing endpoints, so every server-side check
 *  (eligibility, operator scope, cleartext acknowledgement, credential scope) still runs exactly as it does from the
 *  separate pages: PUT /api/profile/sharing turns sharing on at the operator's endpoint scope, then
 *  POST /api/profile/app-passwords mints a password of that same scope. The password lives only in this component's
 *  state and is dropped when the panel closes. */
export default function ConnectDevice({ onClose, onSharingChange }: { onClose: () => void; onSharingChange: () => void }): JSX.Element {
  const t = useT();
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [name, setName] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState<FieldKey | 'failed' | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const load = async (): Promise<Sharing> => {
    const r = await apiFetch('/api/profile/sharing');
    if (!r.ok) throw Error(t('sharing.loadError'));
    const v = await r.json() as Sharing;
    setSharing(v);
    return v;
  };
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : t('sharing.loadError'))); }, []);
  useEffect(() => { if (sharing) nameRef.current?.focus(); }, [!!sharing]);
  useEffect(() => { if (result) panelRef.current?.focus(); }, [!!result]);

  const scope = sharing?.endpointScope;
  const ready = !!sharing && sharing.available && sharing.eligible && !!scope;
  const enabling = !!sharing && !!scope && sharing.scope !== scope;
  const needsAck = enabling && !!sharing?.cleartext;

  const connect = async () => {
    if (!sharing || !scope) return;
    setBusy(true); setError('');
    try {
      let current = sharing;
      if (current.scope !== scope) {
        const r = await apiFetch('/api/profile/sharing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, acknowledgeCleartext: ack }) });
        const v = await r.json().catch(() => ({})) as Sharing & { error?: string };
        if (!r.ok) throw Error(v.error || t('sharing.saveError'));
        current = v; setSharing(v); onSharingChange();
      }
      const r = await apiFetch('/api/profile/app-passwords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), scope }) });
      const made = await r.json().catch(() => ({})) as { password?: string; error?: string };
      if (!r.ok || !made.password) throw Error(made.error || t('appPasswords.createError'));
      const p = await apiFetch('/api/profile');
      const profile = p.ok ? await p.json().catch(() => null) as { user?: { username?: string } } | null : null;
      // Never leave the username blank: the address path ends in the encoded username.
      let username = profile?.user?.username ?? '';
      if (!username) { try { username = decodeURIComponent(current.url.replace(/\/+$/, '').split('/').pop() ?? ''); } catch { username = ''; } }
      setResult({ url: current.url, username, password: made.password });
      setName(''); setAck(false);
    } catch (e) { setError(e instanceof Error ? e.message : t('appPasswords.createError')); }
    finally { setBusy(false); }
  };

  const copy = async (key: FieldKey, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); }
    catch { setCopied('failed'); }
  };

  const row = (key: FieldKey, label: string, value: string) => <div className="connect-device-row">
    <label className="route-note">{label}<AutoText value={value} label={label} /></label>
    <button type="button" className="popup-tab" aria-label={t('connect.copyNamed', { what: label })} onClick={() => void copy(key, value)}>{copied === key ? t('connect.copied') : t('connect.copy')}</button>
  </div>;

  return <section ref={panelRef} tabIndex={-1} className="connect-device" role="region" aria-label={t('connect.title')}
    onKeyDown={e => { if (e.key !== 'Escape') return; e.preventDefault(); if (!result && !busy) onClose(); }}>
    <div className="rail-label">{t('connect.title')}</div>
    {!result && <>
      <p className="route-note">{t('connect.intro')}</p>
      {sharing && !ready && <p className="route-note" role="status">{!sharing.available ? t('sharing.reason.notConfigured') : t('sharing.ineligible')} {t('sharing.staysOff')}</p>}
      {ready && enabling && <p className="route-note">{t('connect.willEnable', { scope: scope === 'lan' ? t('connect.scope.lan') : t('connect.scope.public') })}</p>}
      {ready && needsAck && <div><label className="route-note connect-device-check"><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)} /> {t('sharing.cleartext')}</label></div>}
      <label className="route-note">{t('appPasswords.deviceName')}<input ref={nameRef} className="modal-input" value={name} maxLength={80} disabled={busy || !ready} onChange={e => setName(e.target.value)} placeholder={t('appPasswords.deviceNamePlaceholder')} /></label>
      <div className="connect-device-actions">
        <button type="button" className="modal-btn secondary" disabled={busy || !ready || !name.trim() || (needsAck && !ack)} onClick={() => void connect()}>{busy ? t('connect.working') : t('connect.submit')}</button>
        <button type="button" className="popup-tab" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </>}
    {result && <div>
      <p className="route-note" role="status">{t('connect.onceNote')}</p>
      {row('url', t('connect.address'), result.url)}
      {row('username', t('connect.username'), result.username)}
      {row('password', t('connect.password'), result.password)}
      {copied === 'failed' && <p className="route-note" role="alert">{t('connect.copyFailed')}</p>}
      <div className="rail-label">{t('connect.hintsTitle')}</div>
      <ul className="route-note connect-device-hints">
        <li>{t('connect.hint.mac')}</li>
        <li>{t('connect.hint.windows')}</li>
        <li>{t('connect.hint.ios')}</li>
      </ul>
      <button type="button" className="modal-btn secondary" onClick={onClose}>{t('connect.done')}</button>
    </div>}
    {error && <p className="route-note" role="alert">{error}</p>}
  </section>;
}
