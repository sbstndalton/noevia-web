import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { InstalledModel, Project, ProjectFile } from '../types';
import { StorageFileBrowser } from './StorageFileBrowser';
import type { PickedFile } from './StorageFileBrowser';

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
  onSave: (patch: Partial<Project>) => void;
  onClose: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(project.name);
  const [goal, setGoal] = useState(project.goal || '');
  const [instructions, setInstructions] = useState(project.instructions || '');
  const [model, setModel] = useState(project.model || '');
  const [files, setFiles] = useState<ProjectFile[]>(project.files || []);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);

  const addLocalFiles = (list: FileList | null) => {
    if (!list) return;
    for (const f of Array.from(list)) {
      void f.text().then((content) =>
        setFiles((prev) => [...prev.filter((x) => x.name !== f.name), { name: f.name, content }]),
      );
    }
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({ name: trimmed, goal, instructions, files, ...(model ? { model } : {}) });
    onClose();
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
          <span>Sources</span>
          <small>Every chat in this project reads these as its reference material.</small>
          {files.length === 0 && <p className="side-hint">No sources attached yet.</p>}
          {files.length > 0 && (
            <ul className="source-list">
              {files.map((f) => (
                <li key={f.name}>
                  <span className="source-name">{f.name}</span>
                  <span className="source-size">{Math.max(1, Math.round(f.content.length / 1024))} KB</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))}
                    aria-label={`Remove ${f.name}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="source-actions">
            <label className="btn btn-secondary btn-sm">
              Add files
              <input
                type="file"
                multiple
                accept=".md,.txt,.json,.csv,.yml,.yaml,.ts,.tsx,.js,.py"
                style={{ display: 'none' }}
                onChange={(e) => addLocalFiles(e.target.files)}
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
        <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Save</button>
      </footer>

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
