import { ProjectIdentityPicker } from './ProjectIdentity';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { InstalledModel, Project, ProjectMode } from '../types';
import { ShellIcon } from './ShellIcon';
import { CloseButton } from './CloseButton';
import { FolderPicker } from './FolderPicker';
import { useT } from '../i18n';

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
  const t = useT();
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
      setAddError(e instanceof Error ? e.message : t('projects.edit.saveError'));
    } finally { setSaving(false); }
  };

  return (
    <dialog
      className="edit-project-modal aero dialog-sheet"
      ref={ref}
      aria-label={t('projects.edit.dialogLabel', { name: project.name })}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
    >
      <header>
        <h2>{t('projects.edit.title')}</h2>
        <CloseButton onClick={onClose}/>
      </header>

      <div className="edit-project-body">
        <div className="project-name-field">
          <ProjectIdentityPicker icon={icon} color={color} onChange={(i,c)=>{setIcon(i);setColor(c);}}/>
          <input aria-label={t('projects.edit.nameLabel')} className="modal-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <fieldset className="field project-modes">
          <legend>{t('projects.edit.availableIn')}</legend>
          <div className="project-mode-options">
            {([['chat', t('projects.modeChat'), ''], ['cowork', t('projects.modeCowork'), t('projects.edit.notBuiltYet')], ['code', t('projects.modeCode'), t('projects.edit.preview')]] as [ProjectMode, string, string][]).map(([mode, label, note]) => (
              <label key={mode} className="mm-check"><input type="checkbox" checked={modes.includes(mode)} onChange={(e) => toggleMode(mode, e.target.checked)} />{label}{note && <small> · {note}</small>}</label>
            ))}
          </div>
          <small>{modes.length ? t('projects.edit.modesHint') : t('projects.edit.chooseMode')}</small>
        </fieldset>
        {bothModes && <fieldset className="field project-modes">
          <legend>{t('projects.edit.sharedContext')}</legend>
          <div className="project-mode-options">
            <label className="mm-check"><input type="checkbox" checked={shared.code} onChange={(e) => setShared((s) => ({ ...s, code: e.target.checked }))} />{t('projects.edit.codeSeesProject')}<small> · {t('projects.edit.codeSeesProjectDetail')}</small></label>
            <label className="mm-check"><input type="checkbox" checked={shared.chat} onChange={(e) => setShared((s) => ({ ...s, chat: e.target.checked }))} />{t('projects.edit.chatSeesCode')}<small> · {t('projects.edit.chatSeesCodeDetail')}</small></label>
          </div>
          <small>{t('projects.edit.sharedContextHint')}</small>
        </fieldset>}
        <label className="field">
          <span>{t('projects.edit.instructions')}</span>
          <textarea className="modal-input" rows={3} value={instructions}
            placeholder={t('projects.edit.instructionsPlaceholder')}
            onChange={(e) => setInstructions(e.target.value)} />
        </label>
        <details className="project-extra-settings">
          <summary>{t('projects.edit.moreSettings')}</summary>
        <label className="field">
          <span>{t('projects.edit.description')}</span>
          <input
            className="modal-input"
            value={goal}
            placeholder={t('projects.edit.descriptionPlaceholder')}
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>

        <label className="field">
          <span>{t('projects.edit.thinkingEffort')}</span>
          <select className="modal-input" value={effort} onChange={e => setEffort(e.target.value as typeof effort)}>
            <option value="inherit">{t('projects.edit.effortInherit')}</option><option value="default">{t('projects.edit.effortDefault')}</option>
            <option value="low">{t('projects.edit.effortLow')}</option><option value="high">{t('projects.edit.effortHigh')}</option>
          </select>
          <small>{t('projects.edit.effortHint')}</small>
        </label>
        <label className="field">
          <span>{t('projects.edit.defaultModel')}</span>
          <select className="modal-input" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">{t('projects.edit.useLoadedModel')}</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}{m.loaded ? ` · ${t('projects.edit.loaded')}` : ''}</option>
            ))}
          </select>
          <small>{t('projects.edit.defaultModelHint')}</small>
        </label>

        </details>
        <div className="field project-storage-summary">
          <span>{t('projects.edit.uploadFolder')}</span>
          <small>{t('projects.edit.uploadFolderHint')}</small>
          {project.projectFolder ? <p className="storage-path"><ShellIcon name="folder"/><span>{project.projectFolder}</span></p>
            : <small>{t('projects.edit.folderOnFirstUpload')}</small>}
        </div>
        <div className="field project-edit-folders">
          <span>{t('projects.edit.linkedFolders')}</span>
          <small>{t('projects.edit.linkedFoldersHint')}</small>
          {linkedFolders.length ? <ul className="source-list">{linkedFolders.map((folder) => <li key={folder}>
            <span className="source-name" title={folder}><ShellIcon name="folder"/>{folder}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} aria-label={t('projects.edit.unlinkFolder', { folder })} onClick={() => setFolders((current) => current.filter((item) => item !== folder))}>{t('projects.edit.unlink')}</button>
          </li>)}</ul> : <small>{t('projects.edit.noFoldersLinked')}</small>}
          <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => setPickingFolder(true)}>{t('projects.edit.linkFolder')}</button>
          <small>{t('projects.edit.changesAppliedOnSave')}</small>
        </div>
      </div>

      {addError && <p role="alert" className="modal-err project-save-error">{addError}</p>}
      <footer>
        <button className="btn btn-secondary" onClick={onClose}>{t('projects.cancel')}</button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={!name.trim() || !modes.length || saving}>{saving ? t('projects.edit.saving') : t('projects.edit.save')}</button>
      </footer>

      {pickingFolder && <FolderPicker onClose={() => setPickingFolder(false)} onPick={(path) => { setFolders((current) => [...new Set([...current, path])]); setPickingFolder(false); }} />}

    </dialog>
  );
}
