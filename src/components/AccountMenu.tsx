import { useEffect, useRef, useState } from 'react';
import { fetchProfile, logout } from '../api';
import { ShellIcon } from './ShellIcon';
// The theme toggle lives in the sidebar head, where it is always visible;
// a second copy here was the same control twice, 200px apart.
export function AccountMenu({ onSettings }: { onSettings:()=>void }) {
  const [open,setOpen]=useState(false);
  const [name,setName]=useState('Your account');
  const [error,setError]=useState('');
  const ref=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{void fetchProfile().then(p=>setName(p.user.displayName || p.user.username)).catch(()=>undefined);},[open]);
  useEffect(()=>{
    if(!open)return;
    ref.current?.querySelector<HTMLButtonElement>('.account-popover button:not(:disabled)')?.focus();
    const close=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};
  },[open]);
  return <div className="account-area" ref={ref}>
    {open&&<div className="account-popover" aria-label="Account options"><div className="account-popover-head"><strong>{name}</strong><span>Personal workspace</span></div>
      <button onClick={()=>{setOpen(false);onSettings();}}><ShellIcon name="settings"/>Settings</button>
      <button disabled title="Not connected in this preview"><ShellIcon name="grid"/>Usage & activity <small>Preview</small></button>
      <div className="account-divider"/>
      <button onClick={()=>void logout().then(()=>window.location.reload()).catch(()=>setError('Could not sign out. Please retry.'))}><ShellIcon name="arrow"/>Log out</button>
      {error&&<p role="alert">{error}</p>}
    </div>}
    <button ref={trigger} className="account-trigger" aria-expanded={open} aria-label={`Account menu for ${name}`} onClick={()=>setOpen(!open)}><span className="shell-avatar">{name.slice(0,2).toUpperCase()}</span><span className="account-name">{name}</span><ShellIcon name="down" size={14}/></button>
  </div>;
}
