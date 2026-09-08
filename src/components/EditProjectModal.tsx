import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { InstalledModel, Project, ProjectFile } from '../types';
import { StorageFileBrowser } from './StorageFileBrowser';
import type { PickedFile } from './StorageFileBrowser';
import { FolderPicker } from './FolderPicker';
import { syncProjectSources } from '../api';
import { TEXT_EXTENSIONS, readTextSources, describeRejection } from '../sources';

/** Edit a project in place. Previously "Edit project" simply navigated into the
 *  project, which meant the settings people actually wanted to change — the
 *  model a chat defaults to, the instructions, the sources — were several
 *  clicks away. Everything here saves through the one config patch. */
export function EditProjectModal({
  project,
  models,
  onSave,
  onClose,
}: {
  project: Project;
  models: InstalledModel[];
  onSave: (patch: Partial<Project>) => void | Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(project.name);
  const [goal, setGoal] = useState(project.goal || '');
  const [instructions, setInstructions] = useState(project.instructions || '');
  const [model, setModel] = useState(project.model || '');
  const [files, setFiles] = useState<ProjectFile[]>(project.files || []);
  const [browsing, setBrowsing] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [folders, setFolders] = useState<string[]>(project.sourceFolders || []);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);

  // The accept attribute is a hint the OS dialog lets you override, so the
  // rules are enforced here too. Without this an image was read as text,
  // stored as replacement characters, and — once it pushed the save past the
  // 1 MB request cap — silently failed to save at all.
  const addLocalFiles = async (list: FileList | null) => {
    if (!list) return;
    const { accepted, rejected } = await readTextSources(Array.from(list));
    setAddError(rejected.length ? `Not added — ${describeRejection(rejected)}. A source is read as text.` : '');
    if (accepted.length) {
      setFiles((prev) => [...prev.filter((x) => !accepted.some((a) => a.name === x.name)), ...accepted]);
    }
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setAddError('');
    try {
      // onSave pulls the attached folders as part of saving, so a folder picked
      // here is readable straight away rather than after a separate refresh
      // nobody knows to press.
      await onSave({
        name: trimmed,
        goal,
        instructions,
        // Uploads only — folder-derived sources are the sync's to manage.
        files: files.filter((f) => !f.source),
        sourceFolders: folders,
        ...(model ? { model } : {}),
      });
      onClose();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not save the project.');
    } finally { setSaving(false); }
  };

  // Attached folders are re-read on demand. Save first so the server syncs
  // against the folder list shown here rather than the stored one.
  const syncNow = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      await onSave({ sourceFolders: folders });
      const r = await syncProjectSources(project.id);
      setFiles((prev) => {
        const byName = new Map(prev.map((f) => [f.name, f]));
        return r.files.map((f) => (f.source
          ? { name: f.name, content: '', source: f.source }
          : byName.get(f.name) ?? { name: f.name, content: '' }));
      });
      const failed = r.skipped.length;
      setSyncNote(
        `${r.files.length} source${r.files.length === 1 ? '' : 's'} in place` +
          (failed ? ` · ${failed} skipped (${r.skipped[0].reason})` : ''),
      );
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'Could not refresh from storage');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <dialog
      className="edit-project-modal"
      ref={ref}
      aria-label={`Edit ${project.name}`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
    >
      <header>
        <h2>Edit project</h2>
        <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="edit-project-body">
        <label className="field">
          <span>Name</span>
          <input className="modal-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="field">
          <span>Description</span>
          <input
            className="modal-input"
            value={goal}
            placeholder="What this project is for"
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Default model</span>
          <select className="modal-input" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Use the loaded model</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}{m.loaded ? ' · loaded' : ''}</option>
            ))}
          </select>
          <small>New chats in this project start on this model.</small>
        </label>

        <label className="field">
          <span>Project instructions</span>
          <textarea
            className="modal-input"
            rows={5}
            value={instructions}
            placeholder="Standing instructions applied to every chat in this project."
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>

        <div className="field">
          <span>Source folders</span>
          <small>Text files in these folders are re-read on refresh, so the project follows the folder rather than holding a copy.</small>
          {folders.length === 0 && <p className="insp-empty">No folders attached.</p>}
          {folders.length > 0 && files.filter((f) => f.source).length === 0 && (
            <p className="insp-empty">Attached, not yet read. Saving pulls their files in.</p>
          )}
          {folders.length > 0 && (
            <ul className="source-list">
              {folders.map((f) => (
                <li key={f}>
                  <span className="source-name">📁 {f}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setFolders((prev) => prev.filter((x) => x !== f))}
                    aria-label={`Detach ${f}`}
                  >
                    Detach
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="source-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setPickingFolder(true)}>Attach folder</button>
            <button className="btn btn-secondary btn-sm" onClick={() => void syncNow()} disabled={syncing || folders.length === 0}>
              {syncing ? 'Refreshing…' : 'Refresh from storage'}
            </button>
          </div>
          {syncNote && <small>{syncNote}</small>}
        </div>

        <div className="field">
          <span>Sources</span>
          <small>Every chat in this project reads these as its reference material.</small>
          {files.length === 0 && <p className="side-hint">No sources attached yet.</p>}
          {files.length > 0 && (
            <ul className="source-list">
              {files.map((f) => (
                <li key={f.name}>
                  <span className="source-name">{f.source ? '📁' : '📄'} {f.name}</span>
                  {f.content.length > 0 && (
                    <span className="source-size">{Math.max(1, Math.round(f.content.length / 1024))} KB</span>
                  )}
                  {f.source ? (
                    <span className="source-size">from folder</span>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))}
                      aria-label={`Remove ${f.name}`}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {addError && <p className="modal-err source-add-error">{addError}</p>}
          <div className="source-actions">
            <label className="btn btn-secondary btn-sm">
              Add files
              <input
                type="file"
                multiple
                accept={TEXT_EXTENSIONS.join(',')}
                style={{ display: 'none' }}
                onChange={(e) => { void addLocalFiles(e.target.files); e.target.value = ''; }}
              />
            </label>
            <button className="btn btn-secondary btn-sm" onClick={() => setBrowsing(true)}>
              Add from storage
            </button>
          </div>
        </div>
      </div>

      <footer>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={!name.trim() || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </footer>

      {pickingFolder && (
        <FolderPicker
          onClose={() => setPickingFolder(false)}
          onPick={(path) => {
            setFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
            setPickingFolder(false);
          }}
        />
      )}
      {browsing && (
        <StorageFileBrowser
          onClose={() => setBrowsing(false)}
          onPick={(picked: PickedFile[]) => {
            setFiles((prev) => {
              const next = [...prev];
              for (const f of picked) {
                const i = next.findIndex((x) => x.name === f.name);
                if (i >= 0) next[i] = f; else next.push(f);
              }
              return next;
            });
            setBrowsing(false);
          }}
        />
      )}
    </dialog>
  );
}
