import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchProfile, logout } from '../api';
import { useT } from '../i18n';
import { ShellIcon } from './ShellIcon';
import { useMenuNav } from '../menu-nav';
// Account, preferences and sign-out in one menu, as Claude's is (user review, 2026-09-18):
// the light/dark switch moved here from the sidebar head. It stays open after switching,
// so the change is seen from where it was made.
export function AccountMenu({ onSettings, theme, onToggleTheme }: { onSettings:(section?:'general'|'usage')=>void; theme?:'light'|'dark'; onToggleTheme?:()=>void }) {
  const t=useT();
  const [open,setOpen]=useState(false);
  const [name,setName]=useState(()=>t('account.defaultName'));
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
  },[open]);
  const close=useCallback(()=>setOpen(false),[]);
  useMenuNav(open,pop,trigger,close);
  return <div className="account-area" ref={ref}>
    {open&&createPortal(<div ref={pop} className="account-popover overlay is-floating" role="menu" aria-label={t('account.optionsLabel')} style={at?{position:'fixed',left:at.left,bottom:at.bottom,top:'auto'}:{position:'fixed',visibility:'hidden'}}><div className="account-popover-head"><strong>{name}</strong><span>{t('account.personalWorkspace')}</span></div>
      <button role="menuitem" onClick={()=>{setOpen(false);onSettings();}}><ShellIcon name="settings"/>{t('account.settings')}</button>
      <button role="menuitem" onClick={()=>{setOpen(false);onSettings('usage');}}><ShellIcon name="grid"/>{t('account.usage')}</button>
      {onToggleTheme&&<button role="menuitem" onClick={onToggleTheme}><ShellIcon name={theme==='dark'?'sun':'moon'}/>{theme==='dark'?t('account.lightMode'):t('account.darkMode')}</button>}
      <div className="account-divider"/>
      <button role="menuitem" onClick={()=>void logout().then(()=>window.location.reload()).catch(()=>setError(t('account.signOutError')))}><ShellIcon name="arrow"/>{t('account.logOut')}</button>
      {error&&<p role="alert">{error}</p>}
    </div>,document.body)}
    <button ref={trigger} className="account-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={t('account.menuLabel',{name})} onClick={()=>setOpen(!open)}><span className="shell-avatar">{name.slice(0,2).toUpperCase()}</span><span className="account-name">{name}</span><ShellIcon name="down" size={14}/></button>
  </div>;
}
