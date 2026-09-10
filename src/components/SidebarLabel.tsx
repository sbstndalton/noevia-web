import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/** Measure the available width again when hover controls reserve their space. */
export function SidebarLabel({text}: {text:string}) {
  const clip=useRef<HTMLSpanElement>(null);
  const content=useRef<HTMLSpanElement>(null);
  const [distance,setDistance]=useState(0);
  useEffect(()=>{
    const measure=()=>setDistance(Math.max(0,(content.current?.scrollWidth || 0)-(clip.current?.clientWidth || 0)));
    const observer=new ResizeObserver(measure);
    if(clip.current)observer.observe(clip.current);
    if(content.current)observer.observe(content.current);
    measure();return ()=>observer.disconnect();
  },[text]);
  return <span ref={clip} className={`sidebar-label${distance>1?' is-overflowing':''}`} title={text} style={{'--label-travel':`${-distance}px`,'--label-duration':`${Math.max(3,distance/28)}s`} as CSSProperties}><span ref={content} className="sidebar-label-text">{text}</span></span>;
}
