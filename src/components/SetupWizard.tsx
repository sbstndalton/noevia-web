import { PalettePicker } from './PalettePicker';
import { updateThemeColor } from '../appearance';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import {
  completeOnboarding,
  completeSetup,
  passkeyRegistrationOptions,
  passkeyRegistrationVerify,
  logout,
  updateFeatures,
  setupStatus,
} from '../api';
import type { AuthUser } from '../api';
import { classifyOrigin, isIpAddressHost } from '../browser-support';
import { timezoneEnvSetting } from '../setup-timezone';
import { ProviderForm } from './ProviderForm';
import { StoragePicker } from './StoragePicker';

type Step = 'account' | 'provider' | 'diary' | 'prefs' | 'passkey' | 'done';

const STEP_ORDER: Step[] = ['account', 'provider', 'diary', 'prefs', 'passkey'];

// Same wording the server returns for a rejected origin, so blocking the
// submit client-side reads identically to hitting the server check.
const INVALID_ORIGIN_MESSAGE =
  'use https://, or a private-network address (a LAN IP, a bare LAN hostname, or localhost) over http://';

const STEP_TITLES: Record<Step, string> = {
  account: 'Create the administrator',
  provider: 'Connect an inference provider',
  diary: 'Set up the diary',
  prefs: 'Preferences',
  passkey: 'Secure your account',
  done: 'Setup complete',
};

export interface SetupWizardProps {
  /** Once setup finishes, hand control back (AuthGate proceeds to the app). */
  onFinished: () => void;
  /** Fresh bootstrap, resumed administrator, or member account setup. */
  mode?: 'fresh' | 'resume' | 'invited';
  initialUser?: AuthUser;
}

/** Account choices live on the server; reload restarts the optional steps without
 * overwriting them. Members never see deployment or global model controls. */
