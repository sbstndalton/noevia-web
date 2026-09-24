import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../api';

// Issue #194: a single deployment-wide toggle for "Automatic sampling presets", default on.
// Selection and precedence live server-side (sampling-presets.cjs); this only flips the
// switch. Lives beside Thinking in the model settings UI (ModelsSettings.tsx) because both are
// per-deployment generation defaults an administrator sets once.
type Settings = { enabled: boolean; admin: boolean };

export function SamplingPresetsControl(): JSX.Element | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let stale = false;
    apiFetch('/api/sampling-settings')
      .then(async r => { if (!r.ok) throw Error('Sampling settings unavailable'); return r.json(); })
      .then(value => { if (!stale && typeof value.enabled === 'boolean') setSettings(value); })
      .catch(() => { if (!stale) setSettings(null); });
    return () => { stale = true; };
  }, []);
  if (!settings) return null;
  const save = async (enabled: boolean) => {
    setSaving(true); setError('');
    try {
      const response = await apiFetch('/api/sampling-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw Error((await response.json()).error || 'Could not save sampling settings');
      setSettings({ ...settings, enabled });
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };
  return <span className="reasoning-control">
    <label className="mm-check">
      <input type="checkbox" aria-label="Automatic sampling presets" checked={settings.enabled}
        disabled={saving || !settings.admin} onChange={e => void save(e.target.checked)}/>
      Automatic sampling presets
    </label>
    <small>Chooses temperature, top-p and repeat penalty from the chat's task (coding, creative writing, reasoning, or general) automatically. A chat or project with its own sampling values always keeps them.</small>
    {error && <span role="alert">{error}</span>}
  </span>;
}
