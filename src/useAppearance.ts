import { useEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import { apiFetch } from './api';
import { applyAppearance, parseAppearance, savedPalette, type Appearance, type Mode, type Palette } from './appearance';

export function useAppearance() {
  const initial = (): Appearance => ({theme:document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',light:savedPalette('light'),dark:savedPalette('dark')});
  const value = useRef<Appearance>(initial());
  const [theme, renderTheme] = useState(value.current.theme);
  const [appearanceStatus,setStatus] = useState('Loading profile appearance…');
  const [appearanceError,setError] = useState(false);
  const [attempt,retry] = useState(0);
  const pending = useRef<Partial<Appearance>>({});
  const change = useRef<(patch: Partial<Appearance>) => void>(()=>{});
  useEffect(()=>{
    let active=true, ready=false, saving=false, dirty=Object.keys(pending.current).length>0;
    const show = () => { applyAppearance(value.current); renderTheme(value.current.theme); };
    const save = async () => {
      if (!ready || saving || !active) return;
      saving=true;
      while(dirty && active) {
        dirty=false;setError(false);setStatus('Saving appearance…');
        const snapshot={...value.current};
        try {
          const response=await apiFetch('/api/profile/appearance',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
          if(!response.ok)throw Error('Save failed');
          parseAppearance(await response.json());
          for(const key of Object.keys(pending.current) as (keyof Appearance)[]) if(pending.current[key]===snapshot[key]) delete pending.current[key];
          if(active && !dirty)setStatus('Saved to your profile');
        } catch {
          if(active){setError(true);setStatus('Appearance could not be saved to your profile. Your choices are still applied here. Retry to save.');}
          break;
        }
      }
      saving=false;
    };
    change.current = next => {
      pending.current={...pending.current,...next}; value.current={...value.current,...next};dirty=true;show();void save();
    };
    const onPalette=(event:Event)=>{const {mode,palette}=(event as CustomEvent<{mode:Mode;palette:Palette}>).detail;change.current({[mode]:palette});};
    window.addEventListener('cowork:palette-change',onPalette);
    setError(false);setStatus('Loading profile appearance…');
    void (async()=>{
      try {
        const response=await apiFetch('/api/profile/appearance');
        if(!response.ok)throw Error('Load failed');
        const stored=await response.json();
        if(!active)return;
        const server=stored===null?value.current:parseAppearance(stored);
        value.current={...server,...pending.current};ready=true;show();
        if(stored===null || dirty){dirty=true;void save();}else setStatus('Saved to your profile');
      } catch {if(active){setError(true);setStatus('Profile appearance could not be loaded. Changes stay in this browser until you retry.');}}
    })();
    return()=>{active=false;window.removeEventListener('cowork:palette-change',onPalette);};
  },[attempt]);
  return {theme,setTheme:(next:SetStateAction<Mode>)=>change.current({theme:typeof next==='function'?next(value.current.theme):next}),appearanceStatus,appearanceError,retryAppearance:()=>retry(n=>n+1)};
}
