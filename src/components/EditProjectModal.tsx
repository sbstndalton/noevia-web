import { ProjectIdentityPicker } from './ProjectIdentity';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { InstalledModel, Project } from '../types';
import { ShellIcon } from './ShellIcon';

/** Project identity and behavior. Reference files are managed on Sources. */
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
  const [icon, setIcon] = useState(project.icon || 'folder');
  const [color, setColor] = useState(project.color || 'default');
  const [name, setName] = useState(project.name);
  const [goal, setGoal] = useState(project.goal || '');
  const [instructions, setInstructions] = useState(project.instructions || '');
  const [effort, setEffort] = useState<'inherit' | 'default' | 'low' | 'high'>(project.reasoningEffort || 'inherit');
  const [model, setModel] = useState(project.model || '');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setAddError('');
    try {
      await onSave({
        name: trimmed, icon, color,
        goal,
        instructions,
        model,
        reasoningEffort: effort === 'inherit' ? null : effort,
      });
      onClose();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not save the project.');
    } finally { setSaving(false); }
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
        <div className="project-name-field">
          <ProjectIdentityPicker icon={icon} color={color} onChange={(i,c)=>{setIcon(i);setColor(c);}}/>
          <input aria-label="Project name" className="modal-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="field">
          <span>Project instructions</span>
          <textarea className="modal-input" rows={3} value={instructions}
            placeholder="How should the AI respond in this project?"
            onChange={(e) => setInstructions(e.target.value)} />
        </label>
        <details className="project-extra-settings">
          <summary>More settings</summary>
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
          <span>Thinking effort</span>
          <select className="modal-input" value={effort} onChange={e => setEffort(e.target.value as typeof effort)}>
            <option value="inherit">Inherit deployment default</option><option value="default">Provider default</option>
            <option value="low">Low</option><option value="high">High</option>
          </select>
          <small>Unverified providers use a best-effort hint. The request mode is shown with each reply.</small>
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

        </details>
        <div className="field project-storage-summary">
          <span>Upload folder</span>
          <small>Text files and PDFs you upload are saved here. Manage reference files on the project’s Sources tab.</small>
          {project.projectFolder ? <p className="storage-path"><ShellIcon name="folder"/><span>{project.projectFolder}</span></p>
            : <small>A folder is created on your first document upload when storage is connected.</small>}
        </div>
      </div>

      {addError && <p role="alert" className="modal-err project-save-error">{addError}</p>}
      <footer>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={!name.trim() || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </footer>

    </dialog>
  );
}
