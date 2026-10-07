import { useEffect, useRef, useState } from 'react';
import { ContextMenu } from './ContextMenu';
import { ShellIcon } from './ShellIcon';
import { apiFetch } from '../api';
import { useT } from '../i18n';
import type { Project } from '../types';
type Effort = 'default' | 'low' | 'high';
type T = ReturnType<typeof useT>;
/** The composer's thinking levels: value, name, what each is for. */
export function thinkingLevels(t: T): [string, string, string][] {
  return [
    ['inherit',t('composer.thinking.auto'),t('composer.thinking.autoDesc')],
    ['low',t('composer.thinking.low'),t('composer.thinking.lowDesc')],
    ['default',t('composer.thinking.standard'),t('composer.thinking.standardDesc')],
    ['high',t('composer.thinking.high'),t('composer.thinking.highDesc')],
  ];
}
/** The name of a chat's current level ("Auto" when it inherits the deployment default). */
export function thinkingLevelLabel(t: T, effort: string | null | undefined): string {
  return thinkingLevels(t).find(([v])=>v===(effort ?? 'inherit'))?.[1] ?? t('composer.thinking.auto');
}
type Settings = { default: Effort; effort: Effort; mode: string; admin: boolean };
/** The effort settings for a project (or the deployment), refreshed when any control saves.
 *  Null while loading, when unavailable, or when `enabled` is false (nothing is fetched). #527:
 *  ChatView reads it too, so the phone model button only names a level the sheet can offer. */
export function useReasoningSettings(project: Project | null | undefined, enabled = true): Settings | null {
  const [revision,setRevision] = useState(0);
  useEffect(()=>{const refresh=()=>setRevision(n=>n+1);window.addEventListener('cowork-reasoning-updated',refresh);return()=>window.removeEventListener('cowork-reasoning-updated',refresh);},[]);
  const [settings,setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    if(!enabled){setSettings(null);return;}
    let stale=false;
    apiFetch('/api/reasoning-settings'+(project ? '?projectId='+encodeURIComponent(project.id) : ''))
      .then(async r=>{if(!r.ok)throw Error('Effort settings unavailable');return r.json();})
      .then(value=>{if(!stale && ['default','low','high'].includes(value.default))setSettings(value);})
      .catch(()=>{if(!stale)setSettings(null);});
    return()=>{stale=true;};
  },[enabled,revision,project?.id,project?.reasoningEffort,project?.model,project?.provider]);
  return settings;
}
export function ReasoningControl({ project, disabled, onChanged, global = false, variant = 'pill' }: {
  project?: Project | null; disabled?: boolean; onChanged?: () => void | Promise<void>; global?: boolean;
  /** `list` (#527): the phone model sheet's Thinking section, every level visible at once. */
  variant?: 'pill' | 'list';
}) {
  const t = useT();
  const fetched = useReasoningSettings(project);
  const [settings,setSettings] = useState<Settings | null>(null);
  useEffect(()=>{setSettings(fetched);},[fetched]);
  const [saving,setSaving] = useState(false), [error,setError] = useState('');
  const [menuAt,setMenuAt] = useState<{x:number;y:number}|null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if(!settings || (!global && !project))return null;
  const value=global ? settings.default : project?.reasoningEffort ?? 'inherit';
  const save=async(next:string)=>{
    setSaving(true);setError('');
    try {
      const response=await apiFetch(global ? '/api/reasoning-settings' : '/api/projects/'+encodeURIComponent(project!.id)+'/config',{
        method:global?'PUT':'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(global?{default:next}:{reasoningEffort:next==='inherit'?null:next}),
      });
      if(!response.ok)throw Error((await response.json()).error || 'Could not save effort');
      if(global)setSettings({...settings,default:next as Effort});
      await onChanged?.();
      window.dispatchEvent(new Event('cowork-reasoning-updated'));
    }catch(e){setError(String(e));}finally{setSaving(false);}
  };
  // In the composer it is a compact control: a glass pill naming the setting with the
  // current level muted beside it, opening an aero menu of levels with what each is for
  // (user review, 2026-09-18). The deployment default in Settings stays a plain select.
  if(!global){
    const levels=thinkingLevels(t);
    const current=levels.find(([v])=>v===value)?.[1]??t('composer.thinking.auto');
    const mode=settings.mode === 'real' ? t('composer.thinking.modeReal') : settings.mode === 'hint' ? t('composer.thinking.modeHint') : t('composer.thinking.modeProviderDecides');
    const hint=t('composer.thinking.hint',{mode});
    if(variant==='list'){
      return <section className="reasoning-control is-list mp-col" aria-labelledby="reasoning-list-title">
        <h3 className="mp-col-title" id="reasoning-list-title">{t('composer.thinking.label')}</h3>
        <div className="reasoning-levels" role="group" aria-labelledby="reasoning-list-title">
          {/* aria-disabled while saving, not disabled: a disabled button is blurred by the browser,
              which drops focus to <body> inside the modal sheet (#419). */}
          {levels.map(([v,label,description])=><button key={v} type="button" aria-pressed={v===value} className="reasoning-level"
            disabled={disabled} aria-disabled={saving||undefined} onClick={()=>{if(!saving&&v!==value)void save(v);}}>
            <span className="reasoning-level-text"><strong>{label}</strong><small>{description}</small></span>
            {v===value&&<ShellIcon name="check" size={16}/>}
          </button>)}
        </div>
        <p className="mp-hint">{hint}</p>
        {error && <span role="alert">{error}</span>}
      </section>;
    }
    return <span className="reasoning-control is-menu">
      <button ref={trigger} type="button" className="reasoning-pill glass is-press" aria-label={t('composer.thinking.ariaLabel')} aria-haspopup="menu" aria-expanded={!!menuAt} title={hint} disabled={disabled||saving}
        data-level={value} onClick={()=>{const r=trigger.current!.getBoundingClientRect();setMenuAt(menuAt?null:{x:r.right-280,y:r.top});}}>
        {/* #510: a phone shows the symbol in place of the word, and the level only when it is not Auto. */}
        <span className="reasoning-pill-icon" aria-hidden="true"><ShellIcon name="thinking" size={16}/></span>
        <span className="reasoning-pill-label">{t('composer.thinking.label')}</span><span className="reasoning-pill-value">{current}</span><ShellIcon name="down" size={14}/>
      </button>
      {menuAt&&<ContextMenu at={menuAt} placement="above" label={t('composer.thinking.ariaLabel')} onClose={()=>setMenuAt(null)}
        items={levels.map(([v,label,description])=>({label,description,selected:v===value,onSelect:()=>{if(v!==value)void save(v);}}))}/>}
      {error && <span role="alert">{error}</span>}
    </span>;
  }
  // Only reached with global=true: !global already returned the composer pill above.
  return <span className="reasoning-control">
    <label><span>{t('reasoning.defaultLabel')}</span>
      <select aria-label={t('reasoning.defaultLabel')} value={value} disabled={disabled || saving || !settings.admin} onChange={e=>void save(e.target.value)}>
        <option value="default">{t('composer.thinking.standard')}</option>
        <option value="low">{t('composer.thinking.low')}</option>
        <option value="high">{t('composer.thinking.high')}</option>
      </select>
    </label>
    <small>{t('reasoning.globalNote')}</small>
    {error && <span role="alert">{error}</span>}
  </span>;
}
