import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CloseButton } from './CloseButton';
import { readFrontmatter } from '../diary-markdown';
import { useT } from '../i18n';
import { Icon } from './icons/Icon';
import { classifyImageSrc, imageHost } from '../markdown-image';
export function DiaryModal({ title, onClose, children, className = '' }: { className?: string; title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; ref.current?.showModal(); return () => { ref.current?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className={`diary-modal aero dialog-sheet ${className}`} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><CloseButton onClick={onClose} label={t('diary.modal.closeDialog')}/></header>
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
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || t('diary.markdown.plainText')}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(
              () => { setCopied(true); setTimeout(() => setCopied(false), 1200); },
              () => undefined,
            );
          }}
        >
          {copied ? t('diary.markdown.copied') : t('diary.markdown.copy')}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

/** `![alt](src)`, rendered as a real `<img>` only for a source that cannot leave the server
 *  unasked (see `markdown-image.ts`). A remote source cannot be a click-to-load `<img>` either:
 *  the server's own CSP is `img-src 'self' data:` (server/index.cjs), so a remote `<img>` src is
 *  blocked by the browser even after the reader asks for it — loosening that policy would defeat
 *  the reason it exists. So a remote source instead opens as a real link, in a new tab, only on
 *  request; anything this renderer has no sanitiser for falls back to plain text, exactly like the
 *  link branch above it. */
function MarkdownImage({ alt, src }: { alt: string; src: string }) {
  const t = useT();
  const kind = classifyImageSrc(src);
  if (kind === 'unsafe') return <span>{alt || src} ({src})</span>;
  if (kind === 'inline') return <img className="md-image" src={src} alt={alt} loading="lazy" />;
  const host = imageHost(src);
  const label = alt || t('diary.markdown.image.alt');
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="md-image-chip"
      aria-label={t('diary.markdown.image.ariaLabel', { alt: label, host })}
    >
      <Icon name="external-link" size={14} strokeWidth={1.75} />
      <span className="md-image-chip-text">
        <span className="md-image-chip-alt">{label}</span>
        <span className="md-image-chip-host">{host} · {t('diary.markdown.image.load')}</span>
      </span>
    </a>
  );
}

