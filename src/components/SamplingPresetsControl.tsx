import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../api';
import { useT } from '../i18n';

// Issue #194: a single deployment-wide toggle for "Automatic sampling presets", default on.
// Selection and precedence live server-side (sampling-presets.cjs); this only flips the
// switch. Lives beside Thinking in the model settings UI (ModelsSettings.tsx) because both are
// per-deployment generation defaults an administrator sets once.
type Settings = { enabled: boolean; admin: boolean };

export function SamplingPresetsControl(): JSX.Element | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const t = useT();
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
      if (!response.ok) throw Error((await response.json()).error || t('mm.sampling.saveFailed'));
      setSettings({ ...settings, enabled });
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };
  return <span className="reasoning-control">
    <label className="mm-check">
      <input type="checkbox" aria-label={t('mm.sampling.label')} checked={settings.enabled}
        disabled={saving || !settings.admin} onChange={e => void save(e.target.checked)}/>
      {t('mm.sampling.label')}
    </label>
    <small>{t('mm.sampling.help')}</small>
    {error && <span role="alert">{error}</span>}
  </span>;
}
