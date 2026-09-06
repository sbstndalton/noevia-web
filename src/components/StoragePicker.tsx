import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { fetchStorage, pollNextcloud, saveStorage, startNextcloud, testStorage } from '../api';
import type { StorageConnection } from '../api';

export interface StoragePickerProps {
  /** Called after storage is saved. Receives the saved connection. */
  onSaved?: (connection: StorageConnection) => void;
  /** Skip path — shown in the wizard, hidden in Settings. */
  onSkip?: () => void;
}

/** Diary storage backend picker (local / Nextcloud / generic WebDAV), shared by
 *  the setup wizard (step 3) and Settings → Diary storage. */
export function StoragePicker({ onSaved, onSkip }: StoragePickerProps): JSX.Element {
  const [value, setValue] = useState<StorageConnection>({ kind: 'local', baseUrl: '', username: '', corpusRoot: '' });
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    void fetchStorage()
      .then(setValue)
      .catch(() => undefined);
  }, []);
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
    setSecret('');
    setMessage('Storage saved.');
    onSaved?.(saved);
  };
  const test = async () => {
    await testStorage(value.secretConfigured && !secret ? { useSaved: true } : { ...value, secret });
    setMessage('Connection successful.');
  };

  return (
    <div className="card-list" style={{ padding: 12, gap: 8 }}>
      <select
        className="modal-input"
        value={value.kind}
        onChange={(e) => patch({ kind: e.target.value as StorageConnection['kind'] })}
      >
        <option value="local">Local storage</option>
        <option value="nextcloud">Nextcloud</option>
        <option value="webdav">Generic WebDAV</option>
      </select>
      {value.kind !== 'local' && (
        <>
          <input
            className="modal-input"
            placeholder={value.kind === 'nextcloud' ? 'https://cloud.example.com' : 'WebDAV base URL'}
            value={value.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
          <input
            className="modal-input"
            placeholder="Corpus folder"
            value={value.corpusRoot}
            onChange={(e) => patch({ corpusRoot: e.target.value })}
          />
        </>
      )}
      {value.kind === 'webdav' && (
        <>
          <input
            className="modal-input"
            placeholder="Username"
            value={value.username}
            onChange={(e) => patch({ username: e.target.value })}
          />
          <input
            className="modal-input"
            type="password"
            placeholder={value.secretConfigured ? 'App password configured' : 'App password'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {value.kind === 'nextcloud' ? (
          <>
            <button
              className="modal-btn primary"
              onClick={() => void connectNextcloud().catch((e) => setMessage(String(e)))}
            >
              Grant Nextcloud access
            </button>
            <button
              className="modal-btn secondary"
              onClick={() => void finishNextcloud().catch((e) => setMessage(String(e)))}
            >
              Finish connection
            </button>
          </>
        ) : (
          <>
            <button className="modal-btn primary" onClick={() => void save().catch((e) => setMessage(String(e)))}>
              Save
            </button>
            <button className="modal-btn secondary" onClick={() => void test().catch((e) => setMessage(String(e)))}>
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
