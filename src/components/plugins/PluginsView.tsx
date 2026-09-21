import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch, fetchProfile } from '../../api';
import { ShellIcon } from '../ShellIcon';
import { SegmentedControl } from '../SegmentedControl';
import { ConnectorsSettings } from '../connectors/ConnectorsSettings';

type Tab = 'connected' | 'mcp' | 'skills';
interface Item { why?: string; id: string; name: string; publisher: string; description: string; version: string; url: string; remote: boolean; installable?: boolean; notInstallable?: string; needsKey?: boolean; headers?: KeyHeader[] }
interface KeyHeader { name: string; required: boolean; secret: boolean; description: string; template: string | null }
interface Added { id: string; registryName: string; title: string; declaredHeaders?: KeyHeader[]; toolCount: number | null; error: string | null; keyHeaders?: string[]; oauth?: boolean; personal?: boolean; redirectUri?: string; oauthClient?: { manual: boolean; clientId: string | null; hasSecret: boolean; redirectUri: string; issuer: string } | null }

/** Open the sign-in in a new tab from inside the click (or the browser blocks it), then point it at the URL. */
const tools = (n: number | null | undefined) => `${n ?? '…'} tool${n === 1 ? '' : 's'}`;

async function signInTab(get: () => Promise<string | null>): Promise<boolean> {
  const tab = window.open('about:blank', '_blank');
  try { const url = await get(); if (tab && url) { tab.opener = null; tab.location.href = url; return true; } tab?.close(); return false; }
  catch (e) { tab?.close(); throw e; }
}

/** Plugins: the integrations you use (Google Drive and friends) plus a read-only directory of
 *  MCP servers and skills other people publish. Connecting moved here from Settings
 *  (user review, 2026-09-19); off-site backups still use the same Drive connection. */
export function PluginsView({ onStartChat, embedded = false, projects = [], onProjectsChanged }: { onStartChat?: (prompt: string) => void; embedded?: boolean; projects?: { id: string; name: string }[]; onProjectsChanged?: () => void }): JSX.Element {
  const [tab, setTab] = useState<Tab>('connected');
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => { let live = true; fetchProfile().then((p) => { if (live) setIsAdmin(p.user.role === 'admin'); }).catch(() => undefined); return () => { live = false; }; }, []);
  const body = <div className="plugins-page">
    <header className="plugins-head">
      <h1>Plugins</h1>
      <p>Connect services noevia can use for you, and browse MCP servers and skills that other people publish.</p>
      <SegmentedControl label="Plugins" value={tab} onChange={setTab} options={[['connected', 'Connected'], ['mcp', 'MCP servers'], ['skills', 'Skills']]}/>
    </header>
    {tab === 'connected'
      ? <div className="plugins-connected"><ConnectorsSettings hideTitle isAdmin={isAdmin} onStartChat={onStartChat}/><SignInServers/><KeyServers/></div>
      : <Directory key={tab} kind={tab} projects={projects} onProjectsChanged={onProjectsChanged} isAdmin={isAdmin}/>}
  </div>;
  return embedded ? body : <main className="main plugins-view">{body}</main>;
}

