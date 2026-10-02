import { useId, useState } from 'react';
import type { JSX } from 'react';
import type { ChatKind } from '../types';
import { frameChips } from '../chat-frame';
import type { FrameAction, FrameDraft } from '../chat-frame';
import { Icon } from './icons/Icon';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

const KIND_ICON: Record<ChatKind, string> = { search: 'search', action: 'list-checks', idea: 'sparkles', question: 'message-square', code: 'code' };

/** The suggested frame under a new chat's first message (#738): project · kind · #tags · N related,
 *  on a dashed row that reads as "not applied yet". Each chip but the kind can be removed; Edit
 *  picks the project from the person's own projects and takes tags as free text; ✓ saves it, ✕
 *  hides it. Nothing is saved before ✓. */
export function FrameChips({ draft, projects, onAction, onAccept }: {
  draft: FrameDraft;
  projects: readonly { id: string; name: string }[];
  onAction: (action: FrameAction) => void;
  /** `tagText`: the tag editor's text when it is still open, applied before the frame is saved. */
  onAccept: (tagText?: string) => void;
}): JSX.Element {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [tagText, setTagText] = useState('');
  const ids = useId();
  const busy = draft.status === 'saving';
  const chips = frameChips(draft.frame, projects);
  const openEditor = () => { setTagText(draft.frame.tags.map((tag) => `#${tag}`).join(' ')); setEditing(true); };
  const closeEditor = () => { onAction({ type: 'setTags', text: tagText }); setEditing(false); };

  return (
    <div className="frame-row" role="group" aria-label={t('chat.frame.label')} data-status={draft.status}>
      <ul className="frame-chips">
        {chips.map((chip) => (
          <li key={chip.id} className={`chip frame-chip is-${chip.type}`}>
            {chip.type === 'project' && <><Icon name="folder" size={13} /><span className="frame-chip-text">{chip.label}</span>
              <button type="button" className="frame-chip-remove" disabled={busy} aria-label={t('chat.frame.removeProject', { name: chip.label })} onClick={() => onAction({ type: 'removeProject' })}><Icon name="x" size={12} /></button></>}
            {chip.type === 'kind' && <><Icon name={KIND_ICON[chip.kind]} size={13} /><span className="frame-chip-text">{t(`chat.frame.kind.${chip.kind}` as MessageKey)}</span></>}
            {chip.type === 'tag' && <><span className="frame-chip-text">#{chip.tag}</span>
              <button type="button" className="frame-chip-remove" disabled={busy} aria-label={t('chat.frame.removeTag', { tag: chip.tag })} onClick={() => onAction({ type: 'removeTag', tag: chip.tag })}><Icon name="x" size={12} /></button></>}
            {chip.type === 'links' && <><span className="frame-chip-glyph" aria-hidden="true">↔</span><span className="frame-chip-text">{t.plural('chat.frame.related', chip.count, { count: String(chip.count) })}</span>
              <button type="button" className="frame-chip-remove" disabled={busy} aria-label={t('chat.frame.removeLinks')} onClick={() => onAction({ type: 'removeLinks' })}><Icon name="x" size={12} /></button></>}
          </li>
        ))}
      </ul>
      <div className="frame-actions">
        <button type="button" className="icon-btn frame-btn" disabled={busy} aria-expanded={editing} aria-controls={`${ids}-edit`}
          aria-label={t('chat.frame.edit')} title={t('chat.frame.edit')} onClick={() => (editing ? closeEditor() : openEditor())}><Icon name="pencil" size={14} /></button>
        <button type="button" className="icon-btn frame-btn is-accept" disabled={busy} aria-label={t('chat.frame.accept')} title={t('chat.frame.accept')}
          onClick={() => { const pending = editing ? tagText : undefined; setEditing(false); onAccept(pending); }}><Icon name="check" size={15} strokeWidth={2.25} /></button>
        <button type="button" className="icon-btn frame-btn" disabled={busy} aria-label={t('chat.frame.dismiss')} title={t('chat.frame.dismiss')}
          onClick={() => onAction({ type: 'dismiss' })}><Icon name="x" size={15} /></button>
      </div>
      {editing && (
        <div className="frame-edit" id={`${ids}-edit`}>
          <label className="frame-edit-field">
            <span>{t('chat.frame.project')}</span>
            <select value={draft.frame.projectId ?? ''} disabled={busy} onChange={(e) => onAction({ type: 'setProject', projectId: e.currentTarget.value || null })}>
              <option value="">{t('chat.frame.noProject')}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="frame-edit-field is-tags">
            <span>{t('chat.frame.tags')}</span>
            <input type="text" className="modal-input" value={tagText} disabled={busy} placeholder={t('chat.frame.tagsHint')} maxLength={600}
              onChange={(e) => setTagText(e.currentTarget.value)}
              onBlur={() => onAction({ type: 'setTags', text: tagText })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); closeEditor(); } }} />
          </label>
        </div>
      )}
      {draft.status === 'error' && <p className="frame-error" role="alert">{t('chat.frame.saveFailed')}</p>}
    </div>
  );
}
