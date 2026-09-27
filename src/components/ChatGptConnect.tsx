import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { cancelChatGptLogin, disconnectChatGpt, fetchChatGptModels, fetchChatGptStatus, pollChatGptLogin, startChatGptLogin } from '../api';
import type { ChatGptDeviceLogin, ChatGptStatus } from '../types';
import { useT } from '../i18n';

/** Sign in with ChatGPT (#447), shown in Settings → AI providers only while the server's
 *  `chatgptOAuth` feature is on. Device-code sign-in: the person opens OpenAI's page, enters the
 *  code shown here, and this card polls until the server has stored the tokens. Tokens never
 *  reach the browser; the card only ever sees a state and a masked account. */
export function ChatGptConnect({ onChanged }: { onChanged?: () => void }): JSX.Element {
  const t = useT();
  const [status, setStatus] = useState<ChatGptStatus | null>(null);
  const [login, setLogin] = useState<ChatGptDeviceLogin | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const loginRef = useRef<ChatGptDeviceLogin | null>(null);

  const stopPolling = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };
  const loadStatus = async () => {
    try { setStatus(await fetchChatGptStatus()); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : t('providers.chatgpt.loadError')); }
  };
  useEffect(() => { void loadStatus(); return () => { stopPolling(); const l = loginRef.current; if (l) void cancelChatGptLogin(l.loginId).catch(() => undefined); }; }, []);
  useEffect(() => {
    if (status?.state !== 'connected') { setModels([]); return; }
    fetchChatGptModels().then((r) => setModels(r.models)).catch(() => setModels([]));
  }, [status?.state]);

  const poll = (current: ChatGptDeviceLogin, delayMs: number) => {
    stopPolling();
    timer.current = window.setTimeout(async () => {
      try {
        const r = await pollChatGptLogin(current.loginId);
        if (r.state === 'connected') {
          loginRef.current = null; setLogin(null);
          await loadStatus();
          onChanged?.();
          return;
        }
        if (r.state === 'expired') { loginRef.current = null; setLogin(null); setErr(t('providers.chatgpt.expired')); return; }
        poll(current, Math.max(1, r.interval ?? current.interval) * 1000);
      } catch (e) {
        loginRef.current = null; setLogin(null);
        setErr(e instanceof Error ? e.message : t('providers.chatgpt.failed'));
      }
    }, delayMs);
  };

  const start = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const l = await startChatGptLogin();
      loginRef.current = l; setLogin(l);
      poll(l, Math.max(1, l.interval) * 1000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('providers.chatgpt.failed'));
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    stopPolling();
    const l = loginRef.current;
    loginRef.current = null; setLogin(null);
    if (l) await cancelChatGptLogin(l.loginId).catch(() => undefined);
  };
  const disconnect = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await disconnectChatGpt(); await loadStatus(); onChanged?.(); }
    catch (e) { setErr(e instanceof Error ? e.message : t('providers.chatgpt.disconnectError')); }
    finally { setBusy(false); }
  };

  const state = status?.state;
  const account = status?.account;
  return (
    <section className="chatgpt-connect" aria-labelledby="chatgpt-connect-title" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="model-row">
        <div className="model-name-group">
          <span className="model-name" id="chatgpt-connect-title">{t('providers.chatgpt.title')}</span>
          <span className="model-quant">
            {state === 'connected'
              ? t('providers.chatgpt.connectedAs', { account: [account?.email, account?.plan].filter(Boolean).join(' · ') || t('providers.chatgpt.yourAccount') })
              : state === 'reconnect' ? t('providers.chatgpt.reconnectNeeded') : t('providers.chatgpt.notConnected')}
          </span>
        </div>
        <span className="set-badge">{t('providers.chatgpt.external')}</span>
      </div>
      <p className="route-note">{t('providers.chatgpt.egress')} {t('providers.chatgpt.limits')}</p>
      {login ? (
        <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="route-note">{t('providers.chatgpt.step1')} <a href={login.verificationUrl} target="_blank" rel="noopener noreferrer">{login.verificationUrl}</a></p>
          <p className="route-note">{t('providers.chatgpt.step2')} <strong className="model-name" style={{ fontFamily: 'var(--font-mono)' }} aria-label={t('providers.chatgpt.codeLabel')}>{login.userCode}</strong></p>
          <p className="route-note">{t('providers.chatgpt.codexNotice')}</p>
          <p className="route-note">{t('providers.chatgpt.waiting')}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="modal-btn secondary" onClick={() => void cancel()}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {state !== 'connected' && (
            <button type="button" className="modal-btn primary" disabled={busy || !status} onClick={() => void start()}>
              {busy ? t('providers.chatgpt.starting') : state === 'reconnect' ? t('providers.chatgpt.reconnect') : t('providers.chatgpt.signIn')}
            </button>
          )}
          {(state === 'connected' || state === 'reconnect') && (
            <button type="button" className="modal-btn secondary" disabled={busy} onClick={() => void disconnect()}>{t('providers.chatgpt.disconnect')}</button>
          )}
        </div>
      )}
      {state === 'connected' && models.length > 0 && <p className="route-note">{t('providers.chatgpt.models', { models: models.slice(0, 8).join(', ') })}</p>}
      {err && <p className="modal-err" role="alert">{err}</p>}
    </section>
  );
}
