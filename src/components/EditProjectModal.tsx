import { ProjectIdentityPicker } from './ProjectIdentity';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { InstalledModel, Project, ProjectMode } from '../types';
import { ShellIcon } from './ShellIcon';
import { CloseButton } from './CloseButton';
import { FolderPicker } from './FolderPicker';

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
  const [modes, setModes] = useState<ProjectMode[]>(project.modes?.length ? project.modes : ['chat']);
  const toggleMode = (mode: ProjectMode, on: boolean) => setModes((prev) => (['chat', 'cowork', 'code'] as ProjectMode[]).filter((m) => (m === mode ? on : prev.includes(m))));
  const [shared, setShared] = useState({ chat: project.sharedContext?.chat === true, code: project.sharedContext?.code === true });
  const bothModes = modes.includes('chat') && modes.includes('code');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const [folders, setFolders] = useState(project.sourceFolders || []);
  const [pickingFolder, setPickingFolder] = useState(false);
  const linkedFolders = folders.filter((folder) => folder !== project.projectFolder);

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
        modes,
        // Sharing only means something across two modes; with one, it is saved off.
        sharedContext: bothModes ? shared : { chat: false, code: false },
        ...(JSON.stringify(folders) !== JSON.stringify(project.sourceFolders || []) ? { sourceFolders: folders } : {}),
      });
      onClose();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not save the project.');
    } finally { setSaving(false); }
  };

  return (
    <dialog
      className="edit-project-modal aero dialog-sheet"
      ref={ref}
      aria-label={`Edit ${project.name}`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
    >
      <header>
        <h2>Edit project</h2>
        <CloseButton onClick={onClose}/>
      </header>

      <div className="edit-project-body">
        <div className="project-name-field">
          <ProjectIdentityPicker icon={icon} color={color} onChange={(i,c)=>{setIcon(i);setColor(c);}}/>
          <input aria-label="Project name" className="modal-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <fieldset className="field project-modes">
          <legend>Available in</legend>
          <div className="project-mode-options">
            {([['chat', 'Chat', ''], ['cowork', 'Cowork', 'not built yet'], ['code', 'Code', 'preview']] as [ProjectMode, string, string][]).map(([mode, label, note]) => (
              <label key={mode} className="mm-check"><input type="checkbox" checked={modes.includes(mode)} onChange={(e) => toggleMode(mode, e.target.checked)} />{label}{note && <small> · {note}</small>}</label>
            ))}
          </div>
          <small>{modes.length ? 'The project appears in these modes. Chat projects show in the sidebar and accept messages.' : 'Choose at least one mode.'}</small>
        </fieldset>
        {bothModes && <fieldset className="field project-modes">
          <legend>Shared context</legend>
          <div className="project-mode-options">
            <label className="mm-check"><input type="checkbox" checked={shared.code} onChange={(e) => setShared((s) => ({ ...s, code: e.target.checked }))} />Code tasks see this project<small> · goal, instructions, memories, recent chat titles</small></label>
            <label className="mm-check"><input type="checkbox" checked={shared.chat} onChange={(e) => setShared((s) => ({ ...s, chat: e.target.checked }))} />Chats see recent Code tasks<small> · what was asked and how it ended</small></label>
          </div>
          <small>Off by default. Nothing leaves your account; Code still asks before every action.</small>
        </fieldset>}
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
        <div className="field project-edit-folders">
          <span>Linked reference folders</span>
          <small>Read files from these storage folders. Removing a link leaves its files in storage.</small>
          {linkedFolders.length ? <ul className="source-list">{linkedFolders.map((folder) => <li key={folder}>
            <span className="source-name" title={folder}><ShellIcon name="folder"/>{folder}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} aria-label={`Unlink ${folder}`} onClick={() => setFolders((current) => current.filter((item) => item !== folder))}>Unlink</button>
          </li>)}</ul> : <small>No reference folders linked.</small>}
          <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => setPickingFolder(true)}>Link folder</button>
          <small>Changes are applied when you save this project.</small>
        </div>
      </div>

      {addError && <p role="alert" className="modal-err project-save-error">{addError}</p>}
      <footer>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={!name.trim() || !modes.length || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </footer>

      {pickingFolder && <FolderPicker onClose={() => setPickingFolder(false)} onPick={(path) => { setFolders((current) => [...new Set([...current, path])]); setPickingFolder(false); }} />}

    </dialog>
  );
}
