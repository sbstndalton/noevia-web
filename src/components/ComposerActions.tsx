import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import type { Project, Toolbox } from '../types';
import { fetchToolboxes, saveProjectConfig, uploadProjectFile } from '../api';
import { fileToBase64, uploadLimit } from '../sources';
import { appLocale } from '../user-preferences';
import { ShellIcon } from './ShellIcon';
import { useT, type Translate } from '../i18n';

/** Everything the shared upload path needs, whether the files came from the hidden `<input
 *  type="file">` or a drop (#437) — same shape as the props {@link ComposerActions} already
 *  takes, so both call sites are guaranteed the same validation, size limits and error copy. */
export interface AttachmentSink {
  project: Project | null; disabled: boolean; diary?: boolean; chatOnly?: boolean;
  onChanged: () => void | Promise<void>; onBusy: (busy: boolean) => void; onStatus: (status: string) => void;
}

/** The one attachment pipeline: size check, base64 read, `uploadProjectFile`, per-file status and
 *  failure copy, then a single summary line. Extracted so drag-and-drop (#437) is a second way to
 *  call this, never a second implementation of it. */
export async function uploadAttachments(sink: AttachmentSink, files: File[], t: Translate): Promise<void> {
  const { project, disabled, diary = false, chatOnly = false, onChanged, onBusy, onStatus } = sink;
  if (!project || !files.length || disabled) return;
  onBusy(true);
  const failures: string[] = [], notices: string[] = [];
  const started = Date.now();
  for (const [index, file] of files.entries()) {
    const status = (stage: string) => onStatus(`${index + 1}/${files.length} · ${file.name} · ${stage} · ${Math.round((Date.now() - started) / 1000)}s`);
    try {
      if (file.size > uploadLimit(file.name)) throw new Error(t('composer.upload.tooLarge'));
      status(t('composer.upload.reading'));
      const result = await uploadProjectFile(project.id, { name: file.name, dataBase64: await fileToBase64(file) }, value => status(`${value.stage}${value.percent == null ? '' : ` ${value.percent}%`}`));
      if (result.attachment?.reduction?.note) notices.push(`${file.name}: ${result.attachment.reduction.note}`);
    } catch (err) { failures.push(`${file.name}: ${err instanceof Error ? err.message : t('composer.upload.failed')}`); }
  }
  try { await onChanged(); }
  finally {
    onStatus(failures.length ? t('composer.upload.partial', { saved: files.length - failures.length, total: files.length, failures: failures.join('; ') }) : `${t.plural('composer.upload.saved', files.length, { target: chatOnly ? t('composer.upload.thisChat') : project.name })} · ${t(diary ? 'composer.upload.extras' : chatOnly ? 'composer.upload.nextMessage' : 'composer.upload.allChats')}${notices.length ? ' · ' + notices.join('; ') : ''}`);
    onBusy(false);
  }
}

/** True only for a drag carrying files — a dragged link or selected text also fires these events,
 *  and must be left to the browser's own handling rather than treated as a (zero-file) drop. */
function isFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
}

/** Drag-and-drop onto the composer or, spread onto a bigger wrapper, the whole chat pane (#437) —
 *  same {@link uploadAttachments} pipeline the picker uses, so the same limits and error text
 *  apply and multiple files follow the picker's own rules. Ignores anything that is not a file
 *  drag (a dragged link or selection) and never fires while `sink.disabled` or project-less. */
