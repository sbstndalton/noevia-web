import { useEffect, useId, useState } from 'react';
import type { JSX } from 'react';
import { fetchStorage, pollNextcloud, saveStorage, startNextcloud, testStorage } from '../api';
import type { StorageConnection } from '../api';

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
    setMessage('Grant access in Nextcloud, then click Finish connection.');
    sessionStorage.setItem('cowork-nextcloud-flow', flow.flowId);
  };
  const finishNextcloud = async () => {
    const id = sessionStorage.getItem('cowork-nextcloud-flow') || '';
    const result = await pollNextcloud(id, value.corpusRoot || 'Cowork/Diary');
    if (result.pending) setMessage('Still waiting for Nextcloud approval.');
    else {
      setValue(result);
      setMessage('Nextcloud connected.');
      sessionStorage.removeItem('cowork-nextcloud-flow');
      onSaved?.(result);
    }
  };

  const save = async () => {
    const saved = await saveStorage({ ...value, secret });
    setValue(saved);
    setLoadedKind(saved.kind);
    setSecret('');
    setMessage('Storage saved.');
    onSaved?.(saved);
  };
  const test = async () => {
    await testStorage({ ...value, secret, useSavedSecret: value.kind === loadedKind && !!value.secretConfigured && !secret });
    setMessage('Connection successful.');
  };

  return (
    <div className="card-list" style={{ padding: 12, gap: 8 }}>
      {!loaded && !loadFailed && <p className="route-note" role="status">Loading your saved storage connection…</p>}
      {loadFailed && <div role="alert"><p className="route-note">Your saved storage connection couldn’t be loaded, so these fields are locked to avoid overwriting it. The server may be busy or unreachable.</p>
        <button type="button" className="modal-btn secondary" onClick={() => setAttempt(n => n + 1)}>Try again</button></div>}
      {backupOnly && <p className="diary-context-note">This is your account storage connection, also used by Projects. Changing it changes their connection too. Diary backups support Nextcloud and WebDAV.</p>}
      <label className="modal-label" htmlFor={`${id}-kind`}>Storage type</label>
      <select
        id={`${id}-kind`}
        className="modal-input"
        disabled={!loaded}
        value={value.kind}
        onChange={(e) => patch({ kind: e.target.value as StorageConnection['kind'] })}
      >
        {!onlineOnly && <option value="local">Server storage</option>}
        <option value="nextcloud">Nextcloud</option>
        <option value="webdav">Generic WebDAV</option>
        {!backupOnly && <option value="s3">S3-compatible</option>}
      </select>
      {value.kind !== 'local' && (
        <>
          <label className="modal-label" htmlFor={`${id}-baseUrl`}>{value.kind === 'nextcloud' ? 'Nextcloud URL' : value.kind === 's3' ? 'Endpoint URL' : 'WebDAV base URL'}</label>
          <input
            id={`${id}-baseUrl`}
            disabled={!loaded}
            className="modal-input"
            placeholder={value.kind === 'nextcloud' ? 'https://cloud.example.com' : value.kind === 's3' ? 'Endpoint URL (https://s3.example.com)' : 'WebDAV base URL'}
            value={value.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
          {value.kind === 's3' && (
            <>
              <label className="modal-label" htmlFor={`${id}-bucket`}>Bucket</label>
              <input
                id={`${id}-bucket`}
                disabled={!loaded}
                className="modal-input"
                placeholder="Bucket"
                value={value.bucket || ''}
                onChange={(e) => patch({ bucket: e.target.value })}
              />
            </>
          )}
          <label className="modal-label" htmlFor={`${id}-corpusRoot`}>{value.kind === 's3' ? 'Folder inside the bucket (optional)' : 'Corpus folder'}</label>
          <input
            id={`${id}-corpusRoot`}
            disabled={!loaded}
            className="modal-input"
            placeholder={value.kind === 's3' ? 'Folder inside the bucket (optional)' : 'Corpus folder'}
            value={value.corpusRoot}
            onChange={(e) => patch({ corpusRoot: e.target.value })}
          />
        </>
      )}
      {(value.kind === 'webdav' || value.kind === 's3') && (
        <>
          <label className="modal-label" htmlFor={`${id}-username`}>{value.kind === 's3' ? 'Access key ID' : 'Username'}</label>
          <input
            id={`${id}-username`}
            disabled={!loaded}
            className="modal-input"
            placeholder="Username"
            value={value.username}
            onChange={(e) => patch({ username: e.target.value })}
          />
          <label className="modal-label" htmlFor={`${id}-secret`}>{value.kind === 's3' ? 'Secret access key' : 'App password'}</label>
          <input
            id={`${id}-secret`}
            disabled={!loaded}
            className="modal-input"
            type="password"
            aria-describedby={value.kind === loadedKind && value.secretConfigured ? `${id}-secret-help` : undefined}
            placeholder={value.kind === 's3' ? 'Secret access key' : 'App password'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          {value.kind === loadedKind && value.secretConfigured && <p id={`${id}-secret-help`} className="route-note">A secret is saved. Leave blank to test with it on the same server.</p>}
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
              Grant Nextcloud access
            </button>
            <button
              className="modal-btn secondary"
              disabled={!loaded}
              onClick={() => void finishNextcloud().catch((e) => setMessage(String(e)))}
            >
              Finish connection
            </button>
          </>
        ) : (
          <>
            <button disabled={!loaded} className="modal-btn primary" onClick={() => void save().catch((e) => setMessage(String(e)))}>
              Save
            </button>
            <button disabled={!loaded} className="modal-btn secondary" onClick={() => void test().catch((e) => setMessage(String(e)))}>
              Test
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
            Skip — set up later in Settings
          </button>
        )}
      </div>
      {message && <p className="route-note">{message}</p>}
    </div>
  );
}
