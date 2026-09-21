import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CloseButton } from './CloseButton';
import { readFrontmatter } from '../diary-markdown';
export function DiaryModal({ title, onClose, children, className = '' }: { className?: string; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; ref.current?.showModal(); return () => { ref.current?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className={`diary-modal aero dialog-sheet ${className}`} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><CloseButton onClick={onClose} label="Close dialog"/></header>
    {children}
  </dialog>;
}
// Only these schemes may become a clickable href. Model output is untrusted
// text: a `javascript:` (or `data:`) URL in a generated link would execute in
// the app's own origin if handed straight to an anchor, so anything else
// renders as plain text and keeps its URL visible.
const SAFE_LINK = /^(https?:|mailto:)/i;

/** A fenced block, rendered whole rather than one <pre> per line, with its
 *  language and a copy button. */
function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || 'text'}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(
              () => { setCopied(true); setTimeout(() => setCopied(false), 1200); },
              () => undefined,
            );
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function splitRow(line: string): string[] {
  // Drop the leading and trailing pipe, then split. A trailing empty cell from
  // "| a | b |" is an artefact of the delimiter, not a column.
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function MarkdownPreview({ text, internalLink, wikiLink, properties = false }: {
  text: string;
  internalLink?: (href: string) => (() => void) | undefined;
  /** Obsidian-style `[[links]]`. Parsed only where a surface knows how to open one, so text
   *  that merely contains double brackets keeps rendering exactly as it did. */
  wikiLink?: (link: { target: string; heading: string | null; alias: string | null }) => (() => void) | undefined;
  /** Show a leading YAML block as properties instead of as body text. Off by default: a chat
   *  message that opens with three dashes is not a note with properties. */
  properties?: boolean;
}) {
  // React escapes all source text. Raw HTML is deliberately never interpreted.
  // Order matters in this alternation: ** before *, so bold is not consumed by
  // the italic branch. The link branch allows one level of nested parentheses
  // so that URLs like .../Foo_(bar) survive — [^)\s]+ stopped at the first
  // ")" and truncated the href mid-URL.
  const inline = (line: string) =>
    line.split(wikiLink
      ? /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[\[[^\[\]\n]*\]\]|\[[^\]]+\]\((?:[^()\s]|\([^()\s]*\))+\))/g
      : /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\((?:[^()\s]|\([^()\s]*\))+\))/g).map((part, i) => {
      if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (wikiLink && part.startsWith('[[') && part.endsWith(']]')) {
        const body = part.slice(2, -2);
        const bar = body.indexOf('|');
        const raw = bar === -1 ? body : body.slice(0, bar);
        const alias = bar === -1 ? null : body.slice(bar + 1).trim();
        const hash = raw.indexOf('#');
        const target = (hash === -1 ? raw : raw.slice(0, hash)).trim();
        const heading = hash === -1 ? null : raw.slice(hash + 1).trim() || null;
        const label = alias || (heading && !target ? heading : target) || part;
        const open = wikiLink({ target, heading, alias });
        return open
          ? <button key={i} className="diary-markdown-link" onClick={open}>{label}</button>
          : <span key={i} className="diary-markdown-link-missing" title="No file of that name here">{label}</span>;
      }
      if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
      if (part.startsWith('[')) {
        const split = part.indexOf('](');
        const label = part.slice(1, split);
        const href = part.slice(split + 2, -1);
        if (!SAFE_LINK.test(href)) {
          const open=internalLink?.(href);
          return open ? <button key={i} className="diary-markdown-link" onClick={open}>{label}</button> : <span key={i}>{label} ({href})</span>;
        }
        return <a key={i} href={href} target="_blank" rel="noopener noreferrer nofollow">{label}</a>;
      }
      if (part.startsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
      return part;
    });

  // The note's properties, shown as what they are. The body is rendered from after the block,
  // so nothing is rewritten and nothing is shown twice.
  const front = properties ? readFrontmatter(text) : null;
  const source = front ? text.slice(front.bodyStart) : text;
  const lines = source.replace(/<!--[^]*?-->/g, '').split('\n');
  const out: ReactNode[] = [];
  if (front && (front.fields.length || front.unparsed.length)) {
    out.push(<dl className="markdown-properties" key="properties" aria-label="Properties">
      {front.fields.map((field, i) => <Fragment key={`${field.key}-${i}`}>
        <dt>{field.key}</dt>
        <dd>{field.values.length ? field.values.join(', ') : <span className="markdown-property-empty">empty</span>}</dd>
      </Fragment>)}
      {/* Lines this reader does not understand are shown as written rather than dropped: the
          file says something, and hiding it would be the one unforgivable thing here. */}
      {front.unparsed.map((line, i) => <Fragment key={`raw-${i}`}><dt/><dd><code>{line}</code></dd></Fragment>)}
    </dl>);
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Fenced code, collected to the closing fence (or the end, so a block
    // still streaming renders as it arrives rather than vanishing).
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) { body.push(lines[i]); i += 1; }
      out.push(<CodeBlock key={i} code={body.join('\n')} lang={lang} />);
      continue;
    }

    // A GFM table: a pipe row followed by a divider row. Anything less is just
    // a line that happens to contain a pipe.
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(splitRow(lines[i])); i += 1; }
      i -= 1;
      out.push(
        <div className="md-table-wrap" key={`t${i}`}>
          <table className="md-table">
            <thead><tr>{head.map((c, n) => <th key={n}>{inline(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, n) => (
              <tr key={n}>{head.map((_, c) => <td key={c}>{inline(r[c] ?? '')}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^#### /.test(line)) { out.push(<h4 key={i}>{inline(line.slice(5))}</h4>); continue; }
    if (/^# /.test(line)) { out.push(<h2 key={i}>{inline(line.slice(2))}</h2>); continue; }
    if (/^## /.test(line)) { out.push(<h3 key={i}>{inline(line.slice(3))}</h3>); continue; }
    if (/^### /.test(line)) { out.push(<h4 key={i}>{inline(line.slice(4))}</h4>); continue; }
    // Ordered lists keep the model's own numbering rather than restarting per
    // line, which is what a real <ol> would do to a streamed, line-at-a-time
    // render. Indented bullets are common in model output, so keep the indent.
    const ordered = /^(\s*)(\d+)\. (.*)$/.exec(line);
    if (ordered) {
      out.push(<p className="md-bullet" key={i} style={ordered[1] ? { paddingInlineStart: ordered[1].length * 8 } : undefined}><span className="md-pip">{ordered[2]}.</span> {inline(ordered[3])}</p>);
      continue;
    }
    const bullet = /^(\s*)[-*+] (.*)$/.exec(line);
    if (bullet) {
      // GFM task lists: a leading [ ] / [x] becomes a checkbox indicator.
      const task = /^\[( |x|X)\] (.*)$/.exec(bullet[2]);
      if (task) {
        out.push(
          <p className={`md-bullet md-task${task[1].toLowerCase() === 'x' ? ' md-task-done' : ''}`} key={i} style={bullet[1] ? { paddingInlineStart: bullet[1].length * 8 } : undefined}>
            <span className="md-task-box" aria-hidden="true">{task[1].toLowerCase() === 'x' ? '✓' : ''}</span> {inline(task[2])}
          </p>,
        );
        continue;
      }
      out.push(<p className="md-bullet" key={i} style={bullet[1] ? { paddingInlineStart: bullet[1].length * 8 } : undefined}><span className="md-pip">•</span> {inline(bullet[2])}</p>);
      continue;
    }
    if (/^> /.test(line)) { out.push(<blockquote key={i}>{inline(line.slice(2))}</blockquote>); continue; }
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) { out.push(<hr key={i} />); continue; }
    out.push(line.trim() ? <p key={i}>{inline(line)}</p> : <div className="md-space" key={i} />);
  }

  return <div className="markdown-preview">{out}</div>;
}
