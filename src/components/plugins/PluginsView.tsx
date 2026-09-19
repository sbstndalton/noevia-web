import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch, fetchProfile } from '../../api';
import { ShellIcon } from '../ShellIcon';
import { SegmentedControl } from '../SegmentedControl';
import { ConnectorsSettings } from '../connectors/ConnectorsSettings';

type Tab = 'connected' | 'mcp' | 'skills';
interface Item { id: string; name: string; publisher: string; description: string; version: string; url: string; remote: boolean }

/** Plugins: the integrations you use (Google Drive and friends) plus a read-only directory of
 *  MCP servers and skills other people publish. Connecting moved here from Settings
 *  (user review, 2026-09-19); off-site backups still use the same Drive connection. */
export function PluginsView({ onStartChat, embedded = false }: { onStartChat?: (prompt: string) => void; embedded?: boolean }): JSX.Element {
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
      ? <div className="plugins-connected"><ConnectorsSettings hideTitle isAdmin={isAdmin} onStartChat={onStartChat}/></div>
      : <Directory key={tab} kind={tab}/>}
  </div>;
  return embedded ? body : <main className="main plugins-view">{body}</main>;
}

function Directory({ kind }: { kind: 'mcp' | 'skills' }): JSX.Element {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [source, setSource] = useState<{ label: string; home: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
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
  return <section className="plugins-directory" aria-label={kind === 'mcp' ? 'MCP servers' : 'Skills'}>
    <div className="settings-search plugins-search"><ShellIcon name="search" size={16}/><input aria-label={kind === 'mcp' ? 'Search MCP servers' : 'Search skills'} placeholder={kind === 'mcp' ? 'Search MCP servers' : 'Search skills'} value={query} onChange={(e) => setQuery(e.target.value)}/></div>
    <p className="plugins-note">{kind === 'mcp'
      ? 'Published by their authors in the public MCP registry, not reviewed by noevia. Adding a server from here is coming later; for now an administrator adds MCP servers to the server configuration.'
      : 'Skills published by Anthropic. Skills work inside a project: add a skill’s SKILL.md to the project’s files and enable it under the project’s instruction skills.'}
      {source && <> Source: <a href={source.home} target="_blank" rel="noreferrer noopener">{source.label}</a>.</>}</p>
    {error && <p className="route-note" role="alert">{error} <button className="btn btn-secondary btn-sm" onClick={() => setAttempt((n) => n + 1)}>Try again</button></p>}
    {items === null ? <p className="plugins-note" aria-live="polite">Loading…</p> : !error && items.length === 0 ? <p className="plugins-note">Nothing matches “{query}”.</p> : null}
    <ul className="plugin-grid">
      {items?.map((i) => <li key={i.id} className="plugin-card surface">
        <span className="plugin-card-icon"><ShellIcon name={kind === 'mcp' ? 'server' : 'sparkles'} size={20}/></span>
        <span className="plugin-card-text">
          <b>{i.name}</b>
          {i.publisher && <small className="plugin-publisher">{i.publisher}{i.version && ` · v${i.version}`}{i.remote && ' · hosted'}</small>}
          {i.description && <small>{i.description}</small>}
        </span>
        {i.url && <a className="btn btn-secondary btn-sm plugin-card-link" href={i.url} target="_blank" rel="noreferrer noopener" aria-label={`View ${i.name}`}>View</a>}
      </li>)}
    </ul>
  </section>;
}
