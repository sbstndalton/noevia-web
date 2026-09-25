import { useEffect, useId, useState } from 'react';
import type { JSX } from 'react';
import { fetchStorage, pollNextcloud, saveStorage, startNextcloud, testStorage } from '../api';
import type { StorageConnection } from '../api';
import { useT } from '../i18n';

export interface StoragePickerProps {
  /** Called after storage is saved. Receives the saved connection. */
  onSaved?: (connection: StorageConnection) => void;
  /** Skip path — shown in the wizard, hidden in Settings. */
  onSkip?: () => void;
  onlineOnly?: boolean;
  backupOnly?: boolean;
}

/** Diary storage backend picker (local / Nextcloud / generic WebDAV), shared by
 *  the setup wizard (step 3) and Settings → Diary storage. */
export function StoragePicker({ onSaved, onSkip, onlineOnly = false, backupOnly = false }: StoragePickerProps): JSX.Element {
  const id = useId();
  const t = useT();
  const [value, setValue] = useState<StorageConnection>({ kind: onlineOnly ? 'nextcloud' : 'local', baseUrl: '', username: '', corpusRoot: '' });
  const [loaded, setLoaded] = useState(false);
  const [loadedKind, setLoadedKind] = useState<StorageConnection['kind'] | null>(null);
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The fields stay locked until the saved connection is known, so an edit can't overwrite
  // settings that simply hadn't loaded yet. Say so, and don't wait forever.
  useEffect(() => {
    let live = true;
    setLoadFailed(false); setMessage('');
    const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 10000));
    void Promise.race([fetchStorage(), timeout])
      .then(v => {
        if (!live) return;
        const next = (onlineOnly && v.kind === 'local') || (backupOnly && v.kind === 's3')
          ? { kind: 'nextcloud', baseUrl: '', username: '', corpusRoot: 'Cowork/Diary' } as StorageConnection
          : v;
        setValue(next);
        setLoadedKind(next.kind);
        setLoaded(true);
      })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [attempt]);
  const patch = (next: Partial<StorageConnection>) => setValue((v) => ({ ...v, ...next }));

  const connectNextcloud = async () => {
    const flow = await startNextcloud(value.baseUrl);
    window.open(flow.loginUrl, '_blank', 'noopener,noreferrer');
    setMessage(t('storage.grantHint'));
    sessionStorage.setItem('cowork-nextcloud-flow', flow.flowId);
  };
  const finishNextcloud = async () => {
    const id = sessionStorage.getItem('cowork-nextcloud-flow') || '';
    const result = await pollNextcloud(id, value.corpusRoot || 'Cowork/Diary');
    if (result.pending) setMessage(t('storage.waiting'));
    else {
      setValue(result);
      setMessage(t('storage.connected'));
      sessionStorage.removeItem('cowork-nextcloud-flow');
      onSaved?.(result);
    }
  };

  const save = async () => {
    const saved = await saveStorage({ ...value, secret });
    setValue(saved);
    setLoadedKind(saved.kind);
    setSecret('');
    setMessage(t('storage.saved'));
    onSaved?.(saved);
  };
  const test = async () => {
    await testStorage({ ...value, secret, useSavedSecret: value.kind === loadedKind && !!value.secretConfigured && !secret });
    setMessage(t('storage.tested'));
  };

  return (
    <div className="card-list" style={{ padding: 12, gap: 8 }}>
      {!loaded && !loadFailed && <p className="route-note" role="status">{t('storage.loading')}</p>}
      {loadFailed && <div role="alert"><p className="route-note">{t('storage.loadFailed')}</p>
        <button type="button" className="modal-btn secondary" onClick={() => setAttempt(n => n + 1)}>{t('storage.tryAgain')}</button></div>}
      {backupOnly && <p className="diary-context-note">{t('storage.backupNote')}</p>}
      <label className="modal-label" htmlFor={`${id}-kind`}>{t('storage.type')}</label>
      <select
        id={`${id}-kind`}
        className="modal-input"
        disabled={!loaded}
        value={value.kind}
        onChange={(e) => patch({ kind: e.target.value as StorageConnection['kind'] })}
      >
        {!onlineOnly && <option value="local">{t('storage.kind.local')}</option>}
        <option value="nextcloud">Nextcloud</option>
        <option value="webdav">{t('storage.kind.webdav')}</option>
        {!backupOnly && <option value="s3">{t('storage.kind.s3')}</option>}
      </select>
      {value.kind !== 'local' && (
        <>
          <label className="modal-label" htmlFor={`${id}-baseUrl`}>{value.kind === 'nextcloud' ? t('storage.nextcloudUrl') : value.kind === 's3' ? t('storage.endpointUrl') : t('storage.webdavUrl')}</label>
          <input
            id={`${id}-baseUrl`}
            disabled={!loaded}
            className="modal-input"
            placeholder={value.kind === 'nextcloud' ? 'https://cloud.example.com' : value.kind === 's3' ? t('storage.endpointPlaceholder') : t('storage.webdavUrl')}
            value={value.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
          {value.kind === 's3' && (
            <>
              <label className="modal-label" htmlFor={`${id}-bucket`}>{t('storage.bucket')}</label>
              <input
                id={`${id}-bucket`}
                disabled={!loaded}
                className="modal-input"
                placeholder={t('storage.bucket')}
                value={value.bucket || ''}
                onChange={(e) => patch({ bucket: e.target.value })}
              />
              <label className="modal-label" htmlFor={`${id}-region`}>{t('storage.region')}</label>
              <input
                id={`${id}-region`}
                disabled={!loaded}
                className="modal-input"
                placeholder="us-east-1"
                value={value.region || ''}
                onChange={(e) => patch({ region: e.target.value.trim().toLowerCase() })}
              />
            </>
          )}
          <label className="modal-label" htmlFor={`${id}-corpusRoot`}>{value.kind === 's3' ? t('storage.bucketFolder') : t('storage.corpusFolder')}</label>
          <input
            id={`${id}-corpusRoot`}
            disabled={!loaded}
            className="modal-input"
            placeholder={value.kind === 's3' ? t('storage.bucketFolder') : t('storage.corpusFolder')}
            value={value.corpusRoot}
            onChange={(e) => patch({ corpusRoot: e.target.value })}
          />
        </>
      )}
      {(value.kind === 'webdav' || value.kind === 's3') && (
        <>
          <label className="modal-label" htmlFor={`${id}-username`}>{value.kind === 's3' ? t('storage.accessKey') : t('storage.username')}</label>
          <input
            id={`${id}-username`}
            disabled={!loaded}
            className="modal-input"
            placeholder={t('storage.username')}
            value={value.username}
            onChange={(e) => patch({ username: e.target.value })}
          />
          <label className="modal-label" htmlFor={`${id}-secret`}>{value.kind === 's3' ? t('storage.secretKey') : t('storage.appPassword')}</label>
          <input
            id={`${id}-secret`}
            disabled={!loaded}
            className="modal-input"
            type="password"
            aria-describedby={value.kind === loadedKind && value.secretConfigured ? `${id}-secret-help` : undefined}
            placeholder={value.kind === 's3' ? t('storage.secretKey') : t('storage.appPassword')}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          {value.kind === loadedKind && value.secretNeedsReauth && <p className="route-note">{t('storage.reauth')}</p>}
          {value.kind === loadedKind && value.secretConfigured && <p id={`${id}-secret-help`} className="route-note">{t('storage.secretSaved')}</p>}
        </>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {value.kind === 'nextcloud' ? (
          <>
            <button
              className="modal-btn primary"
              disabled={!loaded}
              onClick={() => void connectNextcloud().catch((e) => setMessage(String(e)))}
            >
              {t('storage.grant')}
            </button>
            <button
              className="modal-btn secondary"
              disabled={!loaded}
              onClick={() => void finishNextcloud().catch((e) => setMessage(String(e)))}
            >
              {t('storage.finish')}
            </button>
          </>
        ) : (
          <>
            <button disabled={!loaded} className="modal-btn primary" onClick={() => void save().catch((e) => setMessage(String(e)))}>
              {t('common.save')}
            </button>
            <button disabled={!loaded} className="modal-btn secondary" onClick={() => void test().catch((e) => setMessage(String(e)))}>
              {t('storage.test')}
            </button>
          </>
        )}
        {onSkip && (
          <button
            className="modal-btn secondary"
            onClick={() => {
              sessionStorage.removeItem('cowork-nextcloud-flow');
              onSkip();
            }}
          >
            {t('storage.skip')}
          </button>
        )}
      </div>
      {message && <p className="route-note">{message}</p>}
    </div>
  );
}
