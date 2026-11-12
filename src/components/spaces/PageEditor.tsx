// The page editor of a Space (sbstndalton/noevia#2446): a title, Markdown text with a preview, and an
// autosave that says what it is doing; the save logic is src/page-autosave.ts.
//
// Adapted from CopilotKit/OpenDots@46eaf96c9e3802adc972ceafd8f20f99bda34e70, src/client/PageDocument.tsx (MIT, Copyright (c) Atai Barkai):
// the page chrome (title above the text, a saved/saving state beside it, conflict choices). The text
// surface is ours (a textarea and our Markdown preview). The upstream notice follows.
//   The MIT License
//   Copyright (c) Atai Barkai
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
//   associated documentation files (the "Software"), to deal in the Software without restriction,
//   including without limitation the rights to use, copy, modify, merge, publish, distribute,
//   sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions: The above copyright notice and this
//   permission notice shall be included in all copies or substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
//   NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useT } from '../../i18n';
import type { Translate } from '../../i18n';
import '../../i18n/coworkers';
import { formatBinaryBytes } from '../../number-format';
import { appLocale } from '../../user-preferences';
import { PAGE_BYTES_MAX, PAGE_TITLE_MAX } from '../../spaces-limits';
import type { SaveFault, SaveState } from '../../page-autosave';
import { createPage, deletePage, type Page } from '../../spaces-api';
import { ConfirmDialog } from '../ContextMenu';
import { MarkdownPreview } from '../DiaryModal';
import { ShellIcon } from '../ShellIcon';
import { usePageAutosave } from './usePageAutosave';
import './spaces.css';

export function faultText(t: Translate, fault: SaveFault | undefined, kept = true): string {
  if (!fault) return '';
  // The promise that the text is safe is only made when the device really kept a copy.
  const tail = ' ' + (kept ? t('spaces.keptOnDevice') : t('spaces.notKeptOnDevice'));
  if (fault.kind === 'problem') {
    if (fault.problem === 'title-empty') return t('spaces.problemTitleEmpty');
    if (fault.problem === 'title-long') return t('spaces.problemTitleLong', { max: PAGE_TITLE_MAX });
    return t('spaces.problemTooLarge', { limit: formatBinaryBytes(PAGE_BYTES_MAX, appLocale()) });
  }
  if (fault.kind === 'timeout') return t('spaces.saveTimeout') + tail;
  if (fault.kind === 'load-failed') return t('spaces.conflictLoadFailed');
  if (fault.code === 'page_too_large') return t('spaces.problemTooLarge', { limit: formatBinaryBytes(PAGE_BYTES_MAX, appLocale()) });
  if (fault.code === 'not_found') return t('spaces.pageGone') + tail;
  return t('spaces.saveFailed') + tail;
}

const STATUS_KEY = { saved: 'spaces.statusSaved', saving: 'spaces.statusSaving', dirty: 'spaces.statusDirty', error: 'spaces.statusError', conflict: 'spaces.statusConflict' } as const;

export function SaveBadge({ state, t }: { state: SaveState; t: Translate }): JSX.Element {
  return <p className={`space-save is-${state.status}`} role="status" aria-live="polite" data-save-state={state.status}>
    <span className="space-save-dot" aria-hidden="true" />{t(STATUS_KEY[state.status])}
  </p>;
}

