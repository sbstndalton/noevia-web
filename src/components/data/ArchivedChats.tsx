import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { fetchWorkspace, saveFreeChats, saveProjectChats } from '../../api';
import { collectArchived, filterArchived, rowKey } from '../../archived-chats';
import type { ArchivedRow } from '../../archived-chats';
import { appLocale } from '../../user-preferences';
import { ConfirmDialog } from '../ContextMenu';
import { ShellIcon } from '../ShellIcon';
import { notifyWorkspaceChanged, useWorkspaceChanged } from './workspace-changed';

const PAGE = 50;

/** How many chats are archived, for the summary in Your data & privacy. Null while loading or on error. */
export function useArchivedCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  const load = useCallback(() => { fetchWorkspace().then((w) => setCount(collectArchived(w).length)).catch(() => setCount(null)); }, []);
  useEffect(load, [load]);
  useWorkspaceChanged(load);
  return count;
}

/** Archived chats (#232): a focused view outside Settings, reached from the sidebar and from
 *  Your data & privacy. Search by title or project, restore or delete one or many. Deleting asks
 *  first and goes through App's delete so an open copy of the chat is forgotten too. */
export function ArchivedChatsView({ onDelete, onOpenData }: { onDelete: (projectId: string | null, chatId: string) => Promise<boolean>; onOpenData?: () => void }): JSX.Element {
  const [rows, setRows] = useState<ArchivedRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<ArchivedRow[] | null>(null);

  const load = useCallback(() => {
    fetchWorkspace().then((w) => {
      const next = collectArchived(w);
      setRows(next); setError('');
      setSelected((s) => new Set([...s].filter((k) => next.some((r) => rowKey(r) === k))));
    }).catch(() => setError('Archived chats could not be loaded. Check your connection and try again.'));
  }, []);
  useEffect(load, [load]);
  useWorkspaceChanged(load);

  const visible = useMemo(() => filterArchived(rows ?? [], query), [rows, query]);
  const page = visible.slice(0, shown);
  const chosen = (rows ?? []).filter((r) => selected.has(rowKey(r)));
  const toggle = (r: ArchivedRow) => setSelected((s) => { const n = new Set(s); if (n.has(rowKey(r))) n.delete(rowKey(r)); else n.add(rowKey(r)); return n; });
  const allOnPage = page.length > 0 && page.every((r) => selected.has(rowKey(r)));
  const date = (ms?: number) => (ms ? new Date(ms).toLocaleDateString(appLocale(), { dateStyle: 'medium' }) : '');

  const restore = async (list: ArchivedRow[]) => {
    setBusy(true); setStatus(''); setError('');
    // Chat list saves merge by id on the server, so each list gets only the entries that change.
    const groups = new Map<string | null, ArchivedRow[]>();
    for (const r of list) groups.set(r.projectId, [...(groups.get(r.projectId) || []), r]);
    let failed = 0;
    for (const [projectId, group] of groups) {
      const next = group.map((r) => ({ ...r.chat, archived: false }));
      try { await (projectId ? saveProjectChats(projectId, next) : saveFreeChats(next)); } catch { failed += group.length; }
    }
    const done = list.length - failed;
    if (done) setStatus(`Restored ${done} chat${done === 1 ? '' : 's'} to the sidebar.`);
    if (failed) setError(`${failed} chat${failed === 1 ? '' : 's'} could not be restored. Try again.`);
    setSelected(new Set()); setBusy(false);
    notifyWorkspaceChanged();
  };

  const remove = async (list: ArchivedRow[]) => {
    setBusy(true); setStatus(''); setError('');
    let failed = 0;
    for (const r of list) if (!(await onDelete(r.projectId, r.chat.id))) failed += 1;
    const done = list.length - failed;
    if (done) setStatus(`Deleted ${done} chat${done === 1 ? '' : 's'} permanently.`);
    if (failed) setError(`${failed} chat${failed === 1 ? '' : 's'} could not be deleted. Try again.`);
    setSelected(new Set()); setBusy(false);
    notifyWorkspaceChanged();
  };

  return <main className="main archived-view">
    <div className="archived-page">
      <header className="archived-head">
        <h1>Archived chats</h1>
        <p>Archived chats are hidden from the sidebar but kept until you delete them. {onOpenData && <>Want a copy first? <button className="link-button" onClick={onOpenData}>Export from Your data &amp; privacy</button>.</>}</p>
        <div className="settings-search archived-search"><ShellIcon name="search" size={16}/><input aria-label="Search archived chats" placeholder="Search by title or project" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} /></div>
      </header>
      {error && <p className="modal-err" role="alert">{error} <button className="btn btn-secondary btn-sm" onClick={load}>Try again</button></p>}
      {status && <p className="route-note" role="status">{status}</p>}
      {rows === null && !error && <p className="route-note" role="status">Loading archived chats…</p>}
      {rows?.length === 0 && <p className="route-note">No archived chats. Archive a chat from its menu in the sidebar to tidy it away.</p>}
      {!!rows?.length && <>
        <div className="archived-toolbar" role="toolbar" aria-label="Selected chats">
          <label className="archived-check"><input type="checkbox" checked={allOnPage} disabled={busy || !page.length} onChange={() => setSelected((s) => { const n = new Set(s); page.forEach((r) => (allOnPage ? n.delete(rowKey(r)) : n.add(rowKey(r)))); return n; })} />Select shown</label>
          <span className="archived-count" aria-live="polite">{chosen.length ? `${chosen.length} selected` : `${visible.length} of ${rows.length}`}</span>
          <button className="btn btn-secondary btn-sm" disabled={busy || !chosen.length} onClick={() => void restore(chosen)}>Restore selected</button>
          <button className="btn btn-danger btn-sm" disabled={busy || !chosen.length} onClick={() => setConfirm(chosen)}>Delete selected…</button>
        </div>
        {!visible.length && <p className="route-note" role="status">No archived chat matches “{query}”.</p>}
        <ul className="archived-chat-list" aria-label="Archived chats">
          {page.map((row) => <li key={rowKey(row)} className={selected.has(rowKey(row)) ? 'is-selected' : ''}>
            <input type="checkbox" aria-label={`Select ${row.chat.title || 'untitled chat'}`} checked={selected.has(rowKey(row))} disabled={busy} onChange={() => toggle(row)} />
            <span className="archived-chat-text"><span className="archived-chat-title">{row.chat.title || 'Untitled chat'}</span>
              <span className="archived-chat-meta">{row.projectName ? `${row.projectName} · ` : 'No project · '}Last activity {date(row.chat.updatedAt) || 'unknown'}</span></span>
            <span className="archived-chat-actions">
              <button className="btn btn-secondary btn-sm" disabled={busy} aria-label={`Restore ${row.chat.title || 'untitled chat'}`} onClick={() => void restore([row])}>Restore</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Delete ${row.chat.title || 'untitled chat'}`} onClick={() => setConfirm([row])}>Delete…</button>
            </span>
          </li>)}
        </ul>
        {visible.length > shown && <button className="btn btn-secondary archived-more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more</button>}
      </>}
    </div>
    {confirm && <ConfirmDialog danger title={confirm.length === 1 ? 'Delete this chat?' : `Delete ${confirm.length} chats?`}
      body={`${confirm.length === 1 ? `“${confirm[0].chat.title || 'Untitled chat'}” and its messages` : 'These chats and their messages'} will be deleted permanently. This cannot be undone; restoring is no longer possible afterwards.`}
      confirmLabel={confirm.length === 1 ? 'Delete chat' : `Delete ${confirm.length} chats`} onCancel={() => setConfirm(null)} onConfirm={() => { const list = confirm; setConfirm(null); void remove(list); }} />}
  </main>;
}
