import { ProjectIdentityPicker } from './ProjectIdentity';
import { isResident } from '../model-residency';
import { useState } from 'react';
import type { JSX } from 'react';
import type { InstalledModel, Project } from '../types';
import { useCodeAccess } from './code/useCodeAccess';
import { ShellIcon } from './ShellIcon';
import { CloseButton } from './CloseButton';
import { FolderPicker } from './FolderPicker';
import { useModalDialog } from './useModalDialog';
import { PROJECT_NAME_MAX_LENGTH } from '../project-limits';
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
  const ref = useModalDialog();
  const [icon, setIcon] = useState(project.icon || 'folder');
  const [color, setColor] = useState(project.color || 'default');
  const [name, setName] = useState(project.name);
  const [goal, setGoal] = useState(project.goal || '');
  const [instructions, setInstructions] = useState(project.instructions || '');
  const [effort, setEffort] = useState<'inherit' | 'default' | 'low' | 'high'>(project.reasoningEffort || 'inherit');
  const [model, setModel] = useState(project.model || '');
  const [shared, setShared] = useState({ chat: project.sharedContext?.chat === true, code: project.sharedContext?.code === true });
  // #1576: there is no per-project "Available in" any more; every project is a chat project and Task
  // is a per-send choice. Sharing context with Code tasks is offered to whoever can run them (admin +
  // codeHarness, the same probe as the Code tab), or when it is already on so it can be turned off.
  const codeAccess = useCodeAccess(project.id);
  const showShared = codeAccess === 'allowed' || project.sharedContext?.chat === true || project.sharedContext?.code === true;
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const [folders, setFolders] = useState(project.sourceFolders || []);
  const [pickingFolder, setPickingFolder] = useState(false);
  const linkedFolders = folders.filter((folder) => folder !== project.projectFolder);
  const nameNearLimit = name.length >= PROJECT_NAME_MAX_LENGTH - 10;

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
        // #1576: `modes` is no longer sent; the server keeps whatever it stored. Shared context is
        // only sent when the section was shown, so a viewer who cannot see it never changes it.
        ...(showShared ? { sharedContext: shared } : {}),
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
          <input
            aria-label={t('projects.edit.nameLabel')}
            className="modal-input"
            value={name}
            maxLength={PROJECT_NAME_MAX_LENGTH}
            data-initial-focus
            onChange={(e) => setName(e.target.value)}
          />
          <small
            className={`project-name-counter${nameNearLimit ? ' is-near-limit' : ''}`}
            aria-label={t('projects.edit.nameLengthCounterLabel', { count: name.length, max: PROJECT_NAME_MAX_LENGTH })}
          >
            {t('projects.edit.nameLengthCounter', { count: name.length, max: PROJECT_NAME_MAX_LENGTH })}
          </small>
        </div>
        {showShared && <fieldset className="field project-modes">
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
              <option key={m.name} value={m.name}>{m.name}{isResident(m) ? ` · ${t('projects.edit.loaded')}` : ''}</option>
            ))}
          </select>
          <small>{t('projects.edit.defaultModelHint')}</small>
        </label>

        </details>
        <div className="field project-storage-summary">
          <span>{t('projects.edit.uploadFolder')}</span>
          <small>{t('projects.edit.uploadFolderHint')}</small>
          {project.projectFolder ? <p className="storage-path"><ShellIcon name="folder" tone="decorative"/><span>{project.projectFolder}</span></p>
            : <small>{t('projects.edit.folderOnFirstUpload')}</small>}
        </div>
        <div className="field project-edit-folders">
          <span>{t('projects.edit.linkedFolders')}</span>
          <small>{t('projects.edit.linkedFoldersHint')}</small>
          {linkedFolders.length ? <ul className="source-list">{linkedFolders.map((folder) => <li key={folder}>
            <span className="source-name" title={folder}><ShellIcon name="folder" tone="decorative"/>{folder}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} aria-label={t('projects.edit.unlinkFolder', { folder })} onClick={() => setFolders((current) => current.filter((item) => item !== folder))}>{t('projects.edit.unlink')}</button>
          </li>)}</ul> : <small>{t('projects.edit.noFoldersLinked')}</small>}
          <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => setPickingFolder(true)}>{t('projects.edit.linkFolder')}</button>
          <small>{t('projects.edit.changesAppliedOnSave')}</small>
        </div>
      </div>

      {addError && <p role="alert" className="modal-err project-save-error">{addError}</p>}
      <footer>
        <button className="btn btn-secondary" onClick={onClose}>{t('projects.cancel')}</button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={!name.trim() || saving}>{saving ? t('projects.edit.saving') : t('projects.edit.save')}</button>
      </footer>

      {pickingFolder && <FolderPicker onClose={() => setPickingFolder(false)} onPick={(path) => { setFolders((current) => [...new Set([...current, path])]); setPickingFolder(false); }} />}

    </dialog>
  );
}
