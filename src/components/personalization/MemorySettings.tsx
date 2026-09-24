import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch, fetchWorkspace, saveProjectConfig } from '../../api';
import { editOutcome, isCommitKey } from '../../memory-edit';
import { ConfirmDialog } from '../ContextMenu';
import { notifyWorkspaceChanged, useWorkspaceChanged } from '../data/workspace-changed';

type Saved = { memories: string[]; useProjectMemories: boolean; updatedAt: number | null; maxItems: number; maxItemChars: number };
type ProjectMemory = { id: string; name: string; memories: string[] };
type Confirm = { title: string; body: string; label: string; run: () => Promise<void> };

/** Settings → Memory (#228). Every source of remembered context that can reach a model, by scope:
 *  your account's lines, each project's lines, and the Diary, which is separate and never shared.
 *  Nothing is added automatically: every line here was written by you. Each line can be edited or
 *  forgotten, and each scope cleared, through the same account/project endpoints chat reads. */
export function MemorySettings({ onOpenDiary }: { onOpenDiary?: () => void } = {}): JSX.Element {
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
    }).catch(() => { if (live) setError('Your memory could not be loaded.'); });
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
      if (!r.ok) throw Error(body.error || 'Could not save. Try again.');
      setSaved(body); setStatus(done); return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); return false; }
    finally { setBusy(false); }
  };
  const putProject = async (project: ProjectMemory, memories: string[], done: string) => {
    setBusy(true); setStatus(''); setError('');
    try {
      await saveProjectConfig(project.id, { memories });
      setProjects((list) => list?.map((p) => (p.id === project.id ? { ...p, memories } : p)) ?? null);
      notifyWorkspaceChanged(); setStatus(done);
    } catch { setError(`Memory for ${project.name} could not be saved. Try again.`); }
    finally { setBusy(false); }
  };

  const account = saved?.memories ?? [];
  const maxItems = saved?.maxItems ?? 50;
  const maxChars = saved?.maxItemChars ?? 300;
  const useProject = saved?.useProjectMemories ?? true;
  const add = async () => {
    const text = adding.replace(/\s+/g, ' ').trim();
    if (!text || !saved) return;
    if (await putAccount([...account, text], useProject, 'Remembered. New messages use it.')) setAdding('');
  };
  const saveEdit = async () => {
    if (!editing || !saved) return;
    const outcome = editOutcome(editing.text);
    // An emptied edit is a forget: ask first rather than deleting silently.
    if (outcome.kind === 'confirm-forget') { askForget(editing.index, account[editing.index] ?? ''); return; }
    const next = account.map((m, i) => (i === editing.index ? outcome.text : m));
    if (await putAccount(next, useProject, 'Updated. New messages use the corrected line.')) setEditing(null);
  };
  const askForget = (index: number, line: string) => setConfirm({ title: 'Forget this line?', body: `“${line}” will no longer be sent with new messages. Past replies are not changed.`, label: 'Forget', run: async () => { if (await putAccount(account.filter((_, j) => j !== index), useProject, 'Forgotten.')) setEditing(null); } });
  const withProjects = (projects ?? []).filter((p) => p.memories.length);

  return <>
    <div className="settings-title"><h1>Memory</h1><p>What noevia remembers about you, where it applies, and how to make it forget. Only lines you write are remembered; nothing is added automatically.</p></div>

    <section className="settings-section" aria-labelledby="memory-account">
      <h2 id="memory-account">Your account</h2>
      <p className="set-row-desc">Used in every chat, inside projects too, but never in the Diary. Forgetting a line removes it from future messages; past replies are not changed.</p>
      {saved === null && !error && <p className="route-note" role="status">Loading memory…</p>}
      {saved && <ul className="memory-list set-rows" aria-label="Account memory">
        {account.map((m, i) => <li key={`${i}:${m}`} className="memory-item">
          {editing?.index === i
            ? <><input aria-label="Edit memory" value={editing.text} maxLength={maxChars} autoFocus disabled={busy} onChange={(e) => setEditing({ index: i, text: e.target.value })} onKeyDown={(e) => { if (isCommitKey(e.key, e.nativeEvent.isComposing)) void saveEdit(); if (e.key === 'Escape') setEditing(null); }} />
              <span className="memory-actions"><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveEdit()}>Save</button><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</button></span></>
            : <><span className="memory-text">{m}</span>
              <span className="memory-actions"><button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Edit “${m}”`} onClick={() => setEditing({ index: i, text: m })}>Edit</button>
                <button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Forget “${m}”`} onClick={() => askForget(i, m)}>Forget</button></span></>}
        </li>)}
        {!account.length && <li className="memory-empty">Nothing remembered yet.</li>}
      </ul>}
      {saved && <div className="memory-add">
        <input aria-label="New memory" placeholder="I work as a nurse in Bergen." value={adding} maxLength={maxChars} disabled={busy || account.length >= maxItems} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (isCommitKey(e.key, e.nativeEvent.isComposing)) void add(); }} />
        <button className="modal-btn secondary" disabled={busy || !adding.trim() || account.length >= maxItems} onClick={() => void add()}>Remember</button>
        <span className="personal-count">{account.length} / {maxItems}</span>
      </div>}
      {saved && account.length > 0 && <div className="personal-actions"><button className="btn btn-danger btn-sm" disabled={busy} onClick={() => setConfirm({ title: 'Clear account memory?', body: `noevia will forget all ${account.length} line${account.length === 1 ? '' : 's'}. Project memory and the Diary are not affected.`, label: 'Clear all', run: async () => { await putAccount([], useProject, 'Account memory cleared.'); } })}>Clear account memory</button></div>}
    </section>

    <section className="settings-section" aria-labelledby="memory-projects">
      <h2 id="memory-projects">Projects</h2>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">Use project memory</span><span className="set-row-desc">When on, a chat inside a project also gets that project’s lines, after your account’s. When off, they stay saved but are not sent.</span></div>
          <div className="set-row-control"><input type="checkbox" role="switch" className="noevia-switch" aria-label="Use project memory" checked={useProject} disabled={saved === null || busy} onChange={(e) => void putAccount(account, e.currentTarget.checked, e.currentTarget.checked ? 'Project memory is used again.' : 'Project memory kept, but no longer sent.')} /></div>
        </div>
      </div>
      {projects === null && <p className="route-note" role="status">Loading projects…</p>}
      {projects !== null && !withProjects.length && <p className="route-note">No project has saved memory. Add lines from a project’s settings.</p>}
      {withProjects.map((p) => <div key={p.id} className="memory-scope">
        <h3>{p.name}{!useProject && <small className="memory-off"> · not sent</small>}</h3>
        <ul className="memory-list set-rows" aria-label={`Memory for ${p.name}`}>
          {p.memories.map((m, i) => <li key={`${i}:${m}`} className="memory-item"><span className="memory-text">{m}</span>
            <span className="memory-actions"><button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Forget “${m}” in ${p.name}`} onClick={() => setConfirm({ title: 'Forget this line?', body: `“${m}” will no longer be sent in ${p.name}. Past replies are not changed.`, label: 'Forget', run: async () => { await putProject(p, p.memories.filter((_, j) => j !== i), 'Forgotten.'); } })}>Forget</button></span></li>)}
        </ul>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm({ title: `Clear memory for ${p.name}?`, body: `All ${p.memories.length} line${p.memories.length === 1 ? '' : 's'} saved in this project will be forgotten. Its files and instructions stay.`, label: 'Clear', run: async () => { await putProject(p, [], `Memory for ${p.name} cleared.`); } })}>Clear this project’s memory</button>
      </div>)}
    </section>

    <section className="settings-section" aria-labelledby="memory-diary">
      <h2 id="memory-diary">Diary</h2>
      <p className="set-row-desc">The Diary keeps its own memory files (MEMORY.md and its memory folders) in your Diary storage. They are used only by the Diary and are never sent with chats or projects, and nothing on this page reads or changes them.</p>
      {onOpenDiary && <button className="btn btn-secondary btn-sm" onClick={onOpenDiary}>Open the Diary to review its memory</button>}
    </section>

    {status && <p className="route-note" role="status">{status}</p>}
    {error && <p className="modal-err" role="alert">{error}</p>}
    {confirm && <ConfirmDialog title={confirm.title} body={confirm.body} confirmLabel={confirm.label} danger onCancel={() => setConfirm(null)} onConfirm={() => { const run = confirm.run; setConfirm(null); void run(); }} />}
  </>;
}