function Directory({ kind, projects, onProjectsChanged, isAdmin }: { kind: 'mcp' | 'skills'; projects: { id: string; name: string }[]; onProjectsChanged?: () => void; isAdmin: boolean }): JSX.Element {
  const [added, setAdded] = useState<Added[]>([]);
  useEffect(() => { if (kind !== 'mcp' || !isAdmin) return; apiFetch('/api/admin/mcp-directory').then((r) => r.json()).then((d) => setAdded(d.servers || [])).catch(() => undefined); }, [kind, isAdmin]);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [source, setSource] = useState<{ label: string; home: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // noevia's curated starters (server/plugin-starters.json): a failure just hides the row.
  const [starters, setStarters] = useState<Item[]>([]);
  useEffect(() => {
    let live = true;
    apiFetch(`/api/plugins/directory?kind=${kind}&starters=1`).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setStarters(d?.items ?? []); }).catch(() => undefined);
    return () => { live = false; };
  }, [kind]);
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      setError('');
      apiFetch(`/api/plugins/directory?kind=${kind}&q=${encodeURIComponent(query.trim())}`)
        .then(async (r) => { const data = await r.json().catch(() => ({})); if (!live) return; setSource(data.source ?? null); if (!r.ok) throw new Error(data.error || 'The directory could not be reached.'); setItems(data.items); })
        .catch((e) => { if (live) { setError((e as Error).message); setItems([]); } });
    }, query ? 300 : 0);
    return () => { live = false; window.clearTimeout(t); };
  }, [kind, query, attempt]);
  const card = (i: Item, starter = false) => <li key={(starter ? 'starter:' : '') + i.id} className="plugin-card surface">
        <span className="plugin-card-icon"><ShellIcon name={kind === 'mcp' ? 'server' : 'sparkles'} size={20}/></span>
        <span className="plugin-card-text">
          <b>{i.name}</b>
          {i.publisher && <small className="plugin-publisher">{i.publisher}{i.version && ` · v${i.version}`}{i.remote && ' · hosted'}</small>}
          {i.why && <small className="plugin-why">{i.why}</small>}
          {i.description && <small>{i.description}</small>}
        </span>
        <span className="plugin-card-actions">
          {i.url && <a className="btn btn-secondary btn-sm plugin-card-link" href={i.url} target="_blank" rel="noreferrer noopener" aria-label={`View ${i.name}`}>View</a>}
          {kind === 'skills' && <AddSkill skill={i} projects={projects} onAdded={onProjectsChanged}/>}
          {kind === 'mcp' && isAdmin && <AddServer item={i} added={added.find((a) => a.registryName === i.id)} onChange={setAdded}/>}
        </span>
</li>;
  return <section className="plugins-directory" aria-label={kind === 'mcp' ? 'MCP servers' : 'Skills'}>
    <div className="settings-search plugins-search"><ShellIcon name="search" size={16}/><input aria-label={kind === 'mcp' ? 'Search MCP servers' : 'Search skills'} placeholder={kind === 'mcp' ? 'Search MCP servers' : 'Search skills'} value={query} onChange={(e) => setQuery(e.target.value)}/></div>
    <p className="plugins-note">{kind === 'mcp'
      ? (isAdmin ? 'Published by their authors in the public MCP registry, not reviewed by noevia. Administrators can add hosted servers: each becomes a toolbox a project has to choose, it never receives your passwords, and every one of its tools asks before it runs.' : 'Published by their authors in the public MCP registry, not reviewed by noevia. An administrator can add hosted servers for everyone on this noevia.')
      : 'Skills published by Anthropic. Add one to a project and it arrives switched off: review it in the project’s instruction skills, then enable it. Only the written instructions are copied; scripts a skill bundles are never downloaded or run.'}
      {source && <> Source: <a href={source.home} target="_blank" rel="noreferrer noopener">{source.label}</a>.</>}</p>
    {error && <p className="route-note" role="alert">{error} <button className="btn btn-secondary btn-sm" onClick={() => setAttempt((n) => n + 1)}>Try again</button></p>}
    {kind === 'mcp' && isAdmin && <AddByUrl onChange={setAdded}/>}
    {items === null ? <p className="plugins-note" aria-live="polite">Loading…</p> : !error && items.length === 0 ? <p className="plugins-note">Nothing matches “{query}”.</p> : null}
    {/* Servers added by URL have no registry entry of their own; list them here so they can be
        managed (user roadmap: custom MCP server by URL). */}
    {kind === 'mcp' && isAdmin && added.some((a) => a.registryName.startsWith('url:')) && <ul className="plugin-grid">
      {added.filter((a) => a.registryName.startsWith('url:')).map((a) => <li key={a.id} className="plugin-card surface">
        <span className="plugin-card-icon"><ShellIcon name="server" size={20}/></span>
        <span className="plugin-card-text"><b>{a.title}</b><small className="plugin-publisher">Added by URL</small><small>{a.registryName.slice(4)}</small></span>
        <span className="plugin-card-actions"><AddServer item={{ id: a.registryName, name: a.title, publisher: '', description: '', version: '', url: '', remote: true, installable: true, headers: a.declaredHeaders }} added={a} onChange={setAdded}/></span>
      </li>)}
    </ul>}
    {!query && starters.length > 0 && <section className="plugins-starters" aria-label="Recommended by noevia">
      <h2 className="plugins-subhead">Recommended by noevia</h2>
      <ul className="plugin-grid">{starters.map((i) => card(i, true))}</ul>
    </section>}
    {!query && starters.length > 0 && items && items.length > 0 && <h2 className="plugins-subhead">{kind === 'mcp' ? 'All MCP servers' : 'All skills'}</h2>}
    <ul className="plugin-grid">
      {items?.map((i) => card(i))}
    </ul>
  </section>;
}

