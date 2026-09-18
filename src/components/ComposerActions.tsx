import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Project, Toolbox } from '../types';
import { fetchToolboxes, saveProjectConfig, uploadProjectFile } from '../api';
import { fileToBase64, uploadLimit } from '../sources';
import { ShellIcon } from './ShellIcon';

/** Composer shortcuts use the existing project APIs; enabling tools never approves a write. */
export function ComposerActions({ project, disabled, onChanged, onBusy, onStatus, header, diary = false, chatOnly = false }: {
  header?: ReactNode; diary?: boolean; chatOnly?: boolean;
  project: Project | null; disabled: boolean; onChanged: () => void | Promise<void>;
  /** Unused: the model is chosen from the composer's model control, not duplicated here. */
  onModels?: () => void; onBusy: (busy: boolean) => void; onStatus: (status: string) => void;
}) {
  const panelId = useId();
  const [menuLayout, setMenuLayout] = useState<CSSProperties>({});
  const [open, setOpen] = useState(false);
  const [boxes, setBoxes] = useState<Toolbox[]>([]);
  const [selected, setSelected] = useState(project?.toolboxes ?? ['core']);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const above = rect.top - (window.innerWidth < 768 ? 112 : 76), below = window.innerHeight - rect.bottom - 20;
      const useBelow = above < 180 && below > above;
      setMenuLayout({ maxHeight: Math.max(60, Math.min(520, useBelow ? below : above)), top: useBelow ? 'calc(100% + 12px)' : 'auto', bottom: useBelow ? 'auto' : 'calc(100% + 12px)' });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  useEffect(() => { setSelected(project?.toolboxes ?? (diary ? [] : ['core'])); }, [project, diary]);
  useEffect(() => { if (!diary) setOpen(false); setError(''); }, [project?.id, diary]);
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
    const failures: string[] = [], notices: string[] = [];
    const started = Date.now();
    for (const [index, file] of files.entries()) {
      const status = (stage: string) => onStatus(`${index + 1}/${files.length} · ${file.name} · ${stage} · ${Math.round((Date.now() - started) / 1000)}s`);
      try {
        if (file.size > uploadLimit(file.name)) throw new Error('File exceeds the limit: 25 MB, or 60 MB for PDF reduction');
        status('Reading file');
        const result = await uploadProjectFile(project.id, { name: file.name, dataBase64: await fileToBase64(file) }, value => status(`${value.stage}${value.percent == null ? '' : ` ${value.percent}%`}`));
        if(result.attachment?.reduction?.note)notices.push(`${file.name}: ${result.attachment.reduction.note}`);
      } catch (err) { failures.push(`${file.name}: ${err instanceof Error ? err.message : 'Upload failed'}`); }
    }
    try { await onChanged(); }
    finally {
      onStatus(failures.length ? `Saved ${files.length - failures.length}/${files.length}. ${failures.join('; ')}` : `Saved ${files.length} ${files.length === 1 ? 'file' : 'files'} to ${chatOnly ? 'this chat' : project.name} · ${diary ? 'used only while extras are on' : chatOnly ? 'ready for your next message' : 'available to all chats in this project'}${notices.length ? ' · '+notices.join('; ') : ''}`);
      onBusy(false);
    }
  };
  const tokens = boxes.filter(box => selected.includes(box.id)).reduce((sum, box) => sum + box.estTokens, 0);
  return <div className="composer-actions" ref={root} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    {/* Like Claude's: a centred SVG plus, and a menu of what can be added — files first, then
        the tools this chat may use, each ticked when on. The model lives in its own control on
        the other side of the composer, so it is not repeated here. */}
    <button ref={trigger} type="button" className="composer-add glass glass-lens is-press" aria-label="Add files and tools" aria-expanded={open} aria-controls={panelId} disabled={disabled || saving} onClick={() => setOpen(!open)}><ShellIcon name="plus" size={18}/></button>
    <input ref={input} hidden type="file" multiple onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void upload(files); }} />
    {open && <div id={panelId} className="composer-actions-panel overlay" style={menuLayout} role="region" aria-label="Files and tools">
      {header}
      <button type="button" className="composer-menu-row" disabled={!project} onClick={() => input.current?.click()}>
        <ShellIcon name="attach" size={18}/><span>Add files or photos<small>{diary ? 'Kept in separate attachment storage' : chatOnly ? 'Saved with this chat' : `Saved to ${project?.name ?? 'the project'}`} · 25 MB, PDFs up to 60 MB</small></span>
      </button>
      {!project && <p className="composer-menu-note">{diary ? 'Enable extras to use attachments and connectors. Diary retrieval and capture remain active.' : 'Open a project chat to attach files or choose tools.'}</p>}
      <div className="composer-menu-divider" role="separator"/>
      <span className="composer-menu-label">{diary ? 'Tools while extras are on' : chatOnly ? 'Tools for this chat' : 'Tools for this project'}</span>
      {loading ? <p className="composer-menu-note">Loading tools…</p> : <>
        {(['builtin', 'mcp'] as const).flatMap(source => boxes.filter(box => box.source === source)).map(box => {
          const on = selected.includes(box.id);
          return <button type="button" key={box.id} className="composer-menu-row composer-tool-option" role="menuitemcheckbox" aria-checked={on} disabled={!project || saving || disabled} onClick={() => void toggle(box.id)} title={`${box.description} · ${box.toolCount} tools`}>
            <ShellIcon name={box.source === 'mcp' ? 'connectors' : 'tools'} size={18}/><span>{box.label}<small>{box.description}</small></span>
            <span className="composer-menu-check" aria-hidden="true">{on && <ShellIcon name="check" size={18}/>}</span>
          </button>;
        })}
        {!boxes.length && <p className="composer-menu-note">No tools available.</p>}
        {boxes.length > 0 && <p className="composer-menu-note">{selected.length ? `About ${tokens.toLocaleString()} tokens per message. The model decides when to call a tool; writes still ask first.` : 'No tools selected.'}</p>}
      </>}
      {error && <p className="composer-menu-note" role="alert">{error}</p>}
    </div>}
  </div>;
}
