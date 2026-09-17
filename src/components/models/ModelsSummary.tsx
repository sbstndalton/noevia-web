import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { HealthState, InstalledModel, LiveStats } from '../../types';
import type { AutoRoles } from '../../api';
import { fetchAutoRoles } from '../../api';

/** Settings keeps only what answers "is the engine fine and where does Auto go";
 *  everything you act on lives in the model manager page. */
export function ModelsSummary({ models, modelsError, health, stats, onOpen }: { models: InstalledModel[]; modelsError: string | null; health: HealthState; stats: LiveStats | null; onOpen: () => void }): JSX.Element {
  const [roles, setRoles] = useState<{ configured: boolean; roles: AutoRoles | null } | null>(null);
  const [rolesError, setRolesError] = useState(false);
  useEffect(() => { let live = true; fetchAutoRoles().then((v) => { if (live) setRoles(v); }).catch(() => { if (live) setRolesError(true); }); return () => { live = false; }; }, []);
  const loaded = models.filter((m) => m.loaded).map((m) => m.name);
  const routing = rolesError ? 'Could not be read' : !roles ? 'Loading…' : roles.configured && roles.roles
    ? `Fast: ${roles.roles.fast} · Smart: ${roles.roles.smart}${roles.roles.vision ? ` · Vision: ${roles.roles.vision}` : ''}` : 'Not configured';
  return <div className="mm-summary">
    <div className="settings-title"><h1>Models &amp; routing</h1><p>A summary of the engine. Downloads, per-model settings, hardware and benchmarks are in the model manager.</p></div>
    {modelsError && <p role="alert" className="modal-err">{modelsError}</p>}
    <div className="card-list">
      <div className="model-row"><span className={`model-dot${health.inferenceUp ? '' : ' down'}`}/><span className="model-name">Engine</span><span className="model-role">{health.inferenceUp ? 'available' : 'unavailable'}{stats?.tokensPerSecond != null ? ` · ${stats.tokensPerSecond.toFixed(1)} tok/s last reported` : ''}</span></div>
      <div className="model-row"><span className="model-name">Installed</span><span className="model-role">{modelsError ? '—' : `${models.length} ${models.length === 1 ? 'model' : 'models'}`}{loaded.length ? ` · loaded: ${loaded.join(', ')}` : ' · none loaded'}</span></div>
      <div className="model-row"><span className="model-name">Auto routing</span><span className="model-role">{routing}</span></div>
    </div>
    <button className="modal-btn primary" onClick={onOpen}>Open model manager</button>
  </div>;
}