export function useAttachmentDrop(sink: AttachmentSink): { isDragOver: boolean; dropProps: {
  onDragEnter: (event: DragEvent) => void; onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void; onDrop: (event: DragEvent) => void;
} } {
  const t = useT();
  const [isDragOver, setDragOver] = useState(false);
  // Nested elements each fire enter/leave as the pointer crosses their edges; a depth counter
  // (rather than the boolean state itself) is what tells a leave of a child from leaving the zone.
  const depth = useRef(0);
  const canDrop = !sink.disabled && !!sink.project;
  // Plain closures, recreated each render like the rest of this component's handlers — always
  // reading the sink/translator passed in on *this* render rather than a memoized, possibly stale
  // one from a `useCallback` dependency list.
  const onDragEnter = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (!canDrop) return;
    depth.current += 1;
    setDragOver(true);
  };
  const onDragOver = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = canDrop ? 'copy' : 'none';
  };
  const onDragLeave = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragOver(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depth.current = 0;
    setDragOver(false);
    if (!canDrop) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void uploadAttachments(sink, files, t);
  };
  return { isDragOver, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

/** Composer shortcuts use the existing project APIs; enabling tools never approves a write. */
export function ComposerActions({ project, disabled, onChanged, onBusy, onStatus, header, diary = false, chatOnly = false }: {
  header?: ReactNode; diary?: boolean; chatOnly?: boolean;
  project: Project | null; disabled: boolean; onChanged: () => void | Promise<void>;
  /** Unused: the model is chosen from the composer's model control, not duplicated here. */
  onModels?: () => void; onBusy: (busy: boolean) => void; onStatus: (status: string) => void;
}) {
  const panelId = useId();
  const t = useT();
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
      if (value.mcp?.error) setError(t('composer.toolsUnavailable', { error: value.mcp.error }));
    }).catch(() => { if (active) setError(t('composer.toolsLoadError')); })
      .finally(() => { if (active) setLoading(false); });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => { active = false; document.removeEventListener('pointerdown', outside); };
  }, [open]);
  // A connected connector (e.g. Google Drive) is never in the project's own toolboxes list — the
  // chat loop adds it on top because the account connected it (Settings → Connectors) — but it is
  // sent every turn regardless, so it must count as enabled here too, or the tool list and token
  // budget under-report what the next message actually sends (#354).
  const connectorIds = boxes.filter(box => box.connector).map(box => box.id);
  const effectiveSelected = connectorIds.length ? [...new Set([...selected, ...connectorIds])] : selected;
  const toggle = async (id: string) => {
    if (!project || saving || disabled) return;
    const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
    setSaving(true); onBusy(true); setError('');
    try { await saveProjectConfig(project.id, { toolboxes: next }); setSelected(next); await onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : t('composer.toolsSaveError')); }
    finally { setSaving(false); onBusy(false); }
  };
  // The picker's own call into the shared pipeline (#437) — closing the menu first is specific to
  // this trigger (a drop has no menu open to begin with); everything after that is one path.
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setOpen(false);
    await uploadAttachments({ project, disabled, diary, chatOnly, onChanged, onBusy, onStatus }, files, t);
  };
  const tokens = boxes.filter(box => effectiveSelected.includes(box.id)).reduce((sum, box) => sum + box.estTokens, 0);
  return <div className="composer-actions" ref={root} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    {/* Like Claude's: a centred SVG plus, and a menu of what can be added — files first, then
        the tools this chat may use, each ticked when on. The model lives in its own control on
        the other side of the composer, so it is not repeated here. */}
    <button ref={trigger} type="button" className="composer-add glass glass-lens is-press" aria-label={t('composer.addFilesAndTools')} aria-expanded={open} aria-controls={panelId} disabled={disabled || saving} onClick={() => setOpen(!open)}><ShellIcon name="plus" size={18}/></button>
    <input ref={input} hidden type="file" multiple onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void upload(files); }} />
    {open && <div id={panelId} className="composer-actions-panel overlay" style={menuLayout} role="region" aria-label={t('composer.filesAndTools')}>
      {header}
      <button type="button" className="composer-menu-row" disabled={!project} onClick={() => input.current?.click()}>
        <ShellIcon name="attach" size={18}/><span>{t('composer.addFiles')}<small>{diary ? t('composer.keptSeparate') : chatOnly ? t('composer.savedWithChat') : t('composer.savedTo', { name: project?.name ?? t('composer.theProject') })} · {t('composer.sizeLimit')}</small></span>
      </button>
      {!project && <p className="composer-menu-note">{diary ? t('composer.extrasNote') : t('composer.openProjectNote')}</p>}
      <div className="composer-menu-divider" role="separator"/>
      <span className="composer-menu-label">{diary ? t('composer.toolsExtras') : chatOnly ? t('composer.toolsChat') : t('composer.toolsProject')}</span>
      {loading ? <p className="composer-menu-note">{t('composer.loadingTools')}</p> : <>
        {(['builtin', 'mcp'] as const).flatMap(source => boxes.filter(box => box.source === source)).map(box => {
          const on = effectiveSelected.includes(box.id);
          // A connector is on because it's connected (Settings → Connectors), not picked here —
          // show it as already-enabled rather than a checkbox nobody can turn off from this menu.
          return <button type="button" key={box.id} className="composer-menu-row composer-tool-option" role="menuitemcheckbox" aria-checked={on} disabled={!project || saving || disabled || box.connector} onClick={() => void toggle(box.id)} title={t('composer.toolCount', { description: box.description, count: box.toolCount })}>
            <ShellIcon name={box.source === 'mcp' ? 'connectors' : 'tools'} size={18}/><span>{box.label}<small>{box.description}</small></span>
            <span className="composer-menu-check" aria-hidden="true">{on && <ShellIcon name="check" size={18}/>}</span>
          </button>;
        })}
        {!boxes.length && <p className="composer-menu-note">{t('composer.noTools')}</p>}
        {boxes.length > 0 && <p className="composer-menu-note">{effectiveSelected.length ? t('composer.tokensNote', { tokens: tokens.toLocaleString(appLocale()) }) : t('composer.noToolsSelected')}</p>}
      </>}
      {error && <p className="composer-menu-note" role="alert">{error}</p>}
      {/* One inventory (#238): the menu links to Customise rather than growing a second manager. */}
      {!diary && <><div className="composer-menu-divider" role="separator"/><button type="button" className="composer-menu-row" onClick={() => { setOpen(false); window.dispatchEvent(new Event('noevia:open-customise')); }}>
        <ShellIcon name="plugins" size={18}/><span>{t('composer.manage')}<small>{t('composer.opensCustomise')}</small></span>
      </button></>}
    </div>}
  </div>;
}
