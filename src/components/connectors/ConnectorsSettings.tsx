import { appLocale } from '../../user-preferences';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { ShellIcon } from '../ShellIcon';
import { Switch } from '../Switch';
import { MODE_LABEL, PermissionControl } from './PermissionControl';
import type { ToolMode } from './PermissionControl';
import { useT } from '../../i18n';
import type { MessageKey, Translate } from '../../i18n';
import '../../i18n/settings';

interface Tool { name: string; label: string; write: boolean; mode: ToolMode }
interface Nextcloud {
  id: 'nextcloud'; name: string; configured: boolean;
  state: 'not-configured' | 'disconnected' | 'connected' | 'error';
  account: string | null; baseUrl: string | null; message: string;
  boxes: { id: string; label: string; toolCount: number }[];
  tools: Tool[];
}

interface Drive {
  id: 'gdrive'; name: string; configured: boolean;
  state: 'not-configured' | 'disconnected' | 'pending' | 'connected' | 'error';
  email: string | null; message?: string; userCode?: string; verificationUrl?: string;
  /** Only for the administrator whose Drive also holds this server's backups. */
  backup: { enabled: boolean; copyEnabled: boolean; copy: { state: string; at: number | null; message: string } | null; lastBackup: { at: number; uploadedBytes: number } | null } | null;
  tools: Tool[];
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await apiFetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data as T;
}

// Things to ask that work with drive.file access: files noevia made, or was given.
// They become the person's own message, so they are in the interface language.
const SUGGESTIONS: MessageKey[] = ['connectors.drive.suggestList', 'connectors.drive.suggestSave', 'connectors.drive.suggestFind'];

