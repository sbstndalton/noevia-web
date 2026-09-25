import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch, fetchWorkspace, saveProjectConfig } from '../../api';
import { editOutcome, isCommitKey } from '../../memory-edit';
import { ConfirmDialog } from '../ContextMenu';
import { notifyWorkspaceChanged, useWorkspaceChanged } from '../data/workspace-changed';
import { useT } from '../../i18n';

type Saved = { memories: string[]; useProjectMemories: boolean; updatedAt: number | null; maxItems: number; maxItemChars: number };
type ProjectMemory = { id: string; name: string; memories: string[] };
const LOAD_ERROR = 'load';
type Confirm = { title: string; body: string; label: string; run: () => Promise<void> };

/** Settings → Memory (#228). Every source of remembered context that can reach a model, by scope:
 *  your account's lines, each project's lines, and the Diary, which is separate and never shared.
 *  Nothing is added automatically: every line here was written by you. Each line can be edited or
 *  forgotten, and each scope cleared, through the same account/project endpoints chat reads. */
export function MemorySettings({ onOpenDiary }: { onOpenDiary?: () => void } = {}): JSX.Element {
  const t = useT();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [projects, setProjects] = useState<ProjectMemory[] | null>(null);
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  useEffect(() => {
    let live = true;
    apiFetch('/api/account/memory').then(async (r) => {
      if (!r.ok) throw Error();
      const body: Saved = await r.json();
      if (live) setSaved(body);
    }).catch(() => { if (live) setError(LOAD_ERROR); });
    return () => { live = false; };
  }, []);
  const loadProjects = useCallback(() => {
    fetchWorkspace().then((w) => setProjects((w.projects || []).map((p) => ({ id: p.id, name: p.name, memories: Array.isArray(p.memories) ? p.memories : [] }))))
      .catch(() => setProjects([]));
  }, []);
  useEffect(loadProjects, [loadProjects]);
  useWorkspaceChanged(loadProjects);

  const putAccount = async (memories: string[], useProjectMemories: boolean, done: string) => {
    setBusy(true); setStatus(''); setError('');
    try {
      const r = await apiFetch('/api/account/memory', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memories, useProjectMemories }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(body.error || t('common.saveFailed'));
      setSaved(body); setStatus(done); return true;
    } catch (e) { setError(e instanceof Error ? e.message : t('common.saveFailed')); return false; }
    finally { setBusy(false); }
  };
  const putProject = async (project: ProjectMemory, memories: string[], done: string) => {
    setBusy(true); setStatus(''); setError('');
    try {
      await saveProjectConfig(project.id, { memories });
      setProjects((list) => list?.map((p) => (p.id === project.id ? { ...p, memories } : p)) ?? null);
      notifyWorkspaceChanged(); setStatus(done);
    } catch { setError(t('memory.projectSaveError', { project: project.name })); }
    finally { setBusy(false); }
  };

  const account = saved?.memories ?? [];
  const maxItems = saved?.maxItems ?? 50;
  const maxChars = saved?.maxItemChars ?? 300;
  const useProject = saved?.useProjectMemories ?? true;
  const add = async () => {
    const text = adding.replace(/\s+/g, ' ').trim();
    if (!text || !saved) return;
    if (await putAccount([...account, text], useProject, t('memory.remembered'))) setAdding('');
  };
  const saveEdit = async () => {
    if (!editing || !saved) return;
    const outcome = editOutcome(editing.text);
    // An emptied edit is a forget: ask first rather than deleting silently.
    if (outcome.kind === 'confirm-forget') { askForget(editing.index, account[editing.index] ?? ''); return; }
    const next = account.map((m, i) => (i === editing.index ? outcome.text : m));
    if (await putAccount(next, useProject, t('memory.updated'))) setEditing(null);
  };
  const askForget = (index: number, line: string) => setConfirm({ title: t('memory.forgetTitle'), body: t('memory.forgetBody', { line }), label: t('memory.forget'), run: async () => { if (await putAccount(account.filter((_, j) => j !== index), useProject, t('memory.forgotten'))) setEditing(null); } });
  const withProjects = (projects ?? []).filter((p) => p.memories.length);

  return <>
    <div className="settings-title"><h1>{t('settings.section.memory')}</h1><p>{t('memory.intro')}</p></div>

    <section className="settings-section" aria-labelledby="memory-account">
      <h2 id="memory-account">{t('memory.account')}</h2>
      <p className="set-row-desc">{t('memory.accountDesc')}</p>
      {saved === null && !error && <p className="route-note" role="status">{t('memory.loading')}</p>}
      {saved && <ul className="memory-list set-rows" aria-label={t('memory.accountList')}>
        {account.map((m, i) => <li key={`${i}:${m}`} className="memory-item">
          {editing?.index === i
            ? <><input aria-label={t('memory.edit')} value={editing.text} maxLength={maxChars} autoFocus disabled={busy} onChange={(e) => setEditing({ index: i, text: e.target.value })} onKeyDown={(e) => { if (isCommitKey(e.key, e.nativeEvent.isComposing)) void saveEdit(); if (e.key === 'Escape') setEditing(null); }} />
              <span className="memory-actions"><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveEdit()}>{t('common.save')}</button><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(null)}>{t('common.cancel')}</button></span></>
            : <><span className="memory-text">{m}</span>
              <span className="memory-actions"><button className="btn btn-ghost btn-sm" disabled={busy} aria-label={t('memory.editLine', { line: m })} onClick={() => setEditing({ index: i, text: m })}>{t('memory.editButton')}</button>
                <button className="btn btn-ghost btn-sm" disabled={busy} aria-label={t('memory.forgetLine', { line: m })} onClick={() => askForget(i, m)}>{t('memory.forget')}</button></span></>}
        </li>)}
        {!account.length && <li className="memory-empty">{t('memory.empty')}</li>}
      </ul>}
      {saved && <div className="memory-add">
        <input aria-label={t('memory.new')} placeholder={t('memory.newPlaceholder')} value={adding} maxLength={maxChars} disabled={busy || account.length >= maxItems} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (isCommitKey(e.key, e.nativeEvent.isComposing)) void add(); }} />
        <button className="modal-btn secondary" disabled={busy || !adding.trim() || account.length >= maxItems} onClick={() => void add()}>{t('memory.remember')}</button>
        <span className="personal-count">{account.length} / {maxItems}</span>
      </div>}
      {saved && account.length > 0 && <div className="personal-actions"><button className="btn btn-danger btn-sm" disabled={busy} onClick={() => setConfirm({ title: t('memory.clearAccountTitle'), body: t.plural('memory.clearAccountBody', account.length), label: t('memory.clearAll'), run: async () => { await putAccount([], useProject, t('memory.accountCleared')); } })}>{t('memory.clearAccount')}</button></div>}
    </section>

    <section className="settings-section" aria-labelledby="memory-projects">
      <h2 id="memory-projects">{t('memory.projects')}</h2>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">{t('memory.useProject')}</span><span className="set-row-desc">{t('memory.useProjectDesc')}</span></div>
          <div className="set-row-control"><input type="checkbox" role="switch" className="noevia-switch" aria-label={t('memory.useProject')} checked={useProject} disabled={saved === null || busy} onChange={(e) => void putAccount(account, e.currentTarget.checked, e.currentTarget.checked ? t('memory.projectOn') : t('memory.projectOff'))} /></div>
        </div>
      </div>
      {projects === null && <p className="route-note" role="status">{t('memory.loadingProjects')}</p>}
      {projects !== null && !withProjects.length && <p className="route-note">{t('memory.noProjects')}</p>}
      {withProjects.map((p) => <div key={p.id} className="memory-scope">
        <h3>{p.name}{!useProject && <small className="memory-off"> · {t('memory.notSent')}</small>}</h3>
        <ul className="memory-list set-rows" aria-label={t('memory.projectList', { project: p.name })}>
          {p.memories.map((m, i) => <li key={`${i}:${m}`} className="memory-item"><span className="memory-text">{m}</span>
            <span className="memory-actions"><button className="btn btn-ghost btn-sm" disabled={busy} aria-label={t('memory.forgetLineIn', { line: m, project: p.name })} onClick={() => setConfirm({ title: t('memory.forgetTitle'), body: t('memory.forgetBodyIn', { line: m, project: p.name }), label: t('memory.forget'), run: async () => { await putProject(p, p.memories.filter((_, j) => j !== i), t('memory.forgotten')); } })}>{t('memory.forget')}</button></span></li>)}
        </ul>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm({ title: t('memory.clearProjectTitle', { project: p.name }), body: t.plural('memory.clearProjectBody', p.memories.length), label: t('memory.clear'), run: async () => { await putProject(p, [], t('memory.projectCleared', { project: p.name })); } })}>{t('memory.clearProject')}</button>
      </div>)}
    </section>

    <section className="settings-section" aria-labelledby="memory-diary">
      <h2 id="memory-diary">{t('memory.diary')}</h2>
      <p className="set-row-desc">{t('memory.diaryDesc')}</p>
      {onOpenDiary && <button className="btn btn-secondary btn-sm" onClick={onOpenDiary}>{t('memory.openDiary')}</button>}
    </section>

    {status && <p className="route-note" role="status">{status}</p>}
    {error && <p className="modal-err" role="alert">{error === LOAD_ERROR ? t('memory.loadError') : error}</p>}
    {confirm && <ConfirmDialog title={confirm.title} body={confirm.body} confirmLabel={confirm.label} danger onCancel={() => setConfirm(null)} onConfirm={() => { const run = confirm.run; setConfirm(null); void run(); }} />}
  </>;
}
