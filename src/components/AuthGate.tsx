import { lazy, Suspense, useEffect, useState } from 'react';
import type { FormEvent, JSX, ReactNode } from 'react';
import { acceptInvitation, completeRecovery, fetchSession, passkeyLoginOptions, passkeyLoginVerify, passkeyRegistrationOptions, passkeyRegistrationVerify, passwordLogin, probeSession, setupStatus } from '../api';
import { isIpAddressHost } from '../browser-support';
import { safeReturnPath } from '../routes';
import type { AuthUser } from '../api';

// Only first-run and resumed onboarding need the wizard, and only passkey
// actions need WebAuthn, so neither delays the sign-in screen or the app.
const SetupWizard = lazy(() => import('./SetupWizard').then((m) => ({ default: m.SetupWizard })));
const webauthn = () => import('@simplewebauthn/browser');

type Screen = 'checking' | 'wizard' | 'wizard-resume' | 'login' | 'secure' | 'ready';

export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const [onboardingUser, setOnboardingUser] = useState<AuthUser | null>(null);
  const [screen, setScreen] = useState<Screen>('checking');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [diaryEnabled, setDiaryEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invite = new URLSearchParams(window.location.search).get('invite');
  const recovery = new URLSearchParams(window.location.search).get('recovery');

  useEffect(() => {
    // Both requests start together: on a slow link each round trip counts.
    // The session probe stays quiet on 401 — signed out is a normal answer here.
    const session = probeSession();
    setupStatus().then(async (s) => {
      if (!s.configured) { setScreen('wizard'); return; }
      // Resumable onboarding: an authenticated user whom onboarding hasn't
      // marked complete goes back into the wizard instead of an app that may
      // not be usable yet. Pre-wizard/legacy users are onboarded by default.
      const user = await session;
      if (!user) { setScreen('login'); return; }
      setOnboardingUser(user);
      setScreen(user.onboarded === false ? 'wizard-resume' : 'ready');
    }).catch(() => { setError('Could not reach noevia.'); setScreen('login'); });
    const lock = () => setScreen('login');
    window.addEventListener('cowork:unauthorized', lock);
    return () => window.removeEventListener('cowork:unauthorized', lock);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      if (recovery) { await completeRecovery(recovery, password); window.history.replaceState({}, '', '/'); setScreen('login'); setPassword(''); return; }
      if (invite) await acceptInvitation({ token: invite, username, displayName: displayName || username, password, diaryEnabled });
      else await passwordLogin(username, password);
      const session = await fetchSession();
      setOnboardingUser(session.user);
      // Back to the address the sign-in was shown at (#359) — a shared link to a chat opens that
      // chat once signed in. safeReturnPath only ever yields a same-origin path this app makes,
      // and drops the invite token from the address.
      window.history.replaceState({}, '', safeReturnPath(window.location.pathname));
      setScreen(session.user.onboarded === false ? 'wizard-resume' : 'secure');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not continue'); }
    finally { setBusy(false); }
  };

  const usePasskey = async () => {
    if (!username.trim()) { setError('Enter your username first.'); return; }
    setBusy(true); setError(null);
    try {
      const challenge = await passkeyLoginOptions(username);
      const response = await (await webauthn()).startAuthentication({ optionsJSON: challenge.options });
      await passkeyLoginVerify(challenge.challengeToken, response);
      const session = await fetchSession();
      setOnboardingUser(session.user);
      // Back to the address the sign-in was shown at (#359) — a shared link to a chat opens that
      // chat once signed in. safeReturnPath only ever yields a same-origin path this app makes,
      // and drops the invite token from the address.
      window.history.replaceState({}, '', safeReturnPath(window.location.pathname));
      setScreen(session.user.onboarded === false ? 'wizard-resume' : 'ready');
    } catch (e) {
      setError(
        isIpAddressHost(window.location.hostname)
          ? 'Passkeys need a real hostname — they cannot work from a bare IP address like this one. Sign in with your password here, or use your usual domain for passkeys.'
          : e instanceof Error && e.message
            ? e.message
            : 'Passkey sign-in was cancelled or failed.',
      );
    }
    finally { setBusy(false); }
  };

  const addPasskey = async () => {
    setBusy(true); setError(null);
    try {
      const challenge = await passkeyRegistrationOptions();
      const response = await (await webauthn()).startRegistration({ optionsJSON: challenge.options });
      await passkeyRegistrationVerify(challenge.challengeToken, response, 'Primary passkey'); sessionStorage.setItem('cowork-new-account', '1'); setScreen('ready');
    } catch { setError('Passkey setup was cancelled or failed. You can add one later.'); }
    finally { setBusy(false); }
  };

  if (screen === 'ready') return <>{children}</>;
  const opening = <main className="auth-screen"><div className="auth-card"><h1>Opening noevia…</h1></div></main>;
  if (screen === 'checking') return opening;
  if (screen === 'wizard') return <Suspense fallback={opening}><SetupWizard mode="fresh" onFinished={() => setScreen('ready')} /></Suspense>;
  if (screen === 'wizard-resume' && onboardingUser) return <Suspense fallback={opening}><SetupWizard key={onboardingUser.id} mode={onboardingUser.role === 'member' ? 'invited' : 'resume'} initialUser={onboardingUser} onFinished={() => setScreen('ready')} /></Suspense>;
  if (screen === 'secure') return <main className="auth-screen"><section className="auth-card">
    <div className="auth-mark" aria-hidden="true">n</div><h1>Secure your account</h1>
    <p>Passkeys are the recommended way to sign in using your device or security key.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => void addPasskey()}>{busy ? 'Waiting for your device…' : 'Create a passkey'}</button>
    <button type="button" className="modal-btn secondary" disabled={busy} onClick={() => { sessionStorage.setItem('cowork-new-account', '1'); setScreen('ready'); }}>Set up later</button>
  </section></main>;

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div className="auth-mark" aria-hidden="true">n</div>
        <h1>{recovery ? 'Reset your password' : invite ? 'Create your noevia account' : 'Sign in to noevia'}</h1>
        <p>{recovery ? 'Choose a new password. All existing sessions will be signed out.' : 'Use your password or the recommended passkey option.'}</p>
        {!recovery && <><label htmlFor="username">Username</label><input id="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></>}
        {invite && <><label htmlFor="display-name">Display name</label><input id="display-name" autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} /></>}
        <label htmlFor="password">Password</label><input id="password" type="password" minLength={12} maxLength={128} autoComplete={invite ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required />
        {invite && <label className="auth-option"><input type="checkbox" checked={diaryEnabled} onChange={e => setDiaryEnabled(e.target.checked)} /><span><strong>Enable Diary add-on</strong><small>A private journaling app with optional local, Nextcloud, or WebDAV storage. You can enable it later.</small></span></label>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : recovery ? 'Reset password' : invite ? 'Create account' : 'Sign in with password'}</button>
        {!recovery && !invite && <button type="button" className="modal-btn secondary" disabled={busy || !username.trim()} onClick={() => void usePasskey()}>Use a passkey (recommended)</button>}
        <small>Passwords use Argon2id. Passkey private keys never leave your device.</small>
      </form>
    </main>
  );
}
