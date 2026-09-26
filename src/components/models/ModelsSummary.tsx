import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { HealthState, InstalledModel, LiveStats } from '../../types';
import type { AutoRoles } from '../../api';
import { fetchAutoRoles } from '../../api';
import { notifyModelsChanged, useModelsChanged } from '../../models-changed';
import { installedSummary } from '../../models-summary';
import { useT } from '../../i18n';

/** Settings keeps only what answers "is the engine fine and where does Auto go";
 *  everything you act on lives in the model manager page. */
export function ModelsSummary({ models, modelsError, health, stats, onOpen }: { models: InstalledModel[]; modelsError: string | null; health: HealthState; stats: LiveStats | null; onOpen: () => void }): JSX.Element {
  const t = useT();
  const [roles, setRoles] = useState<{ configured: boolean; roles: AutoRoles | null } | null>(null);
  const [rolesError, setRolesError] = useState(false);
  const load = () => { fetchAutoRoles().then((v) => { setRoles(v); setRolesError(false); }).catch(() => setRolesError(true)); };
  useEffect(() => { let live = true; fetchAutoRoles().then((v) => { if (live) setRoles(v); }).catch(() => { if (live) setRolesError(true); }); return () => { live = false; }; }, []);
  // A save on the Routing tab (ModelsSettings.tsx) fires this so the cached card here does not
  // keep showing stale roles until the whole Settings page remounts.
  useModelsChanged(load);
  // `models` is App's list, which only refetches on models-changed. A chat that loads a model
  // on demand used to leave it stale, so this read "none loaded" beside a Loaded card (#205).
  // Opening the summary asks again.
  useEffect(() => { notifyModelsChanged(); }, []);
  const routing = rolesError ? t('models.routingError') : !roles ? t('settings.loading') : roles.configured && roles.roles
    ? `${t('models.roles', { fast: roles.roles.fast, smart: roles.roles.smart })}${roles.roles.vision ? ` · ${t('models.vision', { vision: roles.roles.vision })}` : ''}` : t('models.notConfigured');
  const installed = installedSummary(models, { count: (n) => t.plural('models.count', n), loaded: (names) => t('models.loaded', { names }), noneLoaded: t('models.noneLoaded') });
  return <div className="mm-summary">
    <div className="settings-title"><h1>{t('settings.section.models')}</h1><p>{t('models.intro')}</p></div>
    {modelsError && <p role="alert" className="modal-err">{modelsError}</p>}
    {/* #414: the grouped surface (.set-rows), not a bare .card-list — see noevia.css's
        .set-rows .model-row rules for the row treatment this now shares with Users/Service status. */}
    <div className="set-rows">
      <div className="model-row"><span className={`model-dot${health.inferenceUp ? '' : ' down'}`}/><span className="model-name">{t('models.engine')}</span><span className="model-role">{health.inferenceUp ? t('models.available') : t('models.unavailable')}{stats?.tokensPerSecond != null ? ` · ${t('models.rate', { rate: stats.tokensPerSecond.toFixed(1) })}` : ''}</span></div>
      <div className="model-row"><span className="model-name">{t('models.installed')}</span><span className="model-role">{modelsError ? t('models.notAvailable') : installed}</span></div>
      <div className="model-row"><span className="model-name">{t('models.autoRouting')}</span><span className="model-role">{routing}</span></div>
    </div>
    <button className="modal-btn primary" onClick={onOpen}>{t('models.openManager')}</button>
  </div>;
}