/** Add one published skill to a chosen project. It arrives needing review, never enabled. */
function AddSkill({ skill, projects, onAdded }: { skill: Item; projects: { id: string; name: string }[]; onAdded?: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  if (!projects.length) return <button className="btn btn-secondary btn-sm plugin-card-link" disabled title="Create a project first">Add to project</button>;
  if (!open) return <span className="plugin-add"><button className="btn btn-secondary btn-sm plugin-card-link" aria-label={`Add ${skill.name} to a project`} onClick={() => { setOpen(true); setNote(null); }}>Add to project</button>{note && <small role={note.error ? 'alert' : 'status'} className={note.error ? 'plugin-add-error' : ''}>{note.text}</small>}</span>;
  const add = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await apiFetch(`/api/projects/${encodeURIComponent(project)}/skills/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skill: skill.id }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Could not add the skill.');
      const name = projects.find((p) => p.id === project)?.name || 'the project';
      setNote({ text: `Added to ${name}. Review and enable it in the project’s instruction skills.` });
      setOpen(false); onAdded?.();
    } catch (e) { setNote({ text: (e as Error).message, error: true }); } finally { setBusy(false); }
  };
  return <span className="plugin-add">
    <select aria-label={`Project for ${skill.name}`} value={project} onChange={(e) => setProject(e.target.value)} disabled={busy}>
      <option value="">Choose a project…</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
    <button className="btn btn-primary btn-sm" disabled={!project || busy} onClick={() => void add()}>{busy ? 'Adding…' : 'Add'}</button>
    <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
    {note && <small role={note.error ? 'alert' : 'status'} className={note.error ? 'plugin-add-error' : ''}>{note.text}</small>}
  </span>;
}

/** Administrators add or remove a hosted server from the registry. The server re-reads its URL from
 *  the registry, checks it is public, and makes sure it answers before saving. */
function AddServer({ item, added, onChange }: { item: Item; added?: Added; onChange: (servers: Added[]) => void }): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  // The key form: shown before adding a server that needs one, or to change a key later.
  const [form, setForm] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [keyMode, setKeyMode] = useState<'shared' | 'personal'>('personal');
  const fields = item.headers || [];
  // A sign-in service that needs a hand-registered app: where to register, and the app's ID/secret.
  const [appForm, setAppForm] = useState<{ issuer?: string; redirectUri?: string } | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const saveApp = (id: string) => void signInTab(async () => {
    setBusy(true); setNote(null);
    try {
      const r = await apiFetch(`/api/admin/mcp-directory/${encodeURIComponent(id)}/oauth-client`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setNote({ text: d.error || 'The app was not accepted.', error: true }); return null; }
      onChange(d.servers || []); setAppForm(null); setClientSecret('');
      setNote({ text: 'Finish signing in in the new tab.' }); pollAdded();
      return d.signIn;
    } finally { setBusy(false); }
  }).catch((e) => setNote({ text: (e as Error).message, error: true }));
  const call = async (method: 'POST' | 'DELETE' | 'PUT') => {
    setBusy(true); setNote(null);
    try {
      // A personal server's key is the admin's own, changed like anyone else's.
      const url = method === 'POST' ? '/api/admin/mcp-directory' : method === 'PUT' ? (added?.personal ? `/api/mcp-keys/${encodeURIComponent(added!.id)}` : `/api/admin/mcp-directory/${encodeURIComponent(added!.id)}/keys`) : `/api/admin/mcp-directory/${encodeURIComponent(added!.id)}`;
      const payload = method === 'POST' ? { registryName: item.id, headers: values, keyMode } : method === 'PUT' ? { headers: values } : undefined;
      let data: any = {};
      let status = 0;
      const send = async () => { const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined }); status = r.status; data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error || 'That did not work.'); return data.signIn || null; };
      // Adding may turn out to need a sign-in; the tab has to open inside this click.
      if (method === 'POST' && !fields.length) await signInTab(send); else await send();
      if (status === 202 && data.needsClient) { onChange(data.servers || []); setAppForm({ issuer: data.issuer, redirectUri: data.redirectUri }); return; }
      if (status === 202) { onChange(data.servers || []); setNote({ text: 'Finish signing in in the new tab. The server’s tools appear here once you have.' }); pollAdded(); return; }
      onChange(data.servers || []); setForm(false); setValues({});
      setNote({ text: method === 'POST' ? `Added with ${tools(data.server?.toolCount ?? 0)}. Choose it under a project’s Tools to use it.` : method === 'PUT' ? 'Key updated.' : 'Removed.' });
    } catch (e) { setNote({ text: (e as Error).message, error: true }); } finally { setBusy(false); }
  };
  // After an OAuth add, wait for the admin's sign-in to land and the tools to be listed.
  const pollAdded = () => {
    let n = 0;
    const t = window.setInterval(async () => {
      n++;
      const d = await apiFetch('/api/admin/mcp-directory').then((r) => r.json()).catch(() => null);
      const me = d?.servers?.find((x: Added) => x.registryName === item.id);
      if (d?.servers) onChange(d.servers);
      if ((me && me.toolCount) || n > 60) { window.clearInterval(t); if (me?.toolCount) setNote({ text: `Signed in. ${tools(me.toolCount)} available; choose it under a project’s Tools. Everyone else signs in with their own account from Plugins → Connected.` }); }
    }, 3000);
  };
  const msg = note && <small role={note.error ? 'alert' : 'status'} className={note.error ? 'plugin-add-error' : ''}>{note.text}</small>;
  const keyForm = (submitLabel: string, method: 'POST' | 'PUT') => <form className="plugin-key-form" onSubmit={(e) => { e.preventDefault(); void call(method); }}>
    {fields.map((h) => <label key={h.name}>
      <span>{h.name}{h.required ? '' : ' (optional)'}</span>
      {h.description && <small>{h.description}</small>}
      <input type={h.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} required={h.required}
        placeholder={h.template ? h.template.replace(/\{([^}]+)\}/, '$1') : ''} value={values[h.name] || ''}
        onChange={(e) => setValues((v) => ({ ...v, [h.name]: e.target.value }))}/>
    </label>)}
    {method === 'POST' && <fieldset className="plugin-key-mode"><legend>Who uses this key</legend>
      <label><input type="radio" name={`mode-${item.id}`} checked={keyMode === 'personal'} onChange={() => setKeyMode('personal')}/> Each person uses their own key <small>(yours is used to list the tools; others add theirs in Plugins → Connected)</small></label>
      <label><input type="radio" name={`mode-${item.id}`} checked={keyMode === 'shared'} onChange={() => setKeyMode('shared')}/> Everyone uses this key</label>
    </fieldset>}
    <small className="plugin-key-note">Stored encrypted on this server and sent only to this MCP server. {method === 'POST' ? (keyMode === 'shared' ? 'Everyone who uses its toolbox uses this key.' : 'Only you use this key.') : added?.personal ? 'This is your own key.' : 'Everyone who uses its toolbox uses this key.'}</small>
    <span className="plugin-key-actions"><button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Checking…' : submitLabel}</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setForm(false); setValues({}); }}>Cancel</button></span>
  </form>;
  const appFormView = (id: string) => appForm && <form className="plugin-key-form" onSubmit={(e) => { e.preventDefault(); saveApp(id); }}>
    <small className="plugin-key-note">This service does not let apps register themselves. Register an app{appForm.issuer ? <> with <b>{appForm.issuer}</b></> : null} (in its developer or OAuth settings) and give it this return address:</small>
    <span className="plugin-copy"><code>{appForm.redirectUri}</code><button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(appForm.redirectUri || '')}>Copy</button></span>
    <label><span>Client ID</span><input autoComplete="off" spellCheck={false} required value={clientId} onChange={(e) => setClientId(e.target.value)}/></label>
    <label><span>Client secret (if the service gave one)</span><input type="password" autoComplete="off" spellCheck={false} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}/></label>
    <small className="plugin-key-note">Stored encrypted and never shown again. Changing the app later signs everyone out of this server.</small>
    <span className="plugin-key-actions"><button className="btn btn-primary btn-sm" disabled={busy || !clientId.trim()}>{busy ? 'Checking…' : 'Save and sign in'}</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setAppForm(null)}>Cancel</button></span>
  </form>;
  if (added) return <span className="plugin-add">
    <span className="badge ok">{added.error ? (added.oauth ? 'Waiting for sign-in' : 'Not answering') : `Added · ${tools(added.toolCount)}`}</span>
    {added.keyHeaders?.length ? <span className="badge count">Shared key set</span> : null}
    {added.personal && <span className="badge count">Each person adds a key</span>}
    {added.oauth && <span className="badge count">Each person signs in</span>}
    {added.oauth && added.oauthClient?.manual && <span className="badge count">App: {added.oauthClient.clientId}</span>}
    {added.oauth && !appForm && (!added.oauthClient || added.oauthClient.manual) && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setClientId(added.oauthClient?.clientId || ''); setAppForm({ issuer: added.oauthClient?.issuer, redirectUri: added.redirectUri }); }}>{added.oauthClient ? 'App settings' : 'Set up app'}</button>}
    {appFormView(added.id)}
    {added.oauth && added.oauthClient && added.error && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void signInTab(async () => { const r = await apiFetch(`/api/mcp-oauth/${encodeURIComponent(added.id)}/connect`, { method: 'POST' }); const d = await r.json(); if (!r.ok) { setNote({ text: d.error || 'Could not start sign-in.', error: true }); return null; } pollAdded(); return d.signIn; })}>Sign in</button>}
    {fields.length > 0 && !form && <button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Change key for ${item.name}`} onClick={() => setForm(true)}>Change key</button>}
    <button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Remove ${item.name}`} onClick={() => void call('DELETE')}>{busy && !form ? 'Removing…' : 'Remove'}</button>
    {form && keyForm('Save key', 'PUT')}{msg}
  </span>;
  if (!item.installable) return <span className="plugin-add"><small>{item.notInstallable || 'Cannot be added'}</small></span>;
  if (form) return <span className="plugin-add">{keyForm('Add', 'POST')}{msg}</span>;
  return <span className="plugin-add">
    {item.needsKey && <span className="badge count">Needs a key</span>}
    <button className="btn btn-secondary btn-sm plugin-card-link" disabled={busy} aria-label={`Add ${item.name} to noevia`} onClick={() => (fields.length ? setForm(true) : void call('POST'))}>{busy ? 'Checking…' : 'Add'}</button>{msg}
  </span>;
}

/** Plugins → Connected: MCP servers that need each person's own sign-in. */
function SignInServers(): JSX.Element | null {
  const [servers, setServers] = useState<{ id: string; title: string; connected: boolean }[]>([]);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const load = () => apiFetch('/api/mcp-oauth/servers').then((r) => r.json()).then((d) => setServers(d.servers || [])).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  if (!servers.length) return null;
  const connect = (id: string) => void signInTab(async () => {
    const r = await apiFetch(`/api/mcp-oauth/${encodeURIComponent(id)}/connect`, { method: 'POST' }); const d = await r.json().catch(() => ({}));
    if (!r.ok) { setNote({ text: d.error || 'Could not start sign-in.', error: true }); return null; }
    setNote({ text: 'Finish signing in in the new tab.' });
    let n = 0; const t = window.setInterval(async () => {
      n++;
      const d = await apiFetch('/api/mcp-oauth/servers').then((r) => r.json()).catch(() => null);
      if (d?.servers) setServers(d.servers);
      if (d?.servers?.find((x: { id: string; connected: boolean }) => x.id === id)?.connected) { window.clearInterval(t); setNote({ text: 'Signed in.' }); }
      else if (n > 60) window.clearInterval(t);
    }, 3000);
    return d.signIn;
  }).catch((e) => setNote({ text: (e as Error).message, error: true }));
  const disconnect = async (id: string) => { await apiFetch(`/api/mcp-oauth/${encodeURIComponent(id)}`, { method: 'DELETE' }); setNote({ text: 'Disconnected.' }); void load(); };
  return <section className="sign-in-servers" aria-label="MCP servers you sign in to">
    <h2>MCP servers you sign in to</h2>
    <p className="plugins-note">Your own account on each service. Its tools appear in projects that chose the server once you are signed in, and every call asks first.</p>
    <ul className="plugin-grid">
      {servers.map((s) => <li key={s.id} className="plugin-card surface">
        <span className="plugin-card-icon"><ShellIcon name="server" size={20}/></span>
        <span className="plugin-card-text"><b>{s.title}</b><small>{s.connected ? 'Signed in' : 'Not signed in'}</small></span>
        <span className="plugin-card-actions">{s.connected
          ? <button className="btn btn-ghost btn-sm" aria-label={`Disconnect ${s.title}`} onClick={() => void disconnect(s.id)}>Disconnect</button>
          : <button className="btn btn-secondary btn-sm" aria-label={`Sign in to ${s.title}`} onClick={() => connect(s.id)}>Sign in</button>}</span>
      </li>)}
    </ul>
    {note && <small role={note.error ? 'alert' : 'status'} className={note.error ? 'plugin-add-error' : ''}>{note.text}</small>}
  </section>;
}

/** Plugins → Connected: servers where each person adds their own key. */
function KeyServers(): JSX.Element | null {
  const [servers, setServers] = useState<{ id: string; title: string; headers: KeyHeader[]; hasKey: boolean }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const load = () => apiFetch('/api/mcp-keys/servers').then((r) => r.json()).then((d) => setServers(d.servers || [])).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  if (!servers.length) return null;
  const save = async (id: string) => {
    setBusy(true); setNote(null);
    try {
      const r = await apiFetch(`/api/mcp-keys/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ headers: values }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'The key was not accepted.');
      setOpen(null); setValues({}); setNote({ text: 'Key saved. Its tools now appear in projects that chose this server.' }); void load();
    } catch (e) { setNote({ text: (e as Error).message, error: true }); } finally { setBusy(false); }
  };
  const remove = async (id: string) => { await apiFetch(`/api/mcp-keys/${encodeURIComponent(id)}`, { method: 'DELETE' }); setNote({ text: 'Key removed.' }); void load(); };
  return <section className="sign-in-servers" aria-label="MCP servers that use your own key">
    <h2>MCP servers that use your own key</h2>
    <p className="plugins-note">Your own key for each service, stored encrypted and used only for your requests. Its tools appear in projects that chose the server once you have added it, and every call asks first.</p>
    <ul className="plugin-grid">
      {servers.map((s) => <li key={s.id} className="plugin-card surface">
        <span className="plugin-card-icon"><ShellIcon name="server" size={20}/></span>
        <span className="plugin-card-text"><b>{s.title}</b><small>{s.hasKey ? 'Your key is set' : 'No key yet'}</small></span>
        <span className="plugin-card-actions">
          {open !== s.id && <span className="plugin-add">
            <button className="btn btn-secondary btn-sm" aria-label={`${s.hasKey ? 'Change' : 'Add'} your key for ${s.title}`} onClick={() => { setOpen(s.id); setValues({}); setNote(null); }}>{s.hasKey ? 'Change key' : 'Add key'}</button>
            {s.hasKey && <button className="btn btn-ghost btn-sm" aria-label={`Remove your key for ${s.title}`} onClick={() => void remove(s.id)}>Remove key</button>}
          </span>}
          {open === s.id && <form className="plugin-key-form" onSubmit={(e) => { e.preventDefault(); void save(s.id); }}>
            {s.headers.map((h) => <label key={h.name}><span>{h.name}{h.required ? '' : ' (optional)'}</span>{h.description && <small>{h.description}</small>}
              <input type={h.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} required={h.required} placeholder={h.template ? h.template.replace(/\{([^}]+)\}/, '$1') : ''}
                value={values[h.name] || ''} onChange={(e) => setValues((v) => ({ ...v, [h.name]: e.target.value }))}/></label>)}
            <span className="plugin-key-actions"><button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Checking…' : 'Save key'}</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOpen(null)}>Cancel</button></span>
          </form>}
        </span>
      </li>)}
    </ul>
    {note && <small role={note.error ? 'alert' : 'status'} className={note.error ? 'plugin-add-error' : ''}>{note.text}</small>}
  </section>;
}

