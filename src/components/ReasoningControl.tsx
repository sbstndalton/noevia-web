import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { Project } from '../types';
type Effort = 'default' | 'low' | 'high';
type Settings = { default: Effort; effort: Effort; mode: string; admin: boolean };
export function ReasoningControl({ project, disabled, onChanged, global = false }: {
  project?: Project | null; disabled?: boolean; onChanged?: () => void | Promise<void>; global?: boolean;
}) {
  const [revision,setRevision] = useState(0);
  useEffect(()=>{const refresh=()=>setRevision(n=>n+1);window.addEventListener('cowork-reasoning-updated',refresh);return()=>window.removeEventListener('cowork-reasoning-updated',refresh);},[]);
  const [settings,setSettings] = useState<Settings | null>(null);
  const [saving,setSaving] = useState(false), [error,setError] = useState('');
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
  return <span className="reasoning-control">
    <label><span className={global ? '' : 'sr-only'}>{global?'Default thinking effort':'Thinking effort'}</span>
      <select aria-label={global?'Default thinking effort':'Thinking effort'} value={value} disabled={disabled || saving || (global && !settings.admin)} onChange={e=>void save(e.target.value)}>
        {!global && <option value="inherit">Inherit ({settings.default})</option>}
        <option value="default">Default</option><option value="low">Low</option><option value="high">High</option>
      </select>
    </label>
    {!global && <small title="Actual request mode is reported with the reply. Auto routing may select another model.">{settings.mode === 'real'?'Parameter':settings.mode === 'hint'?'Hint':'Provider default'}</small>}
    {global && <small>Applies unless a project overrides it. High hints request an 8,192-token output budget; provider limits still apply.</small>}
    {error && <span role="alert">{error}</span>}
  </span>;
}
