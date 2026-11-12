// The coworker settings sheet (sbstndalton/noevia#2446), for creating a coworker and editing one: name, glyph, tint,
// instructions (with their limit shown), allowed tools, the Spaces it may write to, and its default Space. The form
// grouping (identity first, then instructions, then access) follows OpenDots' coworker ("Dot") settings dialog; the
// fields, limits, i18n and the conflict handling are ours (src/coworker-form.ts).
//
// Adapted from CopilotKit/OpenDots@46eaf96c9e3802adc972ceafd8f20f99bda34e70, src/client/WorkspaceDialog.tsx (MIT,
// Copyright (c) Atai Barkai): the dialog's field order and the default-Space-among-granted-Spaces rule. Its hosted
// settings, memory, schedule and connection sections are not used. The upstream notice follows.
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
import { useEffect, useId, useState } from 'react';
import type { JSX } from 'react';
import { useT } from '../../i18n';
import '../../i18n/coworkers';
import { fetchToolboxes } from '../../api';
import type { Toolbox } from '../../types';
import { toolboxCopy } from '../../toolbox-copy';
import { listSpaces, SpacesError, type Space } from '../../spaces-api';
import { createSpecialist, deleteSpecialist, patchSpecialist, readSpecialist, type Specialist } from '../../specialists-api';
import {
  afterStale, blankFields, changesFrom, COWORKER_BRIEF_MAX, COWORKER_GLYPH_MAX, COWORKER_NAME_MAX, countChars, fieldsOf,
  formProblems, GLYPHS, pruneGrants, TINTS, withGrants, type FormState,
} from '../../coworker-form';
import { useModalDialog } from '../useModalDialog';
import { ConfirmDialog } from '../ContextMenu';
import { CoworkerGlyph } from './Glyph';
import '../spaces/spaces.css';
import './coworkers.css';

type Mode = { kind: 'create' } | { kind: 'edit'; record: { revision: number; specialist: Specialist } };