/** Administrators add any MCP server by its address, with an optional sign-in header. */
function AddByUrl({ onChange }: { onChange: (servers: Added[]) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', url: '', headerName: '', headerValue: '', keyMode: 'personal' as 'personal' | 'shared' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = () => void signInTab(async () => {
    setBusy(true); setNote(null);
    try {
      const r = await apiFetch('/api/admin/mcp-directory/custom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setNote({ text: d.error || 'That did not work.', error: true }); return null; }
      onChange(d.servers || []);
      if (d.signIn) { setNote({ text: 'Finish signing in in the new tab.' }); return d.signIn; }
      if (d.needsClient) { setNote({ text: 'This server needs an app registered by hand. Use “Set up app” on its card below.', error: true }); setOpen(false); return null; }
      setNote({ text: `Added with ${tools(d.server?.toolCount ?? 0)}. Choose it under a project’s Tools.` });
      setOpen(false); setForm({ title: '', url: '', headerName: '', headerValue: '', keyMode: 'personal' });
      return null;
    } finally { setBusy(false); }
  }).catch((e) => setNote({ text: (e as Error).message, error: true }));
  if (!open) return <p className="plugins-note"><button className="btn btn-secondary btn-sm" onClick={() => { setOpen(true); setNote(null); }}>Add a server by URL</button>{note && <> <span role={note.error ? 'alert' : 'status'} className={note.error ? 'plugin-add-error' : ''}>{note.text}</span></>}</p>;
  return <form className="plugin-key-form plugin-url-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
    <label><span>Name</span><input required value={form.title} onChange={set('title')} placeholder="What this server is"/></label>
    <label><span>Address</span><input required type="url" inputMode="url" autoComplete="off" spellCheck={false} value={form.url} onChange={set('url')} placeholder="https://example.com/mcp"/></label>
    <label><span>Sign-in header (optional)</span><input autoComplete="off" spellCheck={false} value={form.headerName} onChange={set('headerName')} placeholder="Authorization"/></label>
    {form.headerName && <label><span>Its value</span><input type="password" autoComplete="off" value={form.headerValue} onChange={set('headerValue')} placeholder="Bearer …"/></label>}
    {form.headerName && <fieldset className="plugin-key-mode"><legend>Who uses this key</legend>
      <label><input type="radio" name="url-mode" checked={form.keyMode === 'personal'} onChange={() => setForm((f) => ({ ...f, keyMode: 'personal' }))}/> Each person uses their own key</label>
      <label><input type="radio" name="url-mode" checked={form.keyMode === 'shared'} onChange={() => setForm((f) => ({ ...f, keyMode: 'shared' }))}/> Everyone uses this key</label>
    </fieldset>}
    <small className="plugin-key-note">noevia checks the address is a public https host and that the server answers before saving it. If it asks for a sign-in instead, you will be sent to sign in. It becomes its own toolbox, gets no passwords, and every one of its tools asks before it runs.</small>
    <span className="plugin-key-actions"><button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Checking…' : 'Add server'}</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></span>
    {note && <small role={note.error ? 'alert' : 'status'} className={note.error ? 'plugin-add-error' : ''}>{note.text}</small>}
  </form>;
}
