import { useEffect, useState } from 'react';
import type { FormEvent, JSX, ReactNode } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { acceptInvitation, completeRecovery, completeSetup, fetchSession, passkeyLoginOptions, passkeyLoginVerify, passkeyRegistrationOptions, passkeyRegistrationVerify, passwordLogin, setupStatus } from '../api';

type Screen = 'checking' | 'setup' | 'login' | 'secure' | 'ready';

export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const [screen, setScreen] = useState<Screen>('checking');
  const [setupCode, setSetupCode] = useState('');
  const [origin, setOrigin] = useState(window.location.origin);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [diaryEnabled, setDiaryEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invite = new URLSearchParams(window.location.search).get('invite');
  const recovery = new URLSearchParams(window.location.search).get('recovery');

  useEffect(() => {
    setupStatus().then((s) => {
      if (!s.configured) { setOrigin(s.publicOrigin || window.location.origin); setScreen('setup'); return; }
      fetchSession().then(() => setScreen('ready')).catch(() => setScreen('login'));
    }).catch(() => { setError('Could not reach Cowork.'); setScreen('login'); });
    const lock = () => setScreen('login');
    window.addEventListener('cowork:unauthorized', lock);
    return () => window.removeEventListener('cowork:unauthorized', lock);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      if (recovery) { await completeRecovery(recovery, password); window.history.replaceState({}, '', '/'); setScreen('login'); setPassword(''); return; }
      if (screen === 'setup') await completeSetup({ setupCode, publicOrigin: origin, username, displayName: displayName || username, password, diaryEnabled });
      else if (invite) await acceptInvitation({ token: invite, username, displayName: displayName || username, password, diaryEnabled });
      else await passwordLogin(username, password);
      setScreen('secure');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not continue'); }
    finally { setBusy(false); }
  };

  const usePasskey = async () => {
    if (!username.trim()) { setError('Enter your username first.'); return; }
    setBusy(true); setError(null);
    try {
      const challenge = await passkeyLoginOptions(username);
      const response = await startAuthentication({ optionsJSON: challenge.options });
      await passkeyLoginVerify(challenge.challengeToken, response); setScreen('ready');
    } catch { setError('Passkey sign-in was cancelled or failed.'); }
    finally { setBusy(false); }
  };

  const addPasskey = async () => {
    setBusy(true); setError(null);
    try {
      const challenge = await passkeyRegistrationOptions();
      const response = await startRegistration({ optionsJSON: challenge.options });
      await passkeyRegistrationVerify(challenge.challengeToken, response, 'Primary passkey'); sessionStorage.setItem('cowork-new-account', '1'); setScreen('ready');
    } catch { setError('Passkey setup was cancelled or failed. You can add one later.'); }
    finally { setBusy(false); }
  };

  if (screen === 'ready') return <>{children}</>;
  if (screen === 'checking') return <main className="auth-screen"><div className="auth-card"><h1>Opening Cowork…</h1></div></main>;
  if (screen === 'secure') return <main className="auth-screen"><section className="auth-card">
    <div className="auth-mark" aria-hidden="true">C</div><h1>Secure your account</h1>
    <p>Passkeys are the recommended way to sign in using your device or security key.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => void addPasskey()}>{busy ? 'Waiting for your device…' : 'Create a passkey'}</button>
    <button type="button" className="modal-btn secondary" disabled={busy} onClick={() => { sessionStorage.setItem('cowork-new-account', '1'); setScreen('ready'); }}>Set up later</button>
  </section></main>;

  const isSetup = screen === 'setup';

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div className="auth-mark" aria-hidden="true">C</div>
        <h1>{recovery ? 'Reset your password' : isSetup ? 'Set up Cowork' : invite ? 'Create your Cowork account' : 'Sign in to Cowork'}</h1>
        <p>{recovery ? 'Choose a new password. All existing sessions will be signed out.' : isSetup ? 'Create the first administrator. Find the setup code in the container logs.' : 'Use your password or the recommended passkey option.'}</p>
        {isSetup && <><label htmlFor="setup-code">One-time setup code</label><input id="setup-code" type="password" value={setupCode} onChange={e => setSetupCode(e.target.value)} required />
          <label htmlFor="public-origin">Canonical HTTPS URL</label><input id="public-origin" value={origin} onChange={e => setOrigin(e.target.value)} required /></>}
        {!recovery && <><label htmlFor="username">Username</label><input id="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></>}
        {(isSetup || invite) && <><label htmlFor="display-name">Display name</label><input id="display-name" autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} /></>}
        <label htmlFor="password">Password</label><input id="password" type="password" minLength={12} maxLength={128} autoComplete={isSetup || invite ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required />
        {(isSetup || invite) && <label className="auth-option"><input type="checkbox" checked={diaryEnabled} onChange={e => setDiaryEnabled(e.target.checked)} /><span><strong>Enable Diary add-on</strong><small>A private journaling app with optional local, Nextcloud, or WebDAV storage. You can enable it later.</small></span></label>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : recovery ? 'Reset password' : isSetup || invite ? 'Create account' : 'Sign in with password'}</button>
        {!recovery && !isSetup && !invite && <button type="button" className="modal-btn secondary" disabled={busy || !username.trim()} onClick={() => void usePasskey()}>Use a passkey (recommended)</button>}
        <small>Passwords use Argon2id. Passkey private keys never leave your device.</small>
      </form>
    </main>
  );
}
