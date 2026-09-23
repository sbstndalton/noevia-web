import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { ShellIcon } from '../ShellIcon';
import { Switch } from '../Switch';
import { MODE_LABEL, PermissionControl } from './PermissionControl';
import type { ToolMode } from './PermissionControl';

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
const SUGGESTIONS = [
  'List the files you have saved to my Google Drive',
  'Save a summary of this week’s notes to Google Drive',
  'Find my Drive file about backups and summarise it',
];

const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

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

const stateBadge = (d: Drive) => d.state === 'connected'
  ? <span className="badge ok"><ShellIcon name="check" size={13}/>{d.email ? `Connected as ${d.email.replace(/@gmail\.com$/, '')}` : 'Connected'}</span>
  : d.state === 'pending' ? <span className="badge warn">Waiting for Google</span>
  : d.state === 'error' ? <span className="badge danger">Needs reconnecting</span>
  : d.state === 'not-configured' ? <span className="badge count">Not available</span>
  : <span className="badge count">Not connected</span>;

/** Settings → Connectors: what noevia can reach on your behalf, and what each tool may do. */
export function ConnectorsSettings({ isAdmin, onStartChat, hideTitle = false }: { isAdmin: boolean; onStartChat?: (prompt: string) => void; hideTitle?: boolean }): JSX.Element {
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
    {!hideTitle && <div className="settings-title"><h1>Connectors</h1><p>Services noevia can use on your behalf. Each connection is yours alone: other people on this server never reach it.</p></div>}
    {error && <p className="route-note" role="alert">{error} <button className="btn btn-secondary btn-sm" onClick={() => void load()}>Try again</button></p>}
    <div className="connector-list">
      <button className="connector-card surface" onClick={() => setPage('gdrive')} disabled={!drive} aria-label="Google Drive">
        <span className="logo"><DriveLogo/></span>
        <span className="connector-text"><b>Google Drive</b><small>Search, read and save files. {drive ? stateBadge(drive) : <span className="badge count">Loading…</span>}</small></span>
        <ShellIcon name="chevron-right" size={18}/>
      </button>
      {nc && <button className="connector-card surface" onClick={() => setPage('nextcloud')} aria-label="Nextcloud">
        <span className="logo"><ShellIcon name="hard-drive" size={22}/></span>
        <span className="connector-text"><b>Nextcloud</b><small>Notes, files, calendar, tasks and more from your Nextcloud. {nc.state === 'connected'
          ? <span className="badge ok"><ShellIcon name="check" size={13}/>Connected as {nc.account}</span>
          : nc.state === 'error' ? <span className="badge danger">Needs attention</span>
          : nc.state === 'not-configured' ? <span className="badge count">Not available</span>
          : <span className="badge count">Not connected</span>}</small></span>
        <ShellIcon name="chevron-right" size={18}/>
      </button>}
      <div className="connector-card surface is-later" aria-disabled="true">
        <span className="logo"><ShellIcon name="server" size={22}/></span>
        <span className="connector-text"><b>MCP servers</b><small>Administrators add servers from the MCP directory or by URL, in Plugins → MCP servers. Ones that need your own sign-in or key are listed below.</small></span>
      </div>
    </div>
  </>;
}