export function PageEditor({ spaceId, spaceName, page, fresh, onBack, onDeleted, onMoved }: {
  spaceId: string; spaceName: string; page: Page; fresh: boolean;
  onBack: () => void; onDeleted: () => void;
  /** The text was saved as a new page (the old one is gone): show that page. */
  onMoved: (pageId: string) => void;
}): JSX.Element {
  const t = useT();
  const { controller, state } = usePageAutosave(spaceId, page);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const [moving, setMoving] = useState(false);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const ids = { title: useId(), content: useId(), fault: useId() };
  const draft = state.draft ?? { title: page.title, content: page.content };

  // Focus lands on the page when it opens (the title field for a page just created). A conflict or a
  // failed save appears while the person is typing, so it never takes focus (that would swallow their
  // next keystrokes); it is announced as an alert instead, and sits before the text in reading order.
  useEffect(() => { (fresh ? titleInput.current : heading.current)?.focus(); }, [fresh]);

  // Closing or reloading the tab with something unsaved asks first (the draft is also kept here).
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (controller.dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [controller]);

  const tryLeave = async () => {
    const saved = controller.dirty ? await controller.flush() : true;
    if (saved || !controller.dirty) onBack(); else setLeaving(true);
  };
  // A banner's own buttons vanish when it resolves; focus goes back to the text instead of dropping to the page.
  const resolved = async (action: Promise<boolean>) => { await action; if (!document.activeElement || document.activeElement === document.body) textArea.current?.focus(); };
  // The page was deleted somewhere else: the text is not lost, it becomes a new page.
  const saveAsNew = async () => {
    setMoving(true);
    try { const made = await createPage(spaceId, draft.title.trim() || t('spaces.untitled'), draft.content); controller.discard(); onMoved(made.id); }
    catch { setDeleteFailed(true); setMoving(false); }
  };
  const remove = async () => {
    setDeleting(false);
    try { await deletePage(spaceId, page.id); controller.discard(); onDeleted(); }
    catch { setDeleteFailed(true); }
  };

  const bytes = new TextEncoder().encode(draft.content).length;
  const nearLimit = bytes > PAGE_BYTES_MAX * 0.9;
  const kept = state.keptOnDevice !== false;
  const faultShown = state.status === 'error' || (state.status === 'conflict' && state.fault?.kind === 'load-failed');
  const title = draft.title.trim() || t('spaces.untitled');

  return (
    <main className="main spaces-workspace space-editor">
      <div className="settings-scroll">
        <nav className="space-crumbs" aria-label={t('spaces.breadcrumb')}>
          <button type="button" className="btn btn-secondary space-back" onClick={() => void tryLeave()}>
            <ShellIcon name="arrow-left" size={16} /><span>{spaceName}</span>
          </button>
        </nav>
        <h1 className="sr-only" ref={heading} tabIndex={-1}>{title}</h1>
        <div className="space-page-head">
          <label className="sr-only" htmlFor={ids.title}>{t('spaces.titleLabel')}</label>
          <input id={ids.title} ref={titleInput} className="space-title-input" value={draft.title} placeholder={t('spaces.untitled')}
            aria-invalid={state.fault?.kind === 'problem' && state.fault.problem !== 'too-large'} aria-describedby={faultShown ? ids.fault : undefined}
            onChange={(e) => controller.edit({ title: e.target.value })} />
          <SaveBadge state={state} t={t} />
        </div>

        {state.restored && <p className="space-note" role="status">{t('spaces.restoredNote')}</p>}

        {state.status === 'conflict' && (
          <div className="space-banner is-conflict" role="alert">
            <h2>{t('spaces.conflictTitle')}</h2>
            <p>{t('spaces.conflictBody')}</p>
            {state.fault?.kind === 'load-failed' && <p id={ids.fault}>{t('spaces.conflictLoadFailed')}</p>}
            <div className="space-banner-actions">
              <button type="button" className="btn btn-primary" onClick={() => void resolved(controller.keepMine())}>{t('spaces.keepMine')}</button>
              <button type="button" className="btn btn-secondary" onClick={() => void resolved(controller.takeTheirs())}>{t('spaces.takeTheirs')}</button>
            </div>
          </div>
        )}
        {state.status === 'error' && (
          <div className="space-banner is-error" role="alert">
            <p id={ids.fault}>{faultText(t, state.fault, kept)}</p>
            <div className="space-banner-actions">
              {state.fault?.kind === 'problem' ? null  // editing the text saves again by itself; a retry button could only fail the same way
                : state.fault?.kind === 'server' && state.fault.code === 'not_found'
                ? <button type="button" className="btn btn-primary" disabled={moving} onClick={() => void saveAsNew()}>{t('spaces.saveAsNew')}</button>
                : <button type="button" className="btn btn-secondary" onClick={() => void resolved(controller.flush(true))}>{t('spaces.retrySave')}</button>}
            </div>
          </div>
        )}

        <div className="seg space-modes" role="group" aria-label={t('spaces.editorView')}>
          {(['write', 'preview'] as const).map((m) => (
            <button key={m} type="button" className={mode === m ? 'is-selected' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t(m === 'write' ? 'spaces.tabWrite' : 'spaces.tabPreview')}
            </button>
          ))}
        </div>
        {mode === 'write'
          ? <textarea ref={textArea} id={ids.content} className="space-content-input" aria-label={t('spaces.contentLabel')} spellCheck value={draft.content}
              aria-invalid={state.fault?.kind === 'problem' && state.fault.problem === 'too-large'} aria-describedby={faultShown ? ids.fault : undefined}
              onChange={(e) => controller.edit({ content: e.target.value })} />
          : <div className="space-preview" role="region" aria-label={t('spaces.tabPreview')}>
              <MarkdownPreview text={draft.content || t('spaces.emptyPreview')} />
            </div>}
        <div className="space-foot">
          {nearLimit && <span className="space-size" role="status">{formatBinaryBytes(bytes, appLocale())} / {formatBinaryBytes(PAGE_BYTES_MAX, appLocale())}</span>}
          <button type="button" className="btn btn-secondary space-danger" onClick={() => setDeleting(true)}>
            <ShellIcon name="trash" size={16} /><span>{t('spaces.deletePage')}</span>
          </button>
        </div>
        {deleteFailed && <p className="space-note is-error" role="alert">{t('spaces.actionFailed')}</p>}
      </div>
      {deleting && <ConfirmDialog danger title={t('spaces.deletePageTitle', { title })} body={t('spaces.deletePageBody')} confirmLabel={t('spaces.deletePageConfirm')} onConfirm={() => void remove()} onCancel={() => setDeleting(false)} />}
      {leaving && <ConfirmDialog danger title={t('spaces.leaveTitle')} body={kept ? t('spaces.leaveBody') : t('spaces.leaveBodyNoCopy')} confirmLabel={t('spaces.leaveConfirm')} onConfirm={() => { setLeaving(false); onBack(); }} onCancel={() => setLeaving(false)} />}
    </main>
  );
}
