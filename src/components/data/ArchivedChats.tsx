import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { fetchWorkspace, saveFreeChats, saveProjectChats } from '../../api';
import type { ChatMeta } from '../../types';
import { notifyWorkspaceChanged, useWorkspaceChanged } from './workspace-changed';

type Row = { chat: ChatMeta; projectId: string | null; projectName: string | null };

/** Archiving hides a chat from the sidebar; this is the one place it can be found and restored. */
export function ArchivedChats(): JSX.Element {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchWorkspace().then((w) => {
      const free = (w.freeChats || []).filter((c) => c.archived).map((chat) => ({ chat, projectId: null, projectName: null }));
      const inProjects = (w.projects || []).flatMap((p) => (p.chats || []).filter((c) => c.archived).map((chat) => ({ chat, projectId: p.id, projectName: p.name })));
      setRows([...free, ...inProjects].sort((a, b) => (b.chat.updatedAt || 0) - (a.chat.updatedAt || 0)));
      setError('');
    }).catch(() => setError('Archived chats could not be loaded.'));
  }, []);
  useEffect(load, [load]);
  useWorkspaceChanged(load);

  const restore = async (row: Row) => {
    setBusy(row.chat.id); setError('');
    try {
      // Chat list saves merge by id on the server, so sending one entry changes only that chat.
      const next = [{ ...row.chat, archived: false }];
      await (row.projectId ? saveProjectChats(row.projectId, next) : saveFreeChats(next));
      notifyWorkspaceChanged();
    } catch { setError('That chat could not be restored. Try again.'); }
    finally { setBusy(null); }
  };

  return <div className="archived-chats">
    {error && <p className="modal-err" role="alert">{error}</p>}
    {rows === null && !error && <p className="route-note" role="status">Loading archived chats…</p>}
    {rows?.length === 0 && <p className="route-note">No archived chats. Archive a chat from its menu in the sidebar to tidy it away.</p>}
    {!!rows?.length && <ul className="archived-chat-list set-rows" aria-label="Archived chats">
      {rows.map((row) => <li key={row.chat.id}>
        <span className="archived-chat-text"><span className="archived-chat-title">{row.chat.title || 'Untitled chat'}</span>
          <span className="archived-chat-meta">{row.projectName ? `${row.projectName} · ` : ''}{row.chat.updatedAt ? new Date(row.chat.updatedAt).toLocaleDateString() : ''}</span></span>
        <button className="modal-btn secondary" disabled={busy !== null} aria-label={`Restore ${row.chat.title || 'untitled chat'}`} onClick={() => void restore(row)}>{busy === row.chat.id ? 'Restoring…' : 'Restore'}</button>
      </li>)}
    </ul>}
  </div>;
}