export function CoworkerSettings({ mode, onSaved, onDeleted, onClose }: {
  mode: Mode;
  onSaved: (record: { revision: number; specialist: Specialist }) => void;
  onDeleted?: () => void;
  onClose: () => void;
}): JSX.Element {
  const t = useT();
  const dialog = useModalDialog();
  const ids = { name: useId(), brief: useId(), glyph: useId(), default: useId() };
  const start = mode.kind === 'edit' ? fieldsOf(mode.record.specialist) : blankFields();
  const [form, setForm] = useState<FormState>({ base: { revision: mode.kind === 'edit' ? mode.record.revision : 0, fields: start }, draft: start });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [spacesFailed, setSpacesFailed] = useState(false);
  const [boxes, setBoxes] = useState<Toolbox[] | null>(null);
  const [boxesFailed, setBoxesFailed] = useState(false);
  const draft = form.draft;
  const toolsSupported = draft.toolboxes !== undefined;
  const edit = (patch: Partial<typeof draft>) => { setForm((f) => ({ ...f, draft: { ...f.draft, ...patch } })); setError(''); };

  useEffect(() => { let live = true; listSpaces().then((l) => { if (live) setSpaces(l.spaces); }).catch(() => { if (live) setSpacesFailed(true); }); return () => { live = false; }; }, []);
  useEffect(() => {
    if (!toolsSupported) return;
    let live = true;
    fetchToolboxes().then((r) => { if (live) setBoxes(r.toolboxes.filter((b) => !b.connector)); }).catch(() => { if (live) setBoxesFailed(true); });
    return () => { live = false; };
  }, [toolsSupported]);

  const problems = formProblems(draft);
  const problemText = (p: (typeof problems)[number]): string => ({
    'name-empty': t('coworkers.nameRequired'), 'name-long': t('coworkers.nameTooLong', { max: COWORKER_NAME_MAX }),
    'brief-long': t('coworkers.briefTooLong', { max: COWORKER_BRIEF_MAX }), 'glyph-long': t('coworkers.glyphTooLong', { max: COWORKER_GLYPH_MAX }),
  })[p];
  const failure = (e: unknown): string => (e instanceof SpacesError && e.code === 'specialist_limit' ? t('coworkers.limit') : t('coworkers.saveFailed'));

  const submit = async () => {
    if (busy) return;
    if (problems.length) { setError(problemText(problems[0])); return; }
    // Grants to a Space that is gone are dropped; the server refuses unknown ids.
    const known = spaces ? new Set(spaces.map((s) => s.id)) : null;
    const fields = known ? pruneGrants(draft, known) : draft;
    setBusy(true); setError('');
    try {
      if (mode.kind === 'create') {
        const { toolboxes: _unused, ...createFields } = fields;
        void _unused;
        const made = await createSpecialist({ ...createFields, name: fields.name.trim(), glyph: fields.glyph.trim() });
        onSaved(made); onClose(); return;
      }
      const changes = changesFrom(form.base.fields, fields);
      if (!changes) { onClose(); return; }
      const saved = await patchSpecialist(mode.record.specialist.id, form.base.revision, changes);
      onSaved(saved); onClose();
    } catch (e) {
      if (mode.kind === 'edit' && e instanceof SpacesError && e.code === 'stale_revision') {
        // Changed elsewhere: reload the record as the new base and keep what was typed.
        try { const fresh = await readSpecialist(mode.record.specialist.id); setForm((f) => afterStale({ ...f, draft: fields }, fresh)); setStale(true); }
        catch { setError(t('coworkers.saveFailed')); }
      } else setError(failure(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (mode.kind !== 'edit') return;
    setConfirmDelete(false); setBusy(true);
    try { await deleteSpecialist(mode.record.specialist.id, form.base.revision); onDeleted?.(); onClose(); }
    catch (e) {
      if (e instanceof SpacesError && e.code === 'stale_revision') {
        try { const fresh = await readSpecialist(mode.record.specialist.id); setForm((f) => afterStale(f, fresh)); setStale(true); } catch { setError(t('coworkers.deleteFailed')); }
      } else setError(t('coworkers.deleteFailed'));
      setBusy(false);
    }
  };

  const briefCount = countChars(draft.brief);
  const title = mode.kind === 'create' ? t('coworkers.createTitle') : t('coworkers.editTitle');
  return (
    <dialog ref={dialog} className="modal-overlay native-modal" aria-label={title} onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }} onClick={() => { if (!busy) onClose(); }}>
      <form className="modal-card aero dialog-sheet cw-settings" noValidate onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="modal-head cw-settings-head"><CoworkerGlyph coworker={{ ...draft, name: draft.name || '?' }} /><h2>{title}</h2></div>
        {stale && <p className="space-note" role="status">{t('coworkers.staleNote')}</p>}

        <label htmlFor={ids.name}>{t('coworkers.nameLabel')}</label>
        <input id={ids.name} value={draft.name} disabled={busy} aria-invalid={problems.includes('name-empty') || problems.includes('name-long')} onChange={(e) => edit({ name: e.target.value })} />
        <p className={`space-hint${countChars(draft.name.trim()) > COWORKER_NAME_MAX ? ' is-over' : ''}`}>{t('coworkers.nameCount', { count: countChars(draft.name.trim()), max: COWORKER_NAME_MAX })}</p>

        <fieldset className="cw-fieldset">
          <legend>{t('coworkers.glyphLabel')}</legend>
          <div className="cw-glyph-grid">
            {GLYPHS.map((g) => <button key={g} type="button" className={`cw-glyph-pick${draft.glyph.trim() === g ? ' is-selected' : ''}`} aria-pressed={draft.glyph.trim() === g} aria-label={t('coworkers.glyphPick', { glyph: g })} disabled={busy} onClick={() => edit({ glyph: g })}>{g}</button>)}
          </div>
          <label htmlFor={ids.glyph} className="cw-sub">{t('coworkers.glyphCustom', { max: COWORKER_GLYPH_MAX })}</label>
          <input id={ids.glyph} value={draft.glyph} disabled={busy} aria-invalid={problems.includes('glyph-long')} onChange={(e) => edit({ glyph: e.target.value })} />
        </fieldset>

        <fieldset className="cw-fieldset">
          <legend>{t('coworkers.tintLabel')}</legend>
          <div className="cw-tints">
            {TINTS.map((tint) => {
              const selected = (draft.tint || 'secondary') === tint;
              return <button key={tint} type="button" className={`cw-tint-pick cw-tint-${tint}${selected ? ' is-selected' : ''}`} aria-pressed={selected} disabled={busy} onClick={() => edit({ tint })}>
                <span className="cw-swatch" aria-hidden="true" />{t(`coworkers.tint.${tint}` as const)}
              </button>;
            })}
          </div>
        </fieldset>

        <label htmlFor={ids.brief}>{t('coworkers.briefLabel')}</label>
        <p className="space-hint" id={`${ids.brief}-hint`}>{t('coworkers.briefHint')}</p>
        <textarea id={ids.brief} className="cw-brief" value={draft.brief} disabled={busy} aria-invalid={problems.includes('brief-long')} aria-describedby={`${ids.brief}-hint ${ids.brief}-count`} onChange={(e) => edit({ brief: e.target.value })} />
        <p id={`${ids.brief}-count`} className={`space-hint${briefCount > COWORKER_BRIEF_MAX ? ' is-over' : ''}`}>{t('coworkers.briefCount', { count: briefCount, max: COWORKER_BRIEF_MAX })}</p>

        <fieldset className="cw-fieldset">
          <legend>{t('coworkers.toolsLabel')}</legend>
          {!toolsSupported ? <p className="space-hint">{t('coworkers.toolsLater')}</p>
            : boxesFailed ? <p className="space-note is-error" role="alert">{t('coworkers.toolsFailed')}</p>
            : !boxes ? <p className="space-hint" role="status">{t('coworkers.toolsLoading')}</p>
            : <>
                <p className="space-hint">{t('coworkers.toolsHint')}</p>
                <ul className="cw-checks">{boxes.map((b) => {
                  const copy = toolboxCopy(t, b);
                  const on = draft.toolboxes?.includes(b.id) ?? false;
                  return <li key={b.id}><label className="cw-check"><input type="checkbox" checked={on} disabled={busy} onChange={() => edit({ toolboxes: on ? (draft.toolboxes ?? []).filter((x) => x !== b.id) : [...(draft.toolboxes ?? []), b.id] })} /><span><strong>{copy.label}</strong><small>{copy.description}</small></span></label></li>;
                })}</ul>
              </>}
        </fieldset>

        <fieldset className="cw-fieldset">
          <legend>{t('coworkers.spacesLabel')}</legend>
          <p className="space-hint">{t('coworkers.spacesHint')}</p>
          {spacesFailed ? <p className="space-note is-error" role="alert">{t('coworkers.spacesFailed')}</p>
            : spaces && spaces.length === 0 ? <p className="space-hint">{t('coworkers.spacesNone')}</p>
            : <ul className="cw-checks">{(spaces ?? []).map((s) => {
                const on = draft.spaces.includes(s.id);
                return <li key={s.id}><label className="cw-check"><input type="checkbox" checked={on} disabled={busy} onChange={() => setForm((f) => ({ ...f, draft: withGrants(f.draft, on ? f.draft.spaces.filter((x) => x !== s.id) : [...f.draft.spaces, s.id]) }))} /><span><strong>{s.name}</strong></span></label></li>;
              })}</ul>}
          <label htmlFor={ids.default} className="cw-sub">{t('coworkers.defaultSpace')}</label>
          <select id={ids.default} value={draft.defaultSpace ?? ''} disabled={busy || draft.spaces.length === 0} onChange={(e) => edit({ defaultSpace: e.target.value || null })}>
            <option value="">{t('coworkers.defaultSpaceNone')}</option>
            {draft.spaces.map((id) => <option key={id} value={id}>{spaces?.find((s) => s.id === id)?.name ?? id}</option>)}
          </select>
        </fieldset>

        {error && <p className="space-note is-error" role="alert">{error}</p>}
        <div className="confirm-actions cw-actions">
          {mode.kind === 'edit' && <button type="button" className="btn btn-secondary cw-delete" disabled={busy} onClick={() => setConfirmDelete(true)}>{t('coworkers.delete')}</button>}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('coworkers.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{mode.kind === 'create' ? t('coworkers.create') : t('coworkers.save')}</button>
        </div>
      </form>
      {confirmDelete && mode.kind === 'edit' && <ConfirmDialog danger title={t('coworkers.deleteTitle', { name: mode.record.specialist.name })} body={t('coworkers.deleteBody')} confirmLabel={t('coworkers.deleteConfirm')} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)} />}
    </dialog>
  );
}