function splitRow(line: string): string[] {
  // Drop the leading and trailing pipe, then split. A trailing empty cell from
  // "| a | b |" is an artefact of the delimiter, not a column.
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** #431: one parsed list-item line — bulleted, ordered, or a GFM task ("- [ ]"/"- [x]"), keeping
 *  its own indent depth (raw leading-whitespace length) so a contiguous run of these can be
 *  rebuilt into a properly nested tree instead of one flat, indent-styled paragraph per line. */
type ListLine = { ordered: boolean; num?: string; task?: 'x' | ' '; indent: number; content: string };

function parseListLine(line: string): ListLine | null {
  // Ordered lists keep the model's own starting number (as an <ol start>) rather than restarting
  // at 1, which is what a real <ol> would otherwise do to a streamed, line-at-a-time render.
  const ordered = /^(\s*)(\d+)\. (.*)$/.exec(line);
  if (ordered) return { ordered: true, num: ordered[2], indent: ordered[1].length, content: ordered[3] };
  const bullet = /^(\s*)[-*+] (.*)$/.exec(line);
  if (bullet) {
    const task = /^\[( |x|X)\] (.*)$/.exec(bullet[2]);
    if (task) return { ordered: false, task: task[1].toLowerCase() === 'x' ? 'x' : ' ', indent: bullet[1].length, content: task[2] };
    return { ordered: false, indent: bullet[1].length, content: bullet[2] };
  }
  return null;
}

/** #431: rebuild a contiguous run of `ListLine`s (from `parseListLine`) into real, nested
 *  `<ul>`/`<ol>`/`<li>` — so a screen reader gets "list, N items" and per-item context instead of
 *  N unrelated paragraphs, while the visible result stays the same family of look (see the
 *  `.md-list`/`::marker`/`.md-task-box` rules in diary-tab.css). Deeper indentation nests a new
 *  list inside the previous item, exactly one level per call; a change of marker type (bullet vs.
 *  ordered) at the *same* indent ends the current list rather than mixing markers inside one — the
 *  same "start a new list" rule CommonMark uses. Streaming-safe: this is a pure function of the
 *  full current text on every render, same as the rest of this renderer, so a list that is still
 *  growing mid-stream just grows its last `<li>` — nothing here holds state across renders. */
function buildList(items: ListLine[], pos: number, indent: number, inline: (line: string) => ReactNode): [ReactNode, number] {
  const ordered = items[pos].ordered;
  const start = ordered ? Number(items[pos].num) : undefined;
  const lis: ReactNode[] = [];
  let i = pos;
  while (i < items.length && items[i].indent === indent && items[i].ordered === ordered) {
    const item = items[i];
    const key = i;
    i += 1;
    let nested: ReactNode = null;
    if (i < items.length && items[i].indent > indent) {
      const [node, next] = buildList(items, i, items[i].indent, inline);
      nested = node;
      i = next;
    }
    if (item.task !== undefined) {
      lis.push(
        <li key={key} className={`md-task${item.task === 'x' ? ' md-task-done' : ''}`}>
          <label className="md-task-label">
            {/* A real, disabled checkbox: assistive tech announces "checkbox, checked/not checked"
                for each item, not just a coloured span with a checkmark character (#431). */}
            <input type="checkbox" className="md-task-box" checked={item.task === 'x'} disabled readOnly />
            {inline(item.content)}
          </label>
          {nested}
        </li>,
      );
    } else {
      lis.push(<li key={key}>{inline(item.content)}{nested}</li>);
    }
  }
  const node = ordered
    ? <ol className="md-list" start={start}>{lis}</ol>
    : <ul className="md-list">{lis}</ul>;
  return [node, i];
}

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
  const t = useT();
  // React escapes all source text. Raw HTML is deliberately never interpreted.
  // Order matters in this alternation: ** before *, so bold is not consumed by
  // the italic branch. The link branch allows one level of nested parentheses
  // so that URLs like .../Foo_(bar) survive — [^)\s]+ stopped at the first
  // ")" and truncated the href mid-URL.
  const inline = (line: string) =>
    line.split(wikiLink
      ? /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[\[[^\[\]\n]*\]\]|!\[[^\]]*\]\((?:[^()\s]|\([^()\s]*\))+\)|\[[^\]]+\]\((?:[^()\s]|\([^()\s]*\))+\))/g
      : /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|!\[[^\]]*\]\((?:[^()\s]|\([^()\s]*\))+\)|\[[^\]]+\]\((?:[^()\s]|\([^()\s]*\))+\))/g).map((part, i) => {
      if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
      // Checked before the plain-link branch below: `![alt](src)` contains `[alt](src)` as a
      // substring, so without its own branch the leading "!" leaked as stray text while the rest
      // was treated as a link (#390).
      if (part.startsWith('![')) {
        const split = part.indexOf('](');
        return <MarkdownImage key={i} alt={part.slice(2, split)} src={part.slice(split + 2, -1)} />;
      }
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
          : <span key={i} className="diary-markdown-link-missing" title={t('diary.markdown.noFileOfThatName')}>{label}</span>;
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
    out.push(<dl className="markdown-properties" key="properties" aria-label={t('diary.markdown.properties')}>
      {front.fields.map((field, i) => <Fragment key={`${field.key}-${i}`}>
        <dt>{field.key}</dt>
        <dd>{field.values.length ? field.values.join(', ') : <span className="markdown-property-empty">{t('diary.markdown.empty')}</span>}</dd>
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

    // Six CommonMark levels map to five real heading tags (h1 is reserved for the page's own
    // title, never a chat reply) plus a modifier class for the deepest one, so every level stays
    // visually distinct instead of two levels colliding on one tag and the deepest two not
    // rendering as headings at all (#388). Longest prefix checked first since e.g. `/^### /`
    // would also be true of a `#### ` line's first four characters.
    if (/^###### /.test(line)) { out.push(<h6 className="md-h6-2" key={i}>{inline(line.slice(7))}</h6>); continue; }
    if (/^##### /.test(line)) { out.push(<h6 key={i}>{inline(line.slice(6))}</h6>); continue; }
    if (/^#### /.test(line)) { out.push(<h5 key={i}>{inline(line.slice(5))}</h5>); continue; }
    if (/^### /.test(line)) { out.push(<h4 key={i}>{inline(line.slice(4))}</h4>); continue; }
    if (/^## /.test(line)) { out.push(<h3 key={i}>{inline(line.slice(3))}</h3>); continue; }
    if (/^# /.test(line)) { out.push(<h2 key={i}>{inline(line.slice(2))}</h2>); continue; }
    // #431: bulleted, ordered and task lists render as real, nested <ul>/<ol>/<li> — collect the
    // whole contiguous run of list-item lines (any indent, any of the three kinds) up front, the
    // same way the fenced-code and blockquote branches collect their own runs, then hand it to
    // `buildList` once so nesting comes from the run as a whole rather than from one line alone.
    const firstListLine = parseListLine(line);
    if (firstListLine) {
      const items: ListLine[] = [firstListLine];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const next = parseListLine(lines[j]);
        if (!next) break;
        items.push(next);
      }
      // A run can contain more than one list: a marker-type change at the top indent (bullet then
      // ordered, or back again) ends the current list rather than mixing markers inside one, the
      // same rule CommonMark uses — so keep calling `buildList` for whatever indent/marker run is
      // left until the whole collected run of lines is accounted for.
      let pos = 0;
      while (pos < items.length) {
        const [node, next] = buildList(items, pos, items[pos].indent, inline);
        out.push(<Fragment key={i + pos}>{node}</Fragment>);
        pos = next;
      }
      i = j - 1;
      continue;
    }
    // Consecutive `>`-prefixed lines are one quoted passage, not one box per line (#389): collect
    // the whole run before emitting a single <blockquote>, the same way the fenced-code branch
    // above collects to its closing fence. A bare ">" (no trailing text) is a blank line inside
    // the quote, kept as its own line break rather than ending the block early.
    if (/^> /.test(line) || line === '>') {
      const quoted: string[] = [line === '>' ? '' : line.slice(2)];
      while (i + 1 < lines.length && (/^> /.test(lines[i + 1]) || lines[i + 1] === '>')) {
        i += 1;
        quoted.push(lines[i] === '>' ? '' : lines[i].slice(2));
      }
      out.push(
        <blockquote key={i}>
          {quoted.map((q, n) => <Fragment key={n}>{n > 0 && <br />}{inline(q)}</Fragment>)}
        </blockquote>,
      );
      continue;
    }
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) { out.push(<hr key={i} />); continue; }
    out.push(line.trim() ? <p key={i}>{inline(line)}</p> : <div className="md-space" key={i} />);
  }

  return <div className="markdown-preview">{out}</div>;
}