function DrivePage({ drive, isAdmin, onBack, onChange, onActionStart, reload, onStartChat }: {
  drive: Drive; isAdmin: boolean; onBack: () => void; onChange: (d: Drive) => void; onActionStart: () => void; reload: () => Promise<unknown>; onStartChat?: (prompt: string) => void;
}): JSX.Element {
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
    const t = window.setInterval(() => { void reload(); }, 3000);
    return () => window.clearInterval(t);
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
  const groups: [string, Tool[]][] = [['Read-only tools', drive.tools.filter((t) => !t.write)], ['Write and delete tools', drive.tools.filter((t) => t.write)]];

  return <div className="connector-page">
    <button className="crumb-link" onClick={onBack}><ShellIcon name="arrow"/>Connectors</button>
    <div className="conn-head">
      <span className="logo"><DriveLogo/></span>
      <div className="conn-title"><h1>Google Drive</h1>{stateBadge(drive)}</div>
      <div className="actions">
        {connected && !confirmOff && <button className="btn btn-secondary" disabled={!!busy} onClick={() => setConfirmOff(true)}>Disconnect</button>}
      </div>
    </div>
    <p className="lede">Lets noevia search, read and save files in your Drive. It only sees files it created or that were shared with it (Google’s <em>drive.file</em> access), never the rest of your Drive.</p>
    {(error || (drive.message && drive.state !== 'pending')) && <p className="route-note" role="alert">{error || drive.message}</p>}

    {confirmOff && <div className="confirm-strip surface" role="alert">
      <div><b>Disconnect Google Drive?</b><p>noevia forgets the connection and Google revokes its access.{drive.backup ? ' Backups stop being copied to Drive until you connect again.' : ''} Files already in your Drive stay there.</p></div>
      <div className="confirm-actions"><button className="btn btn-secondary" onClick={() => setConfirmOff(false)}>Keep connected</button><button className="btn btn-danger" disabled={!!busy} onClick={() => void disconnect()}>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button></div>
    </div>}

    {drive.state === 'not-configured' && <div className="group surface"><div className="row"><div className="row-text"><span className="row-label">Not available on this server</span><span className="row-desc">{isAdmin ? 'This noevia build has no Google sign-in registered (GOOGLE_OAUTH_CLIENT_ID).' : 'Ask the person who runs this server to enable Google sign-in.'}</span></div></div></div>}

    {(drive.state === 'disconnected' || drive.state === 'error') && <div className="group surface"><div className="row">
      <div className="row-text"><span className="row-label">Connect your Google account</span><span className="row-desc">Google opens in a new tab with a short code. Approve there and this page updates by itself.</span></div>
      <button className="btn btn-primary" disabled={!!busy} onClick={() => void connect()}>{busy === 'connect' ? 'Starting…' : 'Connect Google Drive'}</button>
    </div></div>}

    {drive.state === 'pending' && <div className="group surface gdrive-pending" aria-live="polite"><div className="row">
      <div className="row-text"><span className="row-label">Enter this code on Google’s page</span><span className="row-desc">Opened in a new tab. You can also go to <a href={drive.verificationUrl} target="_blank" rel="noreferrer">{drive.verificationUrl?.replace(/^https?:\/\//, '')}</a> on any device.</span></div>
      <output className="gdrive-code-value" aria-label="Google sign-in code">{drive.userCode}</output>
    </div><div className="row">
      <div className="row-text"><span className="row-desc">Waiting for you to click Allow…</span></div>
      <a className="btn btn-primary" href={drive.verificationUrl} target="_blank" rel="noreferrer">Open Google <ShellIcon name="external-link" size={14}/></a>
      <button className="btn btn-secondary" disabled={!!busy} onClick={() => void act('cancel', () => call<Drive>('/api/connectors/gdrive/disconnect', 'POST', {}))}>Cancel</button>
    </div></div>}

    {connected && drive.backup && <div className="group surface backup"><div className="row">
      <div className="row-text"><span className="row-label">Offsite backups</span><span className="row-desc">
        {drive.backup.copyEnabled
          ? <>Encrypted backups are copied to the <em>noevia-offsite</em> folder. {drive.backup.copy?.state === 'ok' ? `Last copy ${when(drive.backup.copy.at)}${drive.backup.lastBackup ? `, ${(drive.backup.lastBackup.uploadedBytes / 1024 / 1024).toFixed(1)} MB` : ''}.` : drive.backup.copy?.message || 'The first copy follows the next backup.'}</>
          : <>Off: backups stay on this server only.</>}
      </span></div>
      <Switch label="Copy backups to Google Drive" checked={drive.backup.copyEnabled} disabled={!!busy} onChange={(on) => void act('backup', () => call<Drive>('/api/connectors/gdrive/backup-copy', 'PUT', { enabled: on }))}/>
    </div></div>}

    {connected && onStartChat && <>
      <h2>Prompt suggestions</h2>
      <div className="suggest">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => onStartChat(s)}>{s}<ShellIcon name="arrow-right" size={14}/></button>)}</div>
    </>}

    <h2>Tool permissions</h2>
    <p className="lede lede-tight">Choose when noevia may use each tool. Writes always show you what will change before they run.</p>
    {groups.map(([title, tools]) => <PermGroup key={title} title={title} tools={tools} busy={busy} setMode={setMode}/>)}
    {!connected && drive.state !== 'not-configured' && <p className="preview-footnote">These apply as soon as Drive is connected.</p>}
  </div>;
}

