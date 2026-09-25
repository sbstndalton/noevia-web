import { useEffect, useRef, useState } from 'react';
import { ContextMenu } from './ContextMenu';
import { ShellIcon } from './ShellIcon';
import { apiFetch } from '../api';
import { useT } from '../i18n';
import type { Project } from '../types';
type Effort = 'default' | 'low' | 'high';
type Settings = { default: Effort; effort: Effort; mode: string; admin: boolean };
export function ReasoningControl({ project, disabled, onChanged, global = false }: {
  project?: Project | null; disabled?: boolean; onChanged?: () => void | Promise<void>; global?: boolean;
}) {
  const t = useT();
  const [revision,setRevision] = useState(0);
  useEffect(()=>{const refresh=()=>setRevision(n=>n+1);window.addEventListener('cowork-reasoning-updated',refresh);return()=>window.removeEventListener('cowork-reasoning-updated',refresh);},[]);
  const [settings,setSettings] = useState<Settings | null>(null);
  const [saving,setSaving] = useState(false), [error,setError] = useState('');
  const [menuAt,setMenuAt] = useState<{x:number;y:number}|null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let stale=false;
    apiFetch('/api/reasoning-settings'+(project ? '?projectId='+encodeURIComponent(project.id) : ''))
      .then(async r=>{if(!r.ok)throw Error('Effort settings unavailable');return r.json();})
      .then(value=>{if(!stale && ['default','low','high'].includes(value.default))setSettings(value);})
      .catch(()=>{if(!stale)setSettings(null);});
    return()=>{stale=true;};
  },[revision,project?.id,project?.reasoningEffort,project?.model,project?.provider]);
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
  // In the composer it is a Claude-style control: a glass pill naming the setting with the
  // current level muted beside it, opening an aero menu of levels with what each is for
  // (user review, 2026-09-18). The deployment default in Settings stays a plain select.
  if(!global){
    const levels:[string,string,string][]=[
      ['inherit',t('composer.thinking.auto'),t('composer.thinking.autoDesc')],
      ['low',t('composer.thinking.low'),t('composer.thinking.lowDesc')],
      ['default',t('composer.thinking.standard'),t('composer.thinking.standardDesc')],
      ['high',t('composer.thinking.high'),t('composer.thinking.highDesc')],
    ];
    const current=levels.find(([v])=>v===value)?.[1]??t('composer.thinking.auto');
    const mode=settings.mode === 'real' ? t('composer.thinking.modeReal') : settings.mode === 'hint' ? t('composer.thinking.modeHint') : t('composer.thinking.modeProviderDecides');
    const hint=t('composer.thinking.hint',{mode});
    return <span className="reasoning-control is-menu">
      <button ref={trigger} type="button" className="reasoning-pill glass glass-lens is-press" aria-label={t('composer.thinking.ariaLabel')} aria-haspopup="menu" aria-expanded={!!menuAt} title={hint} disabled={disabled||saving}
        onClick={()=>{const r=trigger.current!.getBoundingClientRect();setMenuAt(menuAt?null:{x:r.right-280,y:r.top});}}>
        <span>{t('composer.thinking.label')}</span><span className="reasoning-pill-value">{current}</span><ShellIcon name="down" size={14}/>
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
