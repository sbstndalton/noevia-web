import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { highlightSegments } from '../sidebar-search';

/** Measure the available width again when hover controls reserve their space.
 *  `highlight` (#439), when non-empty, wraps every case-insensitive match of it in `text`
 *  with a real `<mark>` — built from plain text segments, never `dangerouslySetInnerHTML`,
 *  so a query can never inject markup. */
export function SidebarLabel({text, highlight}: {text:string; highlight?: string}) {
  const clip=useRef<HTMLSpanElement>(null);
  const content=useRef<HTMLSpanElement>(null);
  const [distance,setDistance]=useState(0);
  useEffect(()=>{
    const measure=()=>setDistance(Math.max(0,(content.current?.scrollWidth || 0)-(clip.current?.clientWidth || 0)));
    const observer=new ResizeObserver(measure);
    if(clip.current)observer.observe(clip.current);
    if(content.current)observer.observe(content.current);
    measure();return ()=>observer.disconnect();
  },[text,highlight]);
  const segments = highlight ? highlightSegments(text, highlight) : null;
  return <span ref={clip} className={`sidebar-label${distance>1?' is-overflowing':''}`} title={text} style={{'--label-travel':`${-distance}px`,'--label-duration':`${Math.max(3,distance/28)}s`} as CSSProperties}><span ref={content} className="sidebar-label-text">{segments ? segments.map(s=>s.match ? <mark key={s.key} className="sidebar-search-highlight">{s.text}</mark> : <span key={s.key}>{s.text}</span>) : text}</span></span>;
}
