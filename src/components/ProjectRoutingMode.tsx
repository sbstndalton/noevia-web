// #1007: the chat model picker's Auto routing choice, per chat or project. The same
// RoutingModeChoice as Settings → Models & routing → Routing; the cloud provider and models stay
// the account's. Saved at once, like every other control in the picker. Renders nothing while
// routing modes are off on the server.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { fetchRoutingMode, saveProjectConfig } from '../api';
import type { RoutingModeId, RoutingModeSettings } from '../api';
import type { Project } from '../types';
import { RoutingModeChoice, ROUTING_MODES, useRoutingModeLabel } from './RoutingModeChoice';
import { useT } from '../i18n';

export function ProjectRoutingMode({ project, disabled = false, onChanged }: {
  project: Project; disabled?: boolean; onChanged: () => void | Promise<unknown>;
}): JSX.Element | null {
  const t = useT();
  const modeLabel = useRoutingModeLabel();
  const [account, setAccount] = useState<RoutingModeSettings | null>(null);
  const [mode, setMode] = useState<RoutingModeId | ''>(project.routingMode?.mode ?? '');
  const [whenSensitive, setWhenSensitive] = useState<'ask' | 'local'>(project.routingMode?.whenSensitive ?? 'ask');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => fetchRoutingMode().then((v) => { if (live) setAccount(v); }).catch(() => { if (live) setAccount({ enabled: false }); });
    void load();
    window.addEventListener('noevia:routing-mode-updated', load);
    return () => { live = false; window.removeEventListener('noevia:routing-mode-updated', load); };
  }, []);
  useEffect(() => { setMode(project.routingMode?.mode ?? ''); setWhenSensitive(project.routingMode?.whenSensitive ?? 'ask'); }, [project.id, project.routingMode?.mode, project.routingMode?.whenSensitive]);
  if (!account?.enabled) return null;
  const save = async (nextMode: RoutingModeId | '', nextSensitive: 'ask' | 'local') => {
    const before = { mode, whenSensitive };
    setMode(nextMode); setWhenSensitive(nextSensitive);
    setBusy(true); setStatus(''); setError('');
    try {
      await saveProjectConfig(project.id, { routingMode: nextMode ? { mode: nextMode, whenSensitive: nextSensitive } : null });
      setStatus(t('rmode.chatSaved'));
      try { await onChanged(); } catch { /* the save itself succeeded */ }
    } catch (e) {
      setMode(before.mode); setWhenSensitive(before.whenSensitive);
      setError(e instanceof Error ? e.message : t('modelPopup.saveError'));
    } finally { setBusy(false); }
  };
  const accountMode = account.mode ?? null;
  return <section className="mp-routing" aria-label={t('rmode.chatTitle')} data-testid="project-routing-mode">
    <h4 className="mp-col-title">{t('rmode.chatTitle')}</h4>
    <RoutingModeChoice mode={mode} whenSensitive={whenSensitive} allowed={account.allowed ?? ROUTING_MODES} disabled={disabled || busy}
      unsetLabel={accountMode ? t('rmode.inherit', { mode: modeLabel(accountMode) }) : t('rmode.inheritUnset')}
      unsetHint={t('rmode.inheritHint')}
      onMode={(m) => void save(m, whenSensitive)} onSensitive={(s) => void save(mode, s)} />
    {status && <p role="status" className="mp-hint">{status}</p>}
    {error && <p role="alert" className="mp-warn">{error}</p>}
  </section>;
}
