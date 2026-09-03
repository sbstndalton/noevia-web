import type { JSX } from 'react';
import type { HealthState, InstalledModel, LiveStats, Project, RouteRule } from '../types';

interface SettingsViewProps {
  models: InstalledModel[];
  routes: RouteRule[];
  modelsError: string | null;
  projects: Project[];
  health: HealthState;
  stats: LiveStats | null;
  onOpenModels: () => void;
}

export function SettingsView({
  models,
  routes,
  modelsError,
  projects,
  health,
  stats,
  onOpenModels,
}: SettingsViewProps): JSX.Element {
  return (
    <div className="main">
      <div className="settings-scroll">
        <div className="settings-head">
          <h1>Settings</h1>
          <p>
            The proxy routes each project to its model directly on Lemonade —
            instructions, files, and memories are applied per project, server-side.
          </p>
        </div>

        <div className="settings-body">
          <div>
            <div className="rail-label" style={{ marginBottom: 12 }}>Connected services</div>
            <div className="card-list">
              <div className="model-row">
                <span className={`model-dot${health.lemonadeUp ? '' : ' down'}`} />
                <div className="model-name-group">
                  <span className="model-name">Lemonade</span>
                  <span className="model-quant">models · inference · downloads</span>
                </div>
                <span className="model-role">
                  {health.lemonadeUp ? 'online' : health.lemonadeUp === false ? 'unreachable' : 'checking…'}
                </span>
              </div>
              <div className="model-row">
                <span className={`model-dot${health.diaryUp ? '' : ' down'}`} />
                <div className="model-name-group">
                  <span className="model-name">Diary sidecar</span>
                  <span className="model-quant">pipeline · Nextcloud corpus</span>
                </div>
                <span className="model-role">
                  {health.diaryUp ? 'online' : health.diaryUp === false ? 'unreachable' : 'checking…'}
                </span>
              </div>
            </div>
          </div>

          <div>
            <div className="rail-label" style={{ marginBottom: 12 }}>Live engine stats</div>
            <div className="card-list">
              <div className="model-row">
                <span className={`model-dot${stats?.up ? '' : ' down'}`} />
                <div className="model-name-group">
                  <span className="model-name">
                    {stats?.tokensPerSecond != null ? `${stats.tokensPerSecond.toFixed(1)} tok/s` : '— tok/s'}
                  </span>
                  <span className="model-quant">
                    {stats?.timeToFirstToken != null ? `TTFT ${stats.timeToFirstToken.toFixed(2)}s · ` : ''}
                    {stats?.requestCount != null ? `${stats.requestCount} requests · ` : ''}
                    {stats?.vramGb != null ? `${stats.vramGb.toFixed(1)} GB VRAM` : ''}
                  </span>
                </div>
                <span className="model-role">{stats?.up ? 'live' : 'unavailable'}</span>
              </div>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="rail-label" style={{ marginBottom: 0 }}>Models</span>
              <button className="popup-tab" style={{ border: '1px solid var(--border)' }} onClick={onOpenModels}>
                open model manager
              </button>
            </div>
            <div className="card-list">
              {modelsError && (
                <div className="model-row">
                  <span className="model-dot down" />
                  <div className="model-name-group">
                    <span className="model-name" style={{ color: 'var(--accent)' }}>{modelsError}</span>
                  </div>
                </div>
              )}
              {models.map((m) => (
                <div key={m.name} className="model-row">
                  <span className={`model-dot${m.loaded ? '' : ' down'}`} title={m.loaded ? 'loaded' : 'not loaded'} />
                  <div className="model-name-group">
                    <span className="model-name">{m.name}</span>
                    <span className="model-quant">
                      {m.sizeGB != null ? `${m.sizeGB} GB` : ''}
                      {m.maxContext ? ` · ${m.maxContext.toLocaleString()} ctx` : ''}
                    </span>
                  </div>
                  <span className="model-role">{m.labels.join(' · ')}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="rail-label" style={{ marginBottom: 12 }}>Projects ({projects.length})</div>
            <div className="card-list">
              {projects.length === 0 && <p className="rail-empty">No projects yet — create one from the Projects page.</p>}
              {projects.map((p) => (
                <div key={p.id} className="model-row">
                  <span className="model-dot" />
                  <div className="model-name-group">
                    <span className="model-name">{p.name}</span>
                    <span className="model-quant">{p.model}</span>
                  </div>
                  <span className="model-role">
                    {p.chats.length} {p.chats.length === 1 ? 'chat' : 'chats'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="rail-label" style={{ marginBottom: 12 }}>Routing</div>
            <div className="route-table">
              {routes.map((r) => (
                <div key={r.task} className="route-row">
                  <span className="route-task">{r.task}</span>
                  <span className="route-arrow">→</span>
                  <span className="route-model">{r.model}</span>
                </div>
              ))}
            </div>
            <p className="route-note">
              Each project pins its own model (change it from the model button). The Diary
              tab always routes through the sidecar pipeline, called exactly once per exchange.
            </p>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span className="rail-label" style={{ marginBottom: 0 }}>Cloud providers</span>
              <span className="badge-off">Off by default</span>
            </div>
            <div className="cloud-note">
              <span>
                Nothing leaves this network. Cloud models (Anthropic/OpenAI/OpenRouter)
                would be added in Lemonade as providers first, then selectable here — a
                deliberate, later decision.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
