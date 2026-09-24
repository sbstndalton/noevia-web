import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Project, Toolbox } from '../types';
import { fetchToolboxes, saveProjectConfig, uploadProjectFile } from '../api';
import { fileToBase64, uploadLimit } from '../sources';
import { appLocale } from '../user-preferences';
import { ShellIcon } from './ShellIcon';
import { useT } from '../i18n';

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
  const toggle = async (id: string) => {
    if (!project || saving || disabled) return;
    const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
    setSaving(true); onBusy(true); setError('');
    try { await saveProjectConfig(project.id, { toolboxes: next }); setSelected(next); await onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : t('composer.toolsSaveError')); }
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
        if (file.size > uploadLimit(file.name)) throw new Error(t('composer.upload.tooLarge'));
        status(t('composer.upload.reading'));
        const result = await uploadProjectFile(project.id, { name: file.name, dataBase64: await fileToBase64(file) }, value => status(`${value.stage}${value.percent == null ? '' : ` ${value.percent}%`}`));
        if(result.attachment?.reduction?.note)notices.push(`${file.name}: ${result.attachment.reduction.note}`);
      } catch (err) { failures.push(`${file.name}: ${err instanceof Error ? err.message : t('composer.upload.failed')}`); }
    }
    try { await onChanged(); }
    finally {
      onStatus(failures.length ? t('composer.upload.partial', { saved: files.length - failures.length, total: files.length, failures: failures.join('; ') }) : `${t.plural('composer.upload.saved', files.length, { target: chatOnly ? t('composer.upload.thisChat') : project.name })} · ${t(diary ? 'composer.upload.extras' : chatOnly ? 'composer.upload.nextMessage' : 'composer.upload.allChats')}${notices.length ? ' · '+notices.join('; ') : ''}`);
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
          const on = selected.includes(box.id);
          return <button type="button" key={box.id} className="composer-menu-row composer-tool-option" role="menuitemcheckbox" aria-checked={on} disabled={!project || saving || disabled} onClick={() => void toggle(box.id)} title={t('composer.toolCount', { description: box.description, count: box.toolCount })}>
            <ShellIcon name={box.source === 'mcp' ? 'connectors' : 'tools'} size={18}/><span>{box.label}<small>{box.description}</small></span>
            <span className="composer-menu-check" aria-hidden="true">{on && <ShellIcon name="check" size={18}/>}</span>
          </button>;
        })}
        {!boxes.length && <p className="composer-menu-note">{t('composer.noTools')}</p>}
        {boxes.length > 0 && <p className="composer-menu-note">{selected.length ? t('composer.tokensNote', { tokens: tokens.toLocaleString(appLocale()) }) : t('composer.noToolsSelected')}</p>}
      </>}
      {error && <p className="composer-menu-note" role="alert">{error}</p>}
      {/* One inventory (#238): the menu links to Customise rather than growing a second manager. */}
      {!diary && <><div className="composer-menu-divider" role="separator"/><button type="button" className="composer-menu-row" onClick={() => { setOpen(false); window.dispatchEvent(new Event('noevia:open-customise')); }}>
        <ShellIcon name="plugins" size={18}/><span>{t('composer.manage')}<small>{t('composer.opensCustomise')}</small></span>
      </button></>}
    </div>}
  </div>;
}
