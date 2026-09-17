import { useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';

/** Settings → Data. Export is the user's own chats; nothing here reaches other accounts. */
export function DataSettings(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

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
    <div className="settings-title"><h1>Data</h1><p>Take your conversations with you.</p></div>
    <section className="settings-section">
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">Export conversations</span><span className="set-row-desc">A ZIP with every chat as a Markdown file, grouped by project, plus one JSON file with everything. Thinking text is not included. Diary files have their own export in Diary.</span></div>
          <div className="set-row-control"><button className="modal-btn secondary" disabled={busy} onClick={() => void exportConversations()}>{busy ? 'Exporting…' : 'Export'}</button></div>
        </div>
      </div>
      {status && <p className="route-note" role="status">{status}</p>}
      {error && <p className="modal-err" role="alert">{error}</p>}
    </section>
  </>;
}
