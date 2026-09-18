import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchProfile, logout } from '../api';
import { ShellIcon } from './ShellIcon';
// Account, preferences and sign-out in one menu, as Claude's is (user review, 2026-09-18):
// the light/dark switch moved here from the sidebar head. It stays open after switching,
// so the change is seen from where it was made.
export function AccountMenu({ onSettings, theme, onToggleTheme }: { onSettings:(section?:'general'|'usage')=>void; theme?:'light'|'dark'; onToggleTheme?:()=>void }) {
  const [open,setOpen]=useState(false);
  const [name,setName]=useState('Your account');
  const [error,setError]=useState('');
  const ref=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const pop=useRef<HTMLDivElement>(null);
  // The menu renders into <body>: inside the collapsed 60px rail (overflow hidden) it was cut
  // down to its icons. Placed before paint — above the account row, or beside the avatar
  // when the rail is collapsed — and kept inside the viewport.
  const [at,setAt]=useState<{left:number;bottom:number}|null>(null);
  useLayoutEffect(()=>{
    if(!open){setAt(null);return;}
    const place=()=>{const r=trigger.current?.getBoundingClientRect();if(!r)return;
      const narrow=r.width<120, w=pop.current?.offsetWidth||260;
      const left=narrow?r.right+8:r.left;
      setAt({left:Math.max(8,Math.min(left,window.innerWidth-w-8)),bottom:Math.max(8,window.innerHeight-(narrow?r.bottom:r.top-8))});};
    place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);
  },[open]);
  useEffect(()=>{void fetchProfile().then(p=>setName(p.user.displayName || p.user.username)).catch(()=>undefined);},[open]);
  useEffect(()=>{
    if(!open)return;
    pop.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close=(e:PointerEvent)=>{const t=e.target as Node;if(!ref.current?.contains(t)&&!pop.current?.contains(t))setOpen(false);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};
  },[open]);
  return <div className="account-area" ref={ref}>
    {open&&createPortal(<div ref={pop} className="account-popover overlay is-floating" aria-label="Account options" style={at?{position:'fixed',left:at.left,bottom:at.bottom,top:'auto'}:{position:'fixed',visibility:'hidden'}}><div className="account-popover-head"><strong>{name}</strong><span>Personal workspace</span></div>
      <button onClick={()=>{setOpen(false);onSettings();}}><ShellIcon name="settings"/>Settings</button>
      <button onClick={()=>{setOpen(false);onSettings('usage');}}><ShellIcon name="grid"/>Usage</button>
      {onToggleTheme&&<button onClick={onToggleTheme}><ShellIcon name={theme==='dark'?'sun':'moon'}/>{theme==='dark'?'Light mode':'Dark mode'}</button>}
      <div className="account-divider"/>
      <button onClick={()=>void logout().then(()=>window.location.reload()).catch(()=>setError('Could not sign out. Please retry.'))}><ShellIcon name="arrow"/>Log out</button>
      {error&&<p role="alert">{error}</p>}
    </div>,document.body)}
    <button ref={trigger} className="account-trigger" aria-expanded={open} aria-label={`Account menu for ${name}`} onClick={()=>setOpen(!open)}><span className="shell-avatar">{name.slice(0,2).toUpperCase()}</span><span className="account-name">{name}</span><ShellIcon name="down" size={14}/></button>
  </div>;
}
