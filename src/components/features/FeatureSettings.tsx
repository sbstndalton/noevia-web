import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { FEATURES_CHANGED, fetchFeatureSettings, saveFeature } from './api';
import type { FeatureInfo } from './api';
import { DecisionServiceSettings } from './DecisionServiceSettings';
import { useT } from '../../i18n';
import type { MessageKey, Translate } from '../../i18n';

/** The catalogue's text for a server-supplied id, or the server's English when this build has none (#618). */
const byId = (t: Translate, key: string, fallback: string): string => { const text = t(key as MessageKey); return text === key ? fallback : text; };

export function FeatureSettings({ experimental = false }: { experimental?: boolean }): JSX.Element {
  const t = useT();
  const [features, setFeatures] = useState<FeatureInfo[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let live = true;
    fetchFeatureSettings().then(f => { if (live) setFeatures(f); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const toggle = async (feature: FeatureInfo) => {
    setBusy(feature.name); setError('');
    try {
      const saved = await saveFeature(feature.name, !feature.enabled);
      setFeatures(list => list?.map(f => f.name === saved.name ? saved : f) || null);
      window.dispatchEvent(new Event(FEATURES_CHANGED));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };

  return <>
    <div className="settings-title"><h1>{experimental ? t('settings.section.experimental') : t('settings.section.features')}</h1><p>{experimental ? t('features.experimentalIntro') : t('features.intro')}</p></div>
    {error && <p className="route-note" role="alert">{error}</p>}
    {!features && !error && <p className="preview-footnote">{t('admin.loading')}</p>}
    {experimental && <DecisionServiceSettings onSaved={async () => { setFeatures(await fetchFeatureSettings()); window.dispatchEvent(new Event(FEATURES_CHANGED)); }} />}
    {features && <div className="set-rows feature-settings">{features.filter(f => !!f.experimental === experimental).map(f => {
      const id = f.id ?? f.name;
      const unavailable = f.unavailable ? (f.unavailableId ? byId(t, `features.unavailable.${f.unavailableId}`, f.unavailable) : f.unavailable) : f.unavailable;
      return <div className="set-row set-row-inline" key={f.name}>
      <div className="set-row-text">
        <span className="set-row-label" id={`feature-${f.name}`}>{byId(t, `features.item.${id}.label`, f.label)}</span>
        <span className="set-row-desc">{byId(t, `features.item.${id}.description`, f.description)}{f.locked ? ` ${t('features.lockedBy', { env: f.env })}` : ''}</span>
        <span className="set-row-desc" role="status">{busy === f.name ? t('common.saving') : unavailable || (f.experimental ? (f.enabled ? t('features.experimentalOn') : t('features.experimentalOff')) : '')}</span>
        {f.pendingRestart && <span className="set-row-desc set-row-pending" role="status">{t('features.pendingRestart')}</span>}
      </div>
      <div className="set-row-control">
        <input type="checkbox" role="switch" className="noevia-switch" aria-labelledby={`feature-${f.name}`} checked={f.enabled}
          disabled={f.locked || !!busy || (!!f.unavailable && !f.enabled)} onChange={() => toggle(f)}/>
      </div>
    </div>;
    })}</div>}
  </>;
}