function PermGroup({ title, tools, busy, setMode }: { title: string; tools: Tool[]; busy: string; setMode: (tools: string[], mode: ToolMode) => void }): JSX.Element {
  const [open, setOpen] = useState(true);
  const modes = [...new Set(tools.map((t) => t.mode))];
  const write = tools.some((t) => t.write);
  const id = `perm-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return <section className="group surface perm-group" aria-label={title}>
    <div className="perm-head">
      <button className="perm-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ShellIcon name={open ? 'down' : 'chevron-right'} size={16}/><b>{title}</b><span className="badge count">{tools.length}</span>
      </button>
      <label className="select">
        <span className="sr-only">{title}: set all to</span>
        <select value={modes.length === 1 ? modes[0] : ''} disabled={!!busy} onChange={(e) => setMode(tools.map((t) => t.name), e.target.value as ToolMode)}>
          {modes.length > 1 && <option value="" disabled>Mixed</option>}
          {(['allow', 'ask', 'block'] as ToolMode[]).filter((m) => !(write && m === 'allow')).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </select>
        <ShellIcon name="down" size={14}/>
      </label>
    </div>
    {open && <div id={id}>{tools.map((t) => <div className="tool" key={t.name}>
      <span>{t.label}</span>
      <PermissionControl tool={t.label} value={t.mode} write={t.write} busy={busy.startsWith('policy')} onChange={(m) => setMode([t.name], m)}/>
    </div>)}</div>}
  </section>;
}

/** Settings → Connectors → Nextcloud. It has no connect button of its own: the tools use the
 *  account's storage connection, so this page says what that allows and owns what each tool may do. */
function NextcloudPage({ nc, onBack, onChange }: { nc: Nextcloud; onBack: () => void; onChange: (n: Nextcloud) => void }): JSX.Element {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const setMode = async (tools: string[], mode: ToolMode) => {
    setBusy(`policy:${tools.join(',')}`); setError('');
    try { onChange(await call<Nextcloud>('/api/connectors/nextcloud/policy', 'PUT', { tools, mode })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const groups: [string, Tool[]][] = [['Read-only tools', nc.tools.filter((t) => !t.write)], ['Write and delete tools', nc.tools.filter((t) => t.write)]];
  return <div className="connector-page">
    <button className="crumb-link" onClick={onBack}><ShellIcon name="arrow"/>Connectors</button>
    <div className="conn-head">
      <span className="logo"><ShellIcon name="hard-drive" size={24}/></span>
      <div className="conn-title"><h1>Nextcloud</h1>
        {nc.state === 'connected' ? <span className="badge ok"><ShellIcon name="check" size={13}/>Connected as {nc.account}</span>
          : nc.state === 'error' ? <span className="badge danger">Needs attention</span>
          : nc.state === 'not-configured' ? <span className="badge count">Not available</span>
          : <span className="badge count">Not connected</span>}
      </div>
    </div>
    <p className="lede">Your own Nextcloud, reached with the connection you set under <b>Settings → Diary &amp; storage</b>. noevia sends your app password only to that address, only for your requests, and only to the server an administrator listed.</p>
    {(error || nc.message) && <p className="route-note" role={error || nc.state === 'error' ? 'alert' : 'status'}>{error || nc.message}</p>}
    {nc.baseUrl && <div className="group surface"><div className="row">
      <div className="row-text"><span className="row-label">Address</span><span className="row-desc">{nc.baseUrl}</span></div>
    </div></div>}
    {nc.boxes.length > 0 && <div className="group surface"><div className="row">
      <div className="row-text"><span className="row-label">Toolboxes it offers</span>
        <span className="row-desc">{nc.boxes.map((b) => `${b.label} (${b.toolCount})`).join(' · ')}. A project chooses which of these it uses.</span></div>
    </div></div>}
    {nc.tools.length > 0 && <>
      <h2>Tool permissions</h2>
      <p className="lede lede-tight">Choose when noevia may use each tool. Writes always show you what will change before they run.</p>
      {groups.map(([title, tools]) => tools.length > 0 && <PermGroup key={title} title={title} tools={tools} busy={busy} setMode={(t, m) => void setMode(t, m)}/>)}
      {nc.state !== 'connected' && <p className="preview-footnote">These apply as soon as Nextcloud is connected.</p>}
    </>}
  </div>;
}
