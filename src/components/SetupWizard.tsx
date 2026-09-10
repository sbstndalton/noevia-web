import { PalettePicker } from './PalettePicker';
import { updateThemeColor } from '../appearance';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import {
  completeOnboarding,
  completeSetup,
  fetchProviders,
  passkeyRegistrationOptions,
  passkeyRegistrationVerify,
  probeSession,
  setupStatus,
} from '../api';
import { classifyOrigin, isIpAddressHost } from '../browser-support';
import { timezoneEnvSetting } from '../setup-timezone';
import { ProviderForm } from './ProviderForm';
import { StoragePicker } from './StoragePicker';

type Step = 'account' | 'provider' | 'diary' | 'models' | 'prefs' | 'passkey' | 'done';

const STEP_ORDER: Step[] = ['account', 'provider', 'diary', 'models', 'prefs', 'passkey'];

// Same wording the server returns for a rejected origin, so blocking the
// submit client-side reads identically to hitting the server check.
const INVALID_ORIGIN_MESSAGE =
  'use https://, or a private-network address (a LAN IP, a bare LAN hostname, or localhost) over http://';

const STEP_TITLES: Record<Step, string> = {
  account: 'Create the administrator',
  provider: 'Connect an inference provider',
  diary: 'Set up the diary',
  models: 'Local model manager',
  prefs: 'Preferences',
  passkey: 'Secure your account',
  done: 'Setup complete',
};

function stepNumber(step: Step): number {
  return STEP_ORDER.indexOf(step) + 1;
}

/** True when the server has at least one configured provider (default or user-added). */
async function hasAnyProvider(): Promise<boolean> {
  try {
    const { providers } = await fetchProviders();
    return (providers || []).length > 0;
  } catch {
    return false;
  }
}

export interface SetupWizardProps {
  /** Once setup finishes, hand control back (AuthGate proceeds to the app). */
  onFinished: () => void;
  /** 'fresh' = first-run setup (start at account creation); 'resume' = an
   *  authenticated admin with no provider yet (start past the account step). */
  mode?: 'fresh' | 'resume';
}

/** First-run setup wizard: a Nextcloud-style, one-question-at-a-time flow that
 *  replaces the old flat setup form. Step 1 (admin account) is mandatory; every
 *  later step offers an explicit skip — never a silently-applied default. The
 *  wizard is resumable: it also runs for an authenticated admin who has no
 *  provider configured yet, so a browser closed mid-setup isn't stranded. */
export function SetupWizard({ onFinished, mode = 'fresh' }: SetupWizardProps): JSX.Element {
  // 'account' covers both brand-new setup and a resumable session (later steps
  // only). `setupCode` etc. are only needed on a truly fresh deployment.
  const [step, setStep] = useState<Step>(mode === 'resume' ? 'provider' : 'account');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Account-step fields (fresh deployments only).
  const [setupCode, setSetupCode] = useState('');
  const [origin, setOrigin] = useState(window.location.origin);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [diaryEnabled, setDiaryEnabled] = useState(false);

  // Prefs-step fields.
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('cowork-theme') === 'light' ? 'light' : 'dark',
  );
  const [autoRouting, setAutoRouting] = useState(false);
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const timezoneSetting = timezoneEnvSetting(timezone);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cowork-theme', theme);
    updateThemeColor();
  }, [theme]);

  // Resumability: if a session already exists, skip straight past account
  // creation (and the diary toggle is then read from the profile, not asked).
  // On a fresh deployment, prefill the canonical URL from setup status.
  useEffect(() => {
    probeSession()
      .then(async (user) => {
        if (!user) {
          // No session → fresh setup. Prefill the origin the server advertises.
          setupStatus()
            .then((s) => { if (s.publicOrigin) setOrigin(s.publicOrigin); })
            .catch(() => undefined);
          return;
        }
        setDiaryEnabled(user.diaryEnabled);
        if (await hasAnyProvider()) setStep((cur) => (cur === 'account' ? 'diary' : cur));
        else setStep((cur) => (cur === 'account' ? 'provider' : cur));
      })
      .catch(() => undefined);
  }, []);

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
      // authenticated calls. A fresh account has no provider yet, so the
      // provider step is always next; the diary step itself no-ops (with an
      // explanatory notice) when the user left the add-on disabled.
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
      if (autoRouting) localStorage.setItem('cowork-default-routing', 'auto');
      else localStorage.removeItem('cowork-default-routing');
      sessionStorage.setItem('cowork-new-account', '1');
      onFinished();
    } catch {
      setError('Could not finish setup. Please retry; your settings have been saved.');
    } finally { setBusy(false); }
  };

  const progress = (
    <div className="wizard-progress" aria-label={`Step ${stepNumber(step)} of ${STEP_ORDER.length}`}>
      {STEP_ORDER.map((s, i) => (
        <span
          key={s}
          className={`wizard-dot${s === step ? ' active' : ''}${i < stepNumber(step) - 1 ? ' done' : ''}`}
        />
      ))}
      <span className="wizard-step-label">
        {stepNumber(step)} / {STEP_ORDER.length}
      </span>
    </div>
  );

  return (
    <main className="auth-screen">
      <section className="auth-card wizard-card">
        <div className="auth-mark" aria-hidden="true">n</div>
        <h1>{STEP_TITLES[step]}</h1>
        {progress}

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
            <p>noevia needs an OpenAI-compatible chat endpoint to talk to. You can also run everything on a local model server.</p>
            <ProviderForm
              autoFocus
              submitLabel="Connect provider"
              cancelLabel="Skip — set up later in Settings"
              onCancel={() => go(diaryEnabled ? 'diary' : 'models')}
              onConnected={() => go(diaryEnabled ? 'diary' : 'models')}
            />
            {error && <p className="auth-error" role="alert">{error}</p>}
          </div>
        )}

        {step === 'diary' && (
          <div>
            {diaryEnabled ? (
              <>
                <p>Where should diary entries live? Local storage keeps them on this server; Nextcloud and WebDAV write to your own cloud.</p>
                <StoragePicker
                  onSaved={() => go('models')}
                  onSkip={() => go('models')}
                />
              </>
            ) : (
              <>
                <p>The Diary add-on is currently disabled for your account.</p>
                <button className="modal-btn primary" onClick={() => go('models')}>Continue</button>
              </>
            )}
            {error && <p className="auth-error" role="alert">{error}</p>}
          </div>
        )}

        {step === 'models' && (
          <div>
            <p>
              noevia can manage local models through a model server (Lemonade). This is
              configured through the deployment environment, not the app: set{' '}
              <code>MODEL_MANAGER_KIND</code> and <code>MODEL_MANAGER_BASE_URL</code> in
              your <code>.env</code> file, then restart the web container. Nothing to
              choose here — skip unless you have already set those variables.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="modal-btn primary" onClick={() => go('prefs')}>Continue</button>
            </div>
          </div>
        )}

        {step === 'prefs' && (
          <div>
            <p>Choose your preferences and confirm your timezone.</p>
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
                <small>Lets noevia pick a lighter or heavier model per message. Configure the models in the model popup later.</small>
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
              <button className="modal-btn primary" disabled={!timezoneSetting} onClick={() => go('passkey')}>Use these preferences</button>
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