export function SetupWizard({ onFinished, mode = 'fresh', initialUser }: SetupWizardProps): JSX.Element {
  const [step, setStep] = useState<Step>(mode === 'fresh' ? 'account' : mode === 'invited' ? 'diary' : 'provider');
  const [accountCreated, setAccountCreated] = useState(mode !== 'fresh');
  const heading = useRef<HTMLHeadingElement>(null);
  const steps = STEP_ORDER.filter(s => s !== 'account' && (mode !== 'invited' || s !== 'provider'));
  const visibleSteps = mode === 'fresh' ? STEP_ORDER : steps;
  const stepNumber = step === 'done' ? visibleSteps.length : visibleSteps.indexOf(step) + 1;
  useEffect(() => { heading.current?.focus(); }, [step]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Account-step fields (fresh deployments only).
  const [setupCode, setSetupCode] = useState('');
  const [origin, setOrigin] = useState(window.location.origin);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [diaryEnabled, setDiaryEnabled] = useState(initialUser?.diaryEnabled ?? false);

  // Prefs-step fields.
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('cowork-theme') === 'light' ? 'light' : 'dark',
  );
  const [autoRouting, setAutoRouting] = useState(() => localStorage.getItem('cowork-default-routing') === 'auto');
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const timezoneSetting = timezoneEnvSetting(timezone);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cowork-theme', theme);
    updateThemeColor();
  }, [theme]);

  useEffect(() => {
    if (mode === 'fresh') void setupStatus()
      .then(s => { if (s.publicOrigin) setOrigin(s.publicOrigin); })
      .catch(() => undefined);
  }, [mode]);

  const saveDiaryChoice = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const saved = await updateFeatures(enabled);
      setDiaryEnabled(saved.diaryEnabled);
    } catch { setError('Could not save your Diary choice. Please retry.'); }
    finally { setBusy(false); }
  };

  const go = useCallback((next: Step) => {
    setError(null);
    setStep(next);
  }, []);

  // Categorized the same way the server's setup() will categorize it, so the
  // wizard never shows a green light for an origin the server then rejects.
  const originClass = classifyOrigin(origin);

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (originClass === 'invalid') {
      setError(INVALID_ORIGIN_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeSetup({
        setupCode,
        publicOrigin: origin,
        username,
        displayName: displayName || username,
        password,
        diaryEnabled,
      });
      // completeSetup issues a session; the rest of the wizard runs as
      // authenticated calls, with the explicitly saved Diary choice.
      setAccountCreated(true);
      setStep('provider');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  };

  const finishPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const challenge = await passkeyRegistrationOptions();
      const response = await startRegistration({ optionsJSON: challenge.options });
      await passkeyRegistrationVerify(challenge.challengeToken, response, 'Primary passkey');
      sessionStorage.setItem('cowork-new-account', '1');
      go('done');
    } catch {
      setError(
        isIpAddressHost(window.location.hostname)
          ? 'Passkeys need a real hostname — they cannot work from a bare IP address like this one. Skip this step and add a passkey later in Settings, once you reach noevia through a domain name.'
          : 'Passkey setup was cancelled or failed. You can add one later in Settings.',
      );
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding();
      sessionStorage.setItem('cowork-new-account', '1');
      onFinished();
    } catch {
      setError('Could not finish setup. Please retry; your settings have been saved.');
    } finally { setBusy(false); }
  };

  const progress = (
    <div className="wizard-progress" aria-label={`Step ${stepNumber} of ${visibleSteps.length}`}>
      {visibleSteps.map((s, i) => (
        <span
          key={s}
          className={`wizard-dot${s === step ? ' active' : ''}${i < stepNumber - 1 ? ' done' : ''}`}
        />
      ))}
      <span className="wizard-step-label">
        {stepNumber} / {visibleSteps.length}
      </span>
    </div>
  );

  return (
    <main className="auth-screen">
      <section className="auth-card wizard-card">
        <div className="auth-mark" aria-hidden="true">n</div>
        <h1 ref={heading} tabIndex={-1}>{STEP_TITLES[step]}</h1>
        {progress}
        {accountCreated && <p>Saved account choices survive reload. Closing or signing out resumes these optional steps next time; finishing setup leaves later changes in Settings.</p>}

        {step === 'account' && (
          <form onSubmit={(e) => void createAccount(e)}>
            <p>Welcome to noevia. This walks through the essentials — every later step can be skipped and finished later in Settings.</p>
            <label htmlFor="wiz-code">One-time setup code</label>
            <input id="wiz-code" type="password" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} required />
            <small>Find it in the container logs (<code>docker compose logs web</code>) — it is printed once at first start.</small>
            <label htmlFor="wiz-origin">Canonical URL of this deployment</label>
            <input id="wiz-origin" value={origin} onChange={(e) => setOrigin(e.target.value)} required />
            {originClass === 'public-https' && (
              <small>Recommended — passkeys and remote access will work here.</small>
            )}
            {originClass === 'loopback' && <small>This machine only — other devices cannot reach it.</small>}
            {originClass === 'private-lan-http' && (
              <p className="auth-error" role="alert">
                This address only works on your local network. Passkeys and some browser security
                features require HTTPS and will not work from a plain IP address — you can still sign
                in with your password. You can point noevia at a real domain later, and{' '}
                <code>ADDITIONAL_TRUSTED_ORIGINS</code>{' '}
                (see README.md) lets you keep this address working alongside it.
              </p>
            )}
            {originClass === 'invalid' && (
              <p className="auth-error" role="alert">{INVALID_ORIGIN_MESSAGE}</p>
            )}
            <label htmlFor="wiz-username">Username</label>
            <input id="wiz-username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <label htmlFor="wiz-display">Display name (optional)</label>
            <input id="wiz-display" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <label htmlFor="wiz-password">Password</label>
            <input id="wiz-password" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <label className="auth-option">
              <input type="checkbox" checked={diaryEnabled} onChange={(e) => setDiaryEnabled(e.target.checked)} />
              <span>
                <strong>Enable the Diary add-on</strong>
                <small>A private journal with optional Nextcloud/WebDAV storage. You can enable it later in Settings.</small>
              </span>
            </label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" disabled={busy || originClass === 'invalid'}>{busy ? 'Creating…' : 'Create account'}</button>
            <small>Passwords use Argon2id. Passkey private keys never leave your device.</small>
          </form>
        )}

        {step === 'provider' && (
          <div>
            <p>Connect a personal OpenAI-compatible provider, or skip to use an available deployment provider. Administrators manage shared providers and local models in Settings.</p>
            <ProviderForm
              autoFocus
              submitLabel="Connect provider"
              cancelLabel="Skip — set up later in Settings"
              onCancel={() => go('diary')}
              onConnected={() => go('diary')}
            />
            {error && <p className="auth-error" role="alert">{error}</p>}
          </div>
        )}

        {step === 'diary' && (
          <div aria-busy={busy}>
            {mode === 'invited' && <p>Your administrator manages shared models. You can use available models after setup, or add an approved personal provider in Settings → Providers.</p>}
            <label className="auth-option">
              <input type="checkbox" checked={diaryEnabled} aria-disabled={busy} onChange={e => void saveDiaryChoice(e.target.checked)} />
              <span><strong>Enable the Diary add-on</strong><small>Saved for your account when changed. Turning it off keeps existing files.</small></span>
            </label>
            <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {diaryEnabled ? (
                <>
                  <p>Where should diary entries live? Server storage keeps them on this server; Nextcloud and WebDAV write to your own cloud. Skipping keeps your current storage configuration.</p>
                  <StoragePicker
                    onSaved={() => go('prefs')}
                    onSkip={() => go('prefs')}
                  />
                </>
              ) : (
                <>
                  <p>The Diary add-on is currently disabled for your account.</p>
                  <button className="modal-btn primary" onClick={() => go('prefs')}>Continue</button>
                </>
              )}
            </fieldset>
            {error && <p className="auth-error" role="alert">{error}</p>}
          </div>
        )}

        {step === 'prefs' && (
          <div>
            <p>Theme and palette changes apply immediately in this browser. Auto routing is saved only when you choose “Use these preferences”. Check your browser timezone below.</p>
            <label className="auth-option">
              <input type="radio" name="wiz-theme" checked={theme === 'light'} onChange={() => setTheme('light')} />
              <span><strong>Light theme</strong></span>
            </label>
            <label className="auth-option">
              <input type="radio" name="wiz-theme" checked={theme === 'dark'} onChange={() => setTheme('dark')} />
              <span><strong>Dark theme</strong></span>
            </label>
            <label className="auth-option">
              <input type="checkbox" checked={autoRouting} onChange={(e) => setAutoRouting(e.target.checked)} />
              <span>
                <strong>Use Auto Fast/Smart routing for new projects</strong>
                <small>Lets noevia pick a lighter or heavier model per message. Choose available models beside the composer’s Send button.</small>
              </span>
            </label>
            <PalettePicker theme={theme}/>
            <label htmlFor="wiz-timezone">Your timezone</label>
            <input
              id="wiz-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              aria-describedby="wiz-timezone-help"
              aria-invalid={!timezoneSetting}
              autoComplete="off"
              spellCheck={false}
            />
            <small id="wiz-timezone-help">
              Detected from your browser; confirm or enter an IANA name such as America/New_York.
              Diary entries use your browser clock. The server fallback timezone is shared by all users.
            </small>
            {timezoneSetting ? (
              <p>
                Give your server administrator this setting for the deployment’s <code>.env</code> file:
                {' '}<code>{timezoneSetting}</code>. Recreate the diary container to apply it.
                This wizard cannot change the container’s timezone.
              </p>
            ) : (
              <p className="auth-error" role="alert">Enter a valid IANA timezone, such as America/New_York or UTC.</p>
            )}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="modal-btn secondary" onClick={() => go('passkey')}>Skip — set up later</button>
              <button className="modal-btn primary" disabled={!timezoneSetting} onClick={() => {
                if (autoRouting) localStorage.setItem('cowork-default-routing', 'auto');
                else localStorage.removeItem('cowork-default-routing');
                go('passkey');
              }}>Use these preferences</button>
            </div>
          </div>
        )}

        {step === 'passkey' && (
          <div>
            <p>Passkeys are the recommended way to sign in using your device or a security key.</p>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="button" disabled={busy} onClick={() => void finishPasskey()}>
              {busy ? 'Waiting for your device…' : 'Create a passkey'}
            </button>
            <button type="button" className="modal-btn secondary" disabled={busy} onClick={() => void finish()}>
              Set up later
            </button>
            <small>You can add or remove passkeys in Settings → Profile and security.</small>
          </div>
        )}

        {accountCreated && step !== 'done' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            {steps.indexOf(step) > 0 && <button type="button" className="modal-btn secondary" disabled={busy}
              onClick={() => go(steps[steps.indexOf(step) - 1])}>Back</button>}
            <button type="button" className="modal-btn secondary" disabled={busy} onClick={() => {
              setBusy(true);
              void logout().then(() => window.location.reload()).catch(() => { setError('Could not sign out. Please retry.'); setBusy(false); });
            }}>Sign out — resume later</button>
          </div>
        )}

        {step === 'done' && (
          <div>
            <p>You're all set. You can finish configuration any time in Settings.</p>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="button" disabled={busy} onClick={() => void finish()}>
              Start using noevia
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
