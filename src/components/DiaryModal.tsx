import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
export function DiaryModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; ref.current?.showModal(); return () => { ref.current?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className="diary-modal" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><button className="modal-btn secondary" onClick={onClose} aria-label="Close dialog">Close</button></header>
    {children}
  </dialog>;
}
export function MarkdownPreview({ text }: { text: string }) {
  // React escapes all source text. Raw HTML is deliberately never interpreted.
  const inline = (line: string) => line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => part.startsWith('**') ? <strong key={i}>{part.slice(2,-2)}</strong> : part.startsWith('`') ? <code key={i}>{part.slice(1,-1)}</code> : part);
  let fenced = false;
  return <div className="markdown-preview">{text.replace(/<!--[^]*?-->/g, '').split('\n').map((line,i) => {
    if (line.startsWith('```')) { fenced = !fenced; return null; }
    if (fenced) return <pre key={i}>{line || ' '}</pre>;
    if (/^# /.test(line)) return <h2 key={i}>{inline(line.slice(2))}</h2>;
    if (/^## /.test(line)) return <h3 key={i}>{inline(line.slice(3))}</h3>;
    if (/^### /.test(line)) return <h4 key={i}>{inline(line.slice(4))}</h4>;
    if (/^[-*] /.test(line)) return <p className="md-bullet" key={i}>• {inline(line.slice(2))}</p>;
    if (/^> /.test(line)) return <blockquote key={i}>{inline(line.slice(2))}</blockquote>;
    return line.trim() ? <p key={i}>{inline(line)}</p> : <div className="md-space" key={i} />;
  })}</div>;
}
