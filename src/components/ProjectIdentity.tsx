import { useEffect, useId, useRef, useState } from 'react';
import icons from '../../server/project-icons.json';
import type { Project } from '../types';

export function ProjectIcon({ project, size = 20 }: { project: Pick<Project, 'icon' | 'color'>; size?: number }) {
  const icon = Object.hasOwn(icons, project.icon || '') ? icons[project.icon as keyof typeof icons] : icons.folder;
  const color = /^#[0-9a-f]{6}$/i.test(project.color || '') ? project.color : undefined;
  return <svg className="project-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ color }} aria-hidden="true"><path d={icon.path}/></svg>;
}
const colors = [['default','Default'],['#ee7474','Red'],['#e79a58','Orange'],['#d6b34d','Gold'],['#64b888','Green'],['#579fe5','Blue'],['#a087de','Purple'],['#db87b4','Pink']];
export function ProjectIdentityPicker({ icon, color, onChange }: { icon: string; color: string; onChange: (icon: string, color: string) => void }) {
  const details = useRef<HTMLDetailsElement>(null);
  const id = useId();
  useEffect(() => {
    const close = (e: PointerEvent) => { if(details.current?.open && !details.current.contains(e.target as Node)) details.current.open=false; };
    document.addEventListener('pointerdown', close);
    return ()=>document.removeEventListener('pointerdown', close);
  }, []);
  const [hex, setHex] = useState(color === 'default' ? '#579fe5' : color);
  const invalid = !/^#[0-9a-f]{6}$/i.test(hex);
  return <details className="project-identity-picker" ref={details} onKeyDown={e => {
    if (e.key === 'Escape' && details.current?.open) { e.preventDefault(); e.stopPropagation(); details.current.open = false; details.current.querySelector('summary')?.focus(); }
  }}>
    <summary aria-label="Choose project icon and color"><ProjectIcon project={{ icon, color }}/><span>Icon & color</span></summary>
    <div className="identity-options">
      <div className="identity-colors" role="group" aria-label="Project color">{colors.map(([value, label]) => <button type="button" key={value} aria-label={`${label} project color`} aria-pressed={color === value} onClick={() => onChange(icon, value)}><i style={{ background: value === 'default' ? 'var(--text-primary)' : value }}/></button>)}</div>
      <details className="identity-custom"><summary>Custom color</summary><div><input type="color" aria-label="Custom project color" value={invalid ? '#579fe5' : hex} onChange={e=>{setHex(e.target.value);onChange(icon,e.target.value);}}/><label htmlFor={id}>Hex</label><input id={id} value={hex} maxLength={7} aria-invalid={invalid} onChange={e=>{setHex(e.target.value);if(/^#[0-9a-f]{6}$/i.test(e.target.value))onChange(icon,e.target.value.toLowerCase());}}/></div>{invalid && <small>Use # followed by six hex digits.</small>}</details>
      <div className="identity-icons" role="group" aria-label="Project icon">{Object.entries(icons).map(([value, entry]) => <button type="button" key={value} aria-label={`${entry.label} icon`} title={entry.label} aria-pressed={icon === value} onClick={()=>onChange(value,color)}><ProjectIcon project={{icon:value,color}}/></button>)}</div>
      <button className="identity-done" type="button" onClick={()=>{if(details.current){details.current.open=false;details.current.querySelector('summary')?.focus();}}}>Done</button>
    </div>
  </details>;
}