const when = (t: Translate, ms?: number | null) => (ms ? new Date(ms).toLocaleString(appLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : t('connectors.never'));

function TrustReview({ origin, scope, tools, connected }: { origin: string; scope: string; tools: Tool[]; connected: boolean }): JSX.Element {
  const t = useT();
  const readable = tools.filter((tool) => !tool.write && tool.mode !== 'block').length;
  const writable = tools.filter((tool) => tool.write && tool.mode !== 'block').length;
  const blocked = tools.filter((tool) => tool.mode === 'block').length;
  return <section className="connector-trust" aria-label={t('connectors.review.label')}>
    <h2>{t('connectors.review.title')}</h2>
    <dl>
      <div><dt>{t('connectors.review.destination')}</dt><dd>{origin}</dd></div>
      <div><dt>{t('connectors.review.scope')}</dt><dd>{scope}</dd></div>
      <div><dt>{t('connectors.review.tools')}</dt><dd>{t('connectors.review.toolCounts', { read: readable, write: writable, blocked })}</dd></div>
    </dl>
    <p>{connected ? t('connectors.review.connected') : t('connectors.review.notConnected')} {t('connectors.review.approval')}</p>
  </section>;
}

function ToolReview({ tools, busy, setMode }: { tools: Tool[]; busy: string; setMode: (tools: string[], mode: ToolMode) => void }): JSX.Element {
  const t = useT();
  const [query, setQuery] = useState('');
  const matching = tools.filter((tool) => `${tool.label} ${tool.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups: [string, Tool[]][] = [[t('connectors.tools.read'), matching.filter((tool) => !tool.write)], [t('connectors.tools.write'), matching.filter((tool) => tool.write)]];
  return <>
    <h2>{t('connectors.tools.title')}</h2>
    <p className="lede lede-tight">{t('connectors.tools.intro')}</p>
    {tools.length > 0 && <input className="connector-tool-search" type="search" aria-label={t('connectors.tools.find')} placeholder={t('connectors.tools.findPlaceholder')} value={query} onChange={(event) => setQuery(event.target.value)} />}
    {tools.length === 0 && <p className="route-note">{t('connectors.tools.none')}</p>}
    {query && matching.length === 0 && <p className="route-note" role="status">{t('connectors.tools.noMatch', { query })}</p>}
    {groups.map(([title, group]) => group.length > 0 && <PermGroup key={title} title={title} tools={group} busy={busy} setMode={setMode}/>)}
  </>;
}

export function DriveLogo({ size = 24 }: { size?: number }): JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 87.3 78" aria-hidden="true">
    <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
    <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
    <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
    <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
    <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
    <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
  </svg>;
}

const stateBadge = (t: Translate, d: Drive) => d.state === 'connected'
  ? <span className="badge ok"><ShellIcon name="check" size={13}/>{d.email ? t('connectors.connectedAs', { account: d.email.replace(/@gmail\.com$/, '') }) : t('connectors.connected')}</span>
  : d.state === 'pending' ? <span className="badge warn">{t('connectors.drive.waiting')}</span>
  : d.state === 'error' ? <span className="badge danger">{t('connectors.drive.reconnect')}</span>
  : d.state === 'not-configured' ? <span className="badge count">{t('connectors.notAvailable')}</span>
  : <span className="badge count">{t('connectors.notConnected')}</span>;

/** Nextcloud's badge: the same states, with its own wording for an error. */
const ncBadge = (t: Translate, nc: Nextcloud) => nc.state === 'connected'
  ? <span className="badge ok"><ShellIcon name="check" size={13}/>{t('connectors.connectedAs', { account: nc.account ?? '' })}</span>
  : nc.state === 'error' ? <span className="badge danger">{t('connectors.needsAttention')}</span>
  : nc.state === 'not-configured' ? <span className="badge count">{t('connectors.notAvailable')}</span>
  : <span className="badge count">{t('connectors.notConnected')}</span>;

/** Settings → Connectors: what noevia can reach on your behalf, and what each tool may do. */
export function ConnectorsSettings({ isAdmin, onStartChat, hideTitle = false }: { isAdmin: boolean; onStartChat?: (prompt: string) => void; hideTitle?: boolean }): JSX.Element {
  const t = useT();
  const [drive, setDrive] = useState<Drive | null>(null);
  const [nc, setNc] = useState<Nextcloud | null>(null);
  const [page, setPage] = useState<'list' | 'gdrive' | 'nextcloud'>('list');
  const [error, setError] = useState('');
  const request = useRef(0);
  const invalidateLoads = useCallback(() => { ++request.current; }, []);
  const updateDrive = useCallback((next: Drive) => {
    invalidateLoads();
    setDrive(next);
    setError('');
  }, [invalidateLoads]);
  const load = useCallback(async () => {
    const current = ++request.current;
    try {
      const r = await call<{ connectors: (Drive | Nextcloud)[] }>('/api/connectors');
      if (current !== request.current) return;
      setDrive(r.connectors.find((c) => c.id === 'gdrive') as Drive);
      setNc((r.connectors.find((c) => c.id === 'nextcloud') as Nextcloud) || null);
      setError('');
    } catch (e) {
      if (current === request.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); return invalidateLoads; }, [load, invalidateLoads]);

  if (page === 'nextcloud' && nc) return <NextcloudPage nc={nc} onBack={() => setPage('list')} onChange={setNc}/>;
  if (page === 'gdrive' && drive) return <DrivePage drive={drive} isAdmin={isAdmin} onBack={() => { invalidateLoads(); setPage('list'); }} onChange={updateDrive} onActionStart={invalidateLoads} reload={load} onStartChat={onStartChat}/>;

  return <>
    {!hideTitle && <div className="settings-title"><h1>{t('connectors.title')}</h1><p>{t('connectors.intro')}</p></div>}
    {error && <p className="route-note" role="alert">{error} <button className="btn btn-secondary btn-sm" onClick={() => void load()}>{t('connectors.tryAgain')}</button></p>}
    <div className="connector-list">
      <button className="connector-card surface" onClick={() => setPage('gdrive')} disabled={!drive} aria-label="Google Drive">
        <span className="logo"><DriveLogo/></span>
        <span className="connector-text"><b>Google Drive</b><small>{t('connectors.drive.summary')} {drive ? stateBadge(t, drive) : <span className="badge count">{t('settings.loading')}</span>}</small></span>
        <ShellIcon name="chevron-right" size={18}/>
      </button>
      {nc && <button className="connector-card surface" onClick={() => setPage('nextcloud')} aria-label="Nextcloud">
        <span className="logo"><ShellIcon name="hard-drive" size={22}/></span>
        <span className="connector-text"><b>Nextcloud</b><small>{t('connectors.nextcloud.summary')} {ncBadge(t, nc)}</small></span>
        <ShellIcon name="chevron-right" size={18}/>
      </button>}
      <div className="connector-card surface is-later" aria-disabled="true">
        <span className="logo"><ShellIcon name="server" size={22}/></span>
        <span className="connector-text"><b>{t('connectors.mcp.title')}</b><small>{t('connectors.mcp.summary')}</small></span>
      </div>
    </div>
  </>;
}

function DrivePage({ drive, isAdmin, onBack, onChange, onActionStart, reload, onStartChat }: {
  drive: Drive; isAdmin: boolean; onBack: () => void; onChange: (d: Drive) => void; onActionStart: () => void; reload: () => Promise<unknown>; onStartChat?: (prompt: string) => void;
}): JSX.Element {
  const t = useT();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);
  const act = async (label: string, work: () => Promise<Drive>) => {
    onActionStart();
    setBusy(label); setError('');
    try { onChange(await work()); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  // Waiting on Google: refresh until the approval lands, so the page turns green by itself.
  useEffect(() => {
    if (drive.state !== 'pending' || busy) return;
    const timer = window.setInterval(() => { void reload(); }, 3000);
    return () => window.clearInterval(timer);
  }, [drive.state, busy, reload]);

  const connect = () => act('connect', async () => {
    // Open the tab inside the click, or the browser blocks it as a pop-up.
    const tab = window.open('about:blank', '_blank');
    try {
      const next = await call<Drive>('/api/connectors/gdrive/connect', 'POST', {});
      if (tab && next.verificationUrl) { tab.opener = null; tab.location.href = next.verificationUrl; } else tab?.close();
      return next;
    } catch (e) { tab?.close(); throw e; }
  });
  const disconnect = () => act('disconnect', () => call<Drive>('/api/connectors/gdrive/disconnect', 'POST', {})).then(() => setConfirmOff(false));
  const setMode = (tools: string[], mode: ToolMode) => void act(`policy:${tools.join(',')}`, () => call<Drive>('/api/connectors/gdrive/policy', 'PUT', { tools, mode }));
  const connected = drive.state === 'connected';

  return <div className="connector-page">
    <button className="crumb-link" onClick={onBack}><ShellIcon name="arrow"/>{t('connectors.title')}</button>
    <div className="conn-head">
      <span className="logo"><DriveLogo/></span>
      <div className="conn-title"><h1>Google Drive</h1>{stateBadge(t, drive)}</div>
      <div className="actions">
        {connected && !confirmOff && <button className="btn btn-secondary" disabled={!!busy} onClick={() => setConfirmOff(true)}>{t('connectors.disconnect')}</button>}
      </div>
    </div>
    <p className="lede">{t('connectors.drive.lede')}</p>
    <TrustReview origin={t('connectors.drive.origin')} scope={t('connectors.drive.scope')} tools={drive.tools} connected={connected}/>
    {(error || (drive.message && drive.state !== 'pending')) && <p className="route-note" role="alert">{error || drive.message}</p>}

    {confirmOff && <div className="confirm-strip surface" role="alert">
      <div><b>{t('connectors.drive.confirmTitle')}</b><p>{[t('connectors.drive.confirmBody'), drive.backup ? t('connectors.drive.confirmBackups') : '', t('connectors.drive.confirmFiles')].filter(Boolean).join(' ')}</p></div>
      <div className="confirm-actions"><button className="btn btn-secondary" onClick={() => setConfirmOff(false)}>{t('connectors.keepConnected')}</button><button className="btn btn-danger" disabled={!!busy} onClick={() => void disconnect()}>{busy === 'disconnect' ? t('connectors.disconnecting') : t('connectors.disconnect')}</button></div>
    </div>}

    {drive.state === 'not-configured' && <div className="group surface"><div className="row"><div className="row-text"><span className="row-label">{t('connectors.drive.unavailable')}</span><span className="row-desc">{isAdmin ? t('connectors.drive.unavailableAdmin') : t('connectors.drive.unavailableMember')}</span></div></div></div>}

    {(drive.state === 'disconnected' || drive.state === 'error') && <div className="group surface"><div className="row">
      <div className="row-text"><span className="row-label">{t('connectors.drive.connectTitle')}</span><span className="row-desc">{t('connectors.drive.connectDesc')}</span></div>
      <button className="btn btn-primary" disabled={!!busy} onClick={() => void connect()}>{busy === 'connect' ? t('connectors.drive.starting') : t('connectors.drive.connect')}</button>
    </div></div>}

    {drive.state === 'pending' && <div className="group surface gdrive-pending" aria-live="polite"><div className="row">
      <div className="row-text"><span className="row-label">{t('connectors.drive.enterCode')}</span><span className="row-desc">{t('connectors.drive.openedBefore')} <a href={drive.verificationUrl} target="_blank" rel="noreferrer">{drive.verificationUrl?.replace(/^https?:\/\//, '')}</a> {t('connectors.drive.openedAfter')}</span></div>
      <output className="gdrive-code-value" aria-label={t('connectors.drive.code')}>{drive.userCode}</output>
    </div><div className="row">
      <div className="row-text"><span className="row-desc">{t('connectors.drive.waitingAllow')}</span></div>
      <a className="btn btn-primary" href={drive.verificationUrl} target="_blank" rel="noreferrer">{t('connectors.drive.openGoogle')} <ShellIcon name="external-link" size={14}/></a>
      <button className="btn btn-secondary" disabled={!!busy} onClick={() => void act('cancel', () => call<Drive>('/api/connectors/gdrive/disconnect', 'POST', {}))}>{t('common.cancel')}</button>
    </div></div>}

    {connected && drive.backup && <div className="group surface backup"><div className="row">
      <div className="row-text"><span className="row-label">{t('connectors.backup.title')}</span><span className="row-desc">
        {drive.backup.copyEnabled
          ? <>{t('connectors.backup.on', { folder: 'noevia-offsite' })} {drive.backup.copy?.state === 'ok' ? (drive.backup.lastBackup ? t('connectors.backup.lastCopySize', { date: when(t, drive.backup.copy.at), size: (drive.backup.lastBackup.uploadedBytes / 1024 / 1024).toFixed(1) }) : t('connectors.backup.lastCopy', { date: when(t, drive.backup.copy.at) })) : drive.backup.copy?.message || t('connectors.backup.first')}</>
          : <>{t('connectors.backup.off')}</>}
      </span></div>
      <Switch label={t('connectors.backup.switch')} checked={drive.backup.copyEnabled} disabled={!!busy} onChange={(on) => void act('backup', () => call<Drive>('/api/connectors/gdrive/backup-copy', 'PUT', { enabled: on }))}/>
    </div></div>}

    {connected && onStartChat && <>
      <h2>{t('connectors.drive.suggestions')}</h2>
      <div className="suggest">{SUGGESTIONS.map((key) => t(key)).map((s) => <button key={s} className="chip" onClick={() => onStartChat(s)}>{s}<ShellIcon name="arrow-right" size={14}/></button>)}</div>
    </>}

    <ToolReview tools={drive.tools} busy={busy} setMode={setMode}/>
    {!connected && drive.state !== 'not-configured' && <p className="preview-footnote">{t('connectors.drive.applyLater')}</p>}
  </div>;
}

function PermGroup({ title, tools, busy, setMode }: { title: string; tools: Tool[]; busy: string; setMode: (tools: string[], mode: ToolMode) => void }): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(true);
  const modes = [...new Set(tools.map((tool) => tool.mode))];
  const write = tools.some((tool) => tool.write);
  const id = `perm-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return <section className="group surface perm-group" aria-label={title}>
    <div className="perm-head">
      <button className="perm-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ShellIcon name={open ? 'down' : 'chevron-right'} size={16}/><b>{title}</b><span className="badge count">{tools.length}</span>
      </button>
      <label className="select">
        <span className="sr-only">{t('connectors.tools.setAll', { group: title })}</span>
        <select value={modes.length === 1 ? modes[0] : ''} disabled={!!busy} onChange={(e) => setMode(tools.map((tool) => tool.name), e.target.value as ToolMode)}>
          {modes.length > 1 && <option value="" disabled>{t('connectors.tools.mixed')}</option>}
          {(['allow', 'ask', 'block'] as ToolMode[]).filter((m) => !(write && m === 'allow')).map((m) => <option key={m} value={m}>{t(MODE_LABEL[m])}</option>)}
        </select>
        <ShellIcon name="down" size={14}/>
      </label>
    </div>
    {open && <div id={id}>{tools.map((tool) => <div className="tool" key={tool.name}>
      <span>{tool.label}</span>
      <PermissionControl tool={tool.label} value={tool.mode} write={tool.write} busy={busy.startsWith('policy')} onChange={(m) => setMode([tool.name], m)}/>
    </div>)}</div>}
  </section>;
}

/** Settings → Connectors → Nextcloud. It has no connect button of its own: the tools use the
 *  account's storage connection, so this page says what that allows and owns what each tool may do. */
function NextcloudPage({ nc, onBack, onChange }: { nc: Nextcloud; onBack: () => void; onChange: (n: Nextcloud) => void }): JSX.Element {
  const t = useT();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const setMode = async (tools: string[], mode: ToolMode) => {
    setBusy(`policy:${tools.join(',')}`); setError('');
    try { onChange(await call<Nextcloud>('/api/connectors/nextcloud/policy', 'PUT', { tools, mode })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  return <div className="connector-page">
    <button className="crumb-link" onClick={onBack}><ShellIcon name="arrow"/>{t('connectors.title')}</button>
    <div className="conn-head">
      <span className="logo"><ShellIcon name="hard-drive" size={24}/></span>
      <div className="conn-title"><h1>Nextcloud</h1>
        {ncBadge(t, nc)}
      </div>
    </div>
    <p className="lede">{t('connectors.nextcloud.ledeBefore')} <b>{t('settings.title')} → {t('settings.section.diary')}</b>{t('connectors.nextcloud.ledeAfter')}</p>
    <TrustReview origin={nc.baseUrl || t('connectors.nextcloud.origin')} scope={t('connectors.nextcloud.scope')} tools={nc.tools} connected={nc.state === 'connected'}/>
    {(error || nc.message) && <p className="route-note" role={error || nc.state === 'error' ? 'alert' : 'status'}>{error || nc.message}</p>}
    {nc.baseUrl && <div className="group surface"><div className="row">
      <div className="row-text"><span className="row-label">{t('connectors.nextcloud.address')}</span><span className="row-desc">{nc.baseUrl}</span></div>
    </div></div>}
    {nc.boxes.length > 0 && <div className="group surface"><div className="row">
      <div className="row-text"><span className="row-label">{t('connectors.nextcloud.toolboxes')}</span>
        <span className="row-desc">{nc.boxes.map((b) => `${b.label} (${b.toolCount})`).join(' · ')}. {t('connectors.nextcloud.toolboxesNote')}</span></div>
    </div></div>}
    {nc.tools.length > 0 && <>
      <ToolReview tools={nc.tools} busy={busy} setMode={(t, m) => void setMode(t, m)}/>
      {nc.state !== 'connected' && <p className="preview-footnote">{t('connectors.nextcloud.applyLater')}</p>}
    </>}
  </div>;
}
