import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, JSX, ReactNode } from 'react';
import { apiFetch, getStoredAuthToken, setStoredAuthToken } from '../api';

export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState(getStoredAuthToken);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const response = await apiFetch('/api/workspace');
      if (response.ok) {
        setUnlocked(true);
        return;
      }
      if (response.status === 401 && getStoredAuthToken()) setError('That access token was not accepted.');
      else if (response.status !== 401) setError(`Cowork is unavailable (${response.status}).`);
    } catch {
      setError('Could not reach the Cowork server.');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const lock = () => setUnlocked(false);
    window.addEventListener('cowork:unauthorized', lock);
    void verify();
    return () => window.removeEventListener('cowork:unauthorized', lock);
  }, [verify]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStoredAuthToken(token);
    await verify();
  };

  if (unlocked) return <>{children}</>;

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div className="auth-mark" aria-hidden="true">C</div>
        <h1>Unlock Cowork</h1>
        <p>Enter the same access token configured for this Cowork server.</p>
        <label htmlFor="cowork-token">Access token</label>
        <input
          id="cowork-token"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoFocus
        />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" disabled={checking || !token.trim()}>
          {checking ? 'Checking…' : 'Unlock'}
        </button>
        <small>The token stays in this browser and is sent only to this server.</small>
      </form>
    </main>
  );
}
