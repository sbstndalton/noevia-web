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
// Only these schemes may become a clickable href. Model output is untrusted
// text: a `javascript:` (or `data:`) URL in a generated link would execute in
// the app's own origin if handed straight to an anchor, so anything else
// renders as plain text and keeps its URL visible.
const SAFE_LINK = /^(https?:|mailto:)/i;

export function MarkdownPreview({ text }: { text: string }) {
  // React escapes all source text. Raw HTML is deliberately never interpreted.
  // Order matters in this alternation: ** before *, so bold is not consumed by
  // the italic branch.
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g).map((part, i) => {
      if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
      if (part.startsWith('[')) {
        const split = part.indexOf('](');
        const label = part.slice(1, split);
        const href = part.slice(split + 2, -1);
        if (!SAFE_LINK.test(href)) return <span key={i}>{label} ({href})</span>;
        return <a key={i} href={href} target="_blank" rel="noopener noreferrer nofollow">{label}</a>;
      }
      if (part.startsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
      return part;
    });
  let fenced = false;
  return <div className="markdown-preview">{text.replace(/<!--[^]*?-->/g, '').split('\n').map((line,i) => {
    if (line.startsWith('```')) { fenced = !fenced; return null; }
    if (fenced) return <pre key={i}>{line || ' '}</pre>;
    if (/^#### /.test(line)) return <h4 key={i}>{inline(line.slice(5))}</h4>;
    if (/^# /.test(line)) return <h2 key={i}>{inline(line.slice(2))}</h2>;
    if (/^## /.test(line)) return <h3 key={i}>{inline(line.slice(3))}</h3>;
    if (/^### /.test(line)) return <h4 key={i}>{inline(line.slice(4))}</h4>;
    // Ordered lists keep the model's own numbering rather than restarting per
    // line, which is what a real <ol> would do to a streamed, line-at-a-time
    // render. Indented bullets are common in model output, so keep the indent.
    const ordered = /^(\s*)(\d+)\. (.*)$/.exec(line);
    if (ordered) return <p className="md-bullet" key={i} style={ordered[1] ? { paddingInlineStart: ordered[1].length * 8 } : undefined}>{ordered[2]}. {inline(ordered[3])}</p>;
    const bullet = /^(\s*)[-*+] (.*)$/.exec(line);
    if (bullet) return <p className="md-bullet" key={i} style={bullet[1] ? { paddingInlineStart: bullet[1].length * 8 } : undefined}>• {inline(bullet[2])}</p>;
    if (/^> /.test(line)) return <blockquote key={i}>{inline(line.slice(2))}</blockquote>;
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) return <hr key={i} />;
    return line.trim() ? <p key={i}>{inline(line)}</p> : <div className="md-space" key={i} />;
  })}</div>;
}
