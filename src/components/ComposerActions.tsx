import { useEffect, useRef, useState } from 'react';
import type { Project, Toolbox } from '../types';
import { fetchToolboxes, saveProjectConfig, uploadProjectFile } from '../api';
import { fileToBase64, MAX_DOCUMENT_BYTES } from '../sources';

/** Composer shortcuts use the existing project APIs; enabling tools never approves a write. */
export function ComposerActions({ project, disabled, onChanged, onModels, onBusy, onStatus }: {
  project: Project | null; disabled: boolean; onChanged: () => void | Promise<void>;
  onModels: () => void; onBusy: (busy: boolean) => void; onStatus: (status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [boxes, setBoxes] = useState<Toolbox[]>([]);
  const [selected, setSelected] = useState(project?.toolboxes ?? ['core']);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setSelected(project?.toolboxes ?? ['core']); }, [project]);
  useEffect(() => { setOpen(false); setError(''); }, [project?.id]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError('');
    fetchToolboxes().then(value => {
      if (!active) return;
      setBoxes(value.toolboxes);
      if (value.mcp?.error) setError(`Some connected tools are unavailable: ${value.mcp.error}`);
    }).catch(() => { if (active) setError('Tools could not be loaded. Close and reopen to retry.'); })
      .finally(() => { if (active) setLoading(false); });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => { active = false; document.removeEventListener('pointerdown', outside); };
  }, [open]);
  const toggle = async (id: string) => {
    if (!project || saving || disabled) return;
    const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
    setSaving(true); onBusy(true); setError('');
    try { await saveProjectConfig(project.id, { toolboxes: next }); setSelected(next); await onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save tools.'); }
    finally { setSaving(false); onBusy(false); }
  };
  const upload = async (files: File[]) => {
    if (!project || !files.length || disabled) return;
    setOpen(false); onBusy(true);
    const failures: string[] = [];
    const started = Date.now();
    for (const [index, file] of files.entries()) {
      const status = (stage: string) => onStatus(`${index + 1}/${files.length} · ${file.name} · ${stage} · ${Math.round((Date.now() - started) / 1000)}s`);
      try {
        if (file.size > MAX_DOCUMENT_BYTES) throw new Error('File exceeds 25 MB');
        status('Reading file');
        await uploadProjectFile(project.id, { name: file.name, dataBase64: await fileToBase64(file) }, value => status(`${value.stage}${value.percent == null ? '' : ` ${value.percent}%`}`));
      } catch (err) { failures.push(`${file.name}: ${err instanceof Error ? err.message : 'Upload failed'}`); }
    }
    try { await onChanged(); }
    finally {
      onStatus(failures.length ? `Saved ${files.length - failures.length}/${files.length}. ${failures.join('; ')}` : `Saved ${files.length} ${files.length === 1 ? 'file' : 'files'} to ${project.name} · available to all chats in this project`);
      onBusy(false);
    }
  };
  const tokens = boxes.filter(box => selected.includes(box.id)).reduce((sum, box) => sum + box.estTokens, 0);
  return <div className="composer-actions" ref={root} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="composer-add" aria-label="Add files and tools" aria-expanded={open} aria-controls="composer-actions-panel" disabled={disabled || saving} onClick={() => setOpen(!open)}>+</button>
    <input ref={input} hidden type="file" multiple onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void upload(files); }} />
    {open && <div id="composer-actions-panel" className="composer-actions-panel" role="region" aria-label="Files and tools">
      <span className="composer-menu-label">Add to project</span>
      <button type="button" disabled={!project} onClick={() => input.current?.click()}>＋ <span>Files and photos<small>Up to 25 MB each · saved to project storage</small></span></button>
      {!project && <p>Open a project chat to attach files or choose tools.</p>}
      <details>
        <summary>Tools <span>›</span></summary>
        <p>Available to every chat in this project. The model chooses when to call them; writes still ask for approval.</p>
        {loading ? <p>Loading tools…</p> : <>
          {(['builtin', 'mcp'] as const).map(source => <div key={source}>
            <span className="composer-menu-label">{source === 'builtin' ? 'Built-in' : 'Connectors'}</span>
            {boxes.filter(box => box.source === source).map(box => <label className="composer-tool-option" key={box.id}>
              <input type="checkbox" checked={selected.includes(box.id)} disabled={!project || saving || disabled} onChange={() => void toggle(box.id)} />
              <span>{box.label}<small>{box.description} · {box.toolCount} tools</small></span>
            </label>)}
            {!boxes.some(box => box.source === source) && <p>No {source === 'builtin' ? 'built-in tools' : 'connectors'} available.</p>}
          </div>)}
          <p>{selected.length ? `Selected tools add approximately ${tokens.toLocaleString()} tokens per message. Model limits can reduce the available set.` : 'No tools selected.'}</p>
        </>}
      </details>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => { setOpen(false); onModels(); }}>◇ <span>Model and routing<small>Choose a model and review tool budgets</small></span></button>
    </div>}
  </div>;
}
