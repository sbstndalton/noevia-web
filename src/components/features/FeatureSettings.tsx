import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { FEATURES_CHANGED, fetchFeatureSettings, saveFeature } from './api';
import type { FeatureInfo } from './api';
import { DecisionServiceSettings } from './DecisionServiceSettings';

export function FeatureSettings({ experimental = false }: { experimental?: boolean }): JSX.Element {
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
    <div className="settings-title"><h1>{experimental ? 'Experimental' : 'Features'}</h1><p>{experimental ? 'Try alternative application logic for everyone on this server. Each experiment describes the behavior it changes. Turn it off to restore the existing logic. These experiments are not quality-validated.' : "Optional capabilities for everyone on this server. All start off. A feature set by the operator in the deployment configuration can't be changed here."}</p></div>
    {error && <p className="route-note" role="alert">{error}</p>}
    {!features && !error && <p className="preview-footnote">Loading…</p>}
    {experimental && <DecisionServiceSettings onSaved={async () => { setFeatures(await fetchFeatureSettings()); window.dispatchEvent(new Event(FEATURES_CHANGED)); }} />}
    {features && <div className="set-rows feature-settings">{features.filter(f => !!f.experimental === experimental).map(f => <div className="set-row set-row-inline" key={f.name}>
      <div className="set-row-text">
        <span className="set-row-label" id={`feature-${f.name}`}>{f.label}</span>
        <span className="set-row-desc">{f.description}{f.locked ? ` Set by the operator (${f.env}).` : ''}</span>
        <span className="set-row-desc" role="status">{busy === f.name ? 'Saving…' : f.unavailable || (f.experimental ? (f.enabled ? 'On · experimental logic selected' : 'Off · existing logic selected') : '')}</span>
        {f.pendingRestart && <span className="set-row-desc set-row-pending" role="status">Saved. Restart the server to apply this change.</span>}
      </div>
      <div className="set-row-control">
        <input type="checkbox" role="switch" className="noevia-switch" aria-labelledby={`feature-${f.name}`} checked={f.enabled}
          disabled={f.locked || !!busy || (!!f.unavailable && !f.enabled)} onChange={() => toggle(f)}/>
      </div>
    </div>)}</div>}
  </>;
}
