import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { readConversationsFile } from './readExport';
import { notifyWorkspaceChanged } from './workspace-changed';
import { useArchivedCount } from './ArchivedChats';
import { RetentionSetting } from './RetentionSetting';
import { useT } from '../../i18n';

/** Settings → Your data & privacy. Export is the user's own chats; nothing here reaches other
 *  accounts. Archived chats are managed in their own view (#232) so a long archive never buries
 *  the controls above; this page keeps a count and the way there. */
export function DataSettings({ onManageArchived }: { onManageArchived?: () => void } = {}): JSX.Element {
  const t = useT();
  const archived = useArchivedCount();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  const importConversations = async (file: File) => {
    setBusy(true); setStatus(t('data.reading', { file: file.name })); setError('');
    try {
      const text = await readConversationsFile(file);
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw Error(t('data.chooseExport')); }
      setStatus(t('data.importing'));
      const response = await apiFetch('/api/import/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(body.error || t('data.importFailed'));
      const skipped = Array.isArray(body.skipped) ? body.skipped.length : 0;
      setStatus([
        t.plural('data.imported', Number(body.imported) || 0),
        skipped ? t.plural('data.skipped', skipped) : '',
        body.projectsCreated ? t.plural('data.projectsCreated', Number(body.projectsCreated)) : '',
      ].filter(Boolean).join(' '));
      notifyWorkspaceChanged();
    } catch (e) {
      setStatus(''); setError(e instanceof Error ? e.message : t('data.importFailed'));
    } finally { setBusy(false); if (picker.current) picker.current.value = ''; }
  };

  const exportConversations = async () => {
    setBusy(true); setStatus(t('data.preparing')); setError('');
    try {
      const response = await apiFetch('/api/export/conversations');
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw Error(body.error || t('data.exportFailed')); }
      if (!response.headers.get('content-type')?.startsWith('application/zip')) throw Error(t('data.exportFailed'));
      const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || 'noevia-conversations.zip';
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus(t('data.downloaded', { file: name }));
    } catch (e) {
      setStatus(''); setError(e instanceof Error ? e.message : t('data.exportFailed'));
    } finally { setBusy(false); }
  };

  return <>
    <div className="settings-title"><h1>{t('settings.section.data')}</h1><p>{t('data.intro')}</p></div>
    <section className="settings-section">
      <h2>{t('data.exportImport')}</h2>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">{t('data.export')}</span><span className="set-row-desc">{t('data.exportDesc')}</span></div>
          <div className="set-row-control"><button className="modal-btn secondary" disabled={busy} onClick={() => void exportConversations()}>{busy ? t('data.exporting') : t('data.exportButton')}</button></div>
        </div>
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">{t('data.import')}</span><span className="set-row-desc">{t('data.importDesc')}</span></div>
          <div className="set-row-control">
            <input ref={picker} type="file" accept=".zip,.json,application/zip,application/json" hidden aria-label={t('data.file')} onChange={(e) => { const file = e.currentTarget.files?.[0]; if (file) void importConversations(file); }} />
            <button className="modal-btn secondary" disabled={busy} onClick={() => picker.current?.click()}>{t('data.importButton')}</button>
          </div>
        </div>
      </div>
      {status && <p className="route-note" role="status">{status}</p>}
      {error && <p className="modal-err" role="alert">{error}</p>}
    </section>
    <section className="settings-section">
      <h2>{t('data.retention')}</h2>
      <div className="set-rows"><RetentionSetting /></div>
    </section>
    <section className="settings-section">
      <h2>{t('data.archived')}</h2>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">{archived === null ? t('data.archived') : t.plural('data.archivedCount', archived)}</span><span className="set-row-desc">{t('data.archivedDesc')}</span></div>
          <div className="set-row-control"><button className="modal-btn secondary" disabled={!onManageArchived} onClick={onManageArchived}>{t('data.manageArchived')}</button></div>
        </div>
      </div>
    </section>
  </>;
}
