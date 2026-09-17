import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { readConversationsFile } from './readExport';
import { notifyWorkspaceChanged } from './workspace-changed';
import { ArchivedChats } from './ArchivedChats';

/** Settings → Data. Export is the user's own chats; nothing here reaches other accounts. */
export function DataSettings(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  const importConversations = async (file: File) => {
    setBusy(true); setStatus(`Reading ${file.name}…`); setError('');
    try {
      const text = await readConversationsFile(file);
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw Error('Choose a conversations.json from a noevia conversations export.'); }
      setStatus('Importing…');
      const response = await apiFetch('/api/import/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(body.error || 'Import failed. Try again.');
      const skipped = Array.isArray(body.skipped) ? body.skipped.length : 0;
      setStatus([
        `Imported ${body.imported} chat${body.imported === 1 ? '' : 's'}.`,
        skipped ? `${skipped} ${skipped === 1 ? 'was' : 'were'} already here.` : '',
        body.projectsCreated ? `Created ${body.projectsCreated} project${body.projectsCreated === 1 ? '' : 's'}.` : '',
      ].filter(Boolean).join(' '));
      notifyWorkspaceChanged();
    } catch (e) {
      setStatus(''); setError(e instanceof Error ? e.message : 'Import failed. Try again.');
    } finally { setBusy(false); if (picker.current) picker.current.value = ''; }
  };

  const exportConversations = async () => {
    setBusy(true); setStatus('Preparing your export…'); setError('');
    try {
      const response = await apiFetch('/api/export/conversations');
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw Error(body.error || 'Export failed. Try again.'); }
      if (!response.headers.get('content-type')?.startsWith('application/zip')) throw Error('Export failed. Try again.');
      const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || 'noevia-conversations.zip';
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus(`Downloaded ${name}.`);
    } catch (e) {
      setStatus(''); setError(e instanceof Error ? e.message : 'Export failed. Try again.');
    } finally { setBusy(false); }
  };

  return <>
    <div className="settings-title"><h1>Data</h1><p>Take your conversations with you, or bring them back.</p></div>
    <section className="settings-section">
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">Export conversations</span><span className="set-row-desc">A ZIP with every chat as a Markdown file, grouped by project, plus one JSON file with everything. Thinking text is not included. Diary files have their own export in Diary.</span></div>
          <div className="set-row-control"><button className="modal-btn secondary" disabled={busy} onClick={() => void exportConversations()}>{busy ? 'Exporting…' : 'Export'}</button></div>
        </div>
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">Import conversations</span><span className="set-row-desc">Choose an export ZIP or its conversations.json. Chats are added, never replaced; ones already here are skipped, and missing projects are created.</span></div>
          <div className="set-row-control">
            <input ref={picker} type="file" accept=".zip,.json,application/zip,application/json" hidden aria-label="Conversations file" onChange={(e) => { const file = e.currentTarget.files?.[0]; if (file) void importConversations(file); }} />
            <button className="modal-btn secondary" disabled={busy} onClick={() => picker.current?.click()}>Import…</button>
          </div>
        </div>
      </div>
      {status && <p className="route-note" role="status">{status}</p>}
      {error && <p className="modal-err" role="alert">{error}</p>}
    </section>
    <section className="settings-section">
      <h2>Archived chats</h2>
      <ArchivedChats />
    </section>
  </>;
}
