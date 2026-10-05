import { lazy, Suspense, useEffect, useState } from 'react';
import type { FormEvent, JSX, ReactNode } from 'react';
import { acceptInvitation, completeRecovery, fetchSession, passkeyLoginOptions, passkeyLoginVerify, passkeyRegistrationOptions, passkeyRegistrationVerify, passwordLogin, probeSession, setupStatus } from '../api';
import { isIpAddressHost } from '../browser-support';
import { safeReturnPath } from '../routes';
import type { AuthUser } from '../api';
import { checkApiCompatibility } from '../api-contract';
import { claimDeviceState } from '../account-device-state';

// Only first-run and resumed onboarding need the wizard, and only passkey
// actions need WebAuthn, so neither delays the sign-in screen or the app.
const SetupWizard = lazy(() => import('./SetupWizard').then((m) => ({ default: m.SetupWizard })));
const webauthn = () => import('@simplewebauthn/browser');

type Screen = 'checking' | 'incompatible' | 'wizard' | 'wizard-resume' | 'login' | 'secure' | 'ready';

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
    let active = true;
    let blocked = false;
    void (async () => {
      // Check before session/setup calls so a newly deployed browser bundle
      // never starts authenticated work against an incompatible core.
      const compatibility = await checkApiCompatibility();
      if (!active || blocked) return;
      if (compatibility === 'mismatch') { blocked = true; setScreen('incompatible'); return; }
      // These can run together once the API major is known or reachability is
      // uncertain; the existing connection error path handles offline startup.
      const session = probeSession();
      try {
        const s = await setupStatus();
        if (!active || blocked) return;
        if (!s.configured) { setScreen('wizard'); return; }
        const user = await session;
        if (!active || blocked) return;
        if (!user) { setScreen('login'); return; }
        claimDeviceState(user.id);
        setOnboardingUser(user);
        setScreen(user.onboarded === false ? 'wizard-resume' : 'ready');
      } catch {
        if (active && !blocked) { setError('Could not reach noevia.'); setScreen('login'); }
      }
    })();
    const lock = () => { if (!blocked) setScreen('login'); };
    const incompatible = () => { blocked = true; setScreen('incompatible'); };
    window.addEventListener('cowork:unauthorized', lock);
    window.addEventListener('noevia:api-mismatch', incompatible);
    return () => {
      active = false;
      window.removeEventListener('cowork:unauthorized', lock);
      window.removeEventListener('noevia:api-mismatch', incompatible);
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      if (recovery) { await completeRecovery(recovery, password); window.history.replaceState({}, '', '/'); setScreen('login'); setPassword(''); return; }
      if (invite) await acceptInvitation({ token: invite, username, displayName: displayName || username, password, diaryEnabled });
      else await passwordLogin(username, password);
      const session = await fetchSession();
      // #791: another account's drafts and last chat go before the app renders for this one.
      claimDeviceState(session.user.id);
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
      // #791: another account's drafts and last chat go before the app renders for this one.
      claimDeviceState(session.user.id);
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
  if (screen === 'incompatible') return <main className="auth-screen"><section className="auth-card" role="alert">
    <div className="auth-mark" aria-hidden="true">n</div><h1>Update required</h1>
    <p>This noevia app and server use different API versions. Reload the page to get the current app.</p>
    <button type="button" onClick={() => window.location.reload()}>Reload page</button>
  </section></main>;
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
