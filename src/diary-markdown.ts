/** Source positions only: never rewrite Markdown, frontmatter or fenced code. */
export function markdownOutline(text: string): { label: string; offset: number }[] {
  const out: {label:string;offset:number}[] = [];
  let offset = 0, fence: {char:string;length:number} | null = null;
  const lines = text.split('\n');
  let frontmatter = lines[0]?.trim()==='---';
  for (let i=0;i<lines.length;i++) {
    const line=lines[i], start=offset;offset+=line.length+1;
    if (frontmatter) { if(i>0 && /^(---|\.\.\.)\s*$/.test(line))frontmatter=false; continue; }
    const marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if(!fence)fence={char:marker[1][0],length:marker[1].length};
      else if(marker[1][0]===fence.char && marker[1].length>=fence.length && !marker[2].trim())fence=null;
      continue;
    }
    if(fence)continue;
    const heading=/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if(heading)out.push({label:heading[1],offset:start});
    if(out.length>=200)break;
  }
  return out;
}

/** Resolve ordinary relative .md links inside the tenant root; other links stay text. */
export function resolveMarkdownPath(base: string, href: string): string | null {
  let path: string;
  try { path=decodeURIComponent(href); } catch { return null; }
  if(!path || path.length>500 || /[\\\u0000-\u001f:?#]/.test(path) || path.startsWith('/') || !path.toLowerCase().endsWith('.md'))return null;
  const parts=base.split('/').slice(0,-1);
  for(const part of path.split('/')) {
    if(part==='.')continue;
    if(part==='..'){if(!parts.length)return null;parts.pop();continue;}
    if(!part || part.startsWith('.'))return null;
    parts.push(part);
  }
  return parts.join('/');
}

/** Inline file links only, matching the preview's supported Markdown subset. */
export function markdownFileLinks(text: string): {href:string;offset:number;length:number}[] {
  const links:{href:string;offset:number;length:number}[]=[];
  let offset=0,fence:{char:string;length:number}|null=null;
  for(const line of text.split('\n')){
    const start=offset;offset+=line.length+1;
    const marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if(marker){if(!fence)fence={char:marker[1][0],length:marker[1].length};else if(marker[1][0]===fence.char && marker[1].length>=fence.length && !marker[2].trim())fence=null;continue;}
    if(fence)continue;
    const visible=line.replace(/(`+)(.*?)\1/g,part=>' '.repeat(part.length));
    for(const match of visible.matchAll(/\[[^\]]+\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g)){
      if(visible[match.index-1]==='!')continue;
      links.push({href:match[1],offset:start+match.index,length:match[0].length});
    }
  }
  return links;
}

/**
 * Obsidian-style internal links: `[[note]]`, `[[note|shown as this]]`, `[[note#heading]]`,
 * `[[note#^block]]` and the embedding form `![[note]]`. A vault kept in Obsidian is full of
 * them, and noevia used to render every one as literal text — so a diary written there looked
 * broken here and its links were invisible to backlinks.
 *
 * Positions only. Nothing rewrites the file: the vault stays exactly as its owner wrote it.
 */
export type WikiLink = {
  target: string;          // before the "#": may be empty for a link inside the same file
  heading: string | null;  // after the "#", including a leading "^" for a block reference
  alias: string | null;    // after the "|"
  embed: boolean;          // the `![[…]]` form
  offset: number;
  length: number;
};

export function markdownWikiLinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  let offset = 0, fence: {char:string;length:number} | null = null;
  for (const line of text.split('\n')) {
    const start = offset; offset += line.length + 1;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) { if(!fence)fence={char:marker[1][0],length:marker[1].length}; else if(marker[1][0]===fence.char && marker[1].length>=fence.length && !marker[2].trim())fence=null; continue; }
    if (fence) continue;
    // Inline code is text, not a link, in Obsidian too.
    const visible = line.replace(/(`+)(.*?)\1/g, (part) => ' '.repeat(part.length));
    for (const match of visible.matchAll(/\[\[([^\[\]\n|]*)(?:\|([^\[\]\n]*))?\]\]/g)) {
      const raw = match[1];
      const hash = raw.indexOf('#');
      const target = (hash === -1 ? raw : raw.slice(0, hash)).trim();
      const heading = hash === -1 ? null : raw.slice(hash + 1).trim() || null;
      const embed = visible[match.index - 1] === '!';
      links.push({ target, heading, alias: match[2] === undefined ? null : match[2].trim(),
        embed, offset: start + match.index - (embed ? 1 : 0), length: match[0].length + (embed ? 1 : 0) });
      if (links.length >= 500) return links;
    }
  }
  return links;
}

/**
 * Where a wiki link could point, best candidate first. Obsidian resolves a bare name against
 * the whole vault, preferring the one nearest the root; noevia has no index of the vault, so it
 * offers the two placements that cover almost every real link — from the Diary folder, then
 * beside the file that names it — and the caller opens the first that exists.
 *
 * Only Markdown is resolved. An attachment (`![[figure.png]]`) stays text, as it does in the
 * preview, rather than becoming a link that cannot open.
 */
export function wikiLinkCandidates(base: string, root: string, target: string): string[] {
  const name = target.trim();
  if (!name || name.length > 300 || /[\\\u0000-\u001f:?]/.test(name) || name.startsWith('/')) return [];
  const withExtension = /\.md$/i.test(name) ? name : `${name}.md`;
  if (withExtension.split('/').some((part) => !part || part.startsWith('.'))) return [];
  const fromRoot = resolveMarkdownPath(root ? `${root}/x` : 'x', withExtension);
  const beside = resolveMarkdownPath(base, withExtension);
  return [...new Set([fromRoot, beside].filter((p): p is string => !!p))];
}

/**
 * The `[[` a person is in the middle of typing, if the caret is inside one. Used to offer the
 * files they could mean: writing a link by hand means remembering an exact name, which is the
 * part of linking that people stop doing.
 *
 * Returns where the name starts (just after the brackets) and what has been typed so far.
 */
export function wikiLinkQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const before = text.slice(lineStart, caret);
  const open = before.lastIndexOf('[[');
  if (open === -1) return null;
  const query = before.slice(open + 2);
  // Already closed, or spilling past what a name can be: not a link in progress.
  if (query.includes(']]') || query.includes('[')) return null;
  if (query.length > 120) return null;
  return { start: lineStart + open + 2, query };
}

/** How a link to this file should read: its own name when that is unambiguous, else its path. */
export function wikiLinkNameFor(path: string, root: string, all: string[]): string {
  const relative = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const withoutExtension = relative.replace(/\.md$/i, '');
  const base = withoutExtension.split('/').pop() || withoutExtension;
  const sameName = all.filter((other) => {
    const otherRelative = root && other.startsWith(`${root}/`) ? other.slice(root.length + 1) : other;
    return (otherRelative.replace(/\.md$/i, '').split('/').pop() || '') === base;
  });
  return sameName.length > 1 ? withoutExtension : base;
}

/**
 * The YAML block a note may open with. Obsidian calls these properties and shows them as a
 * small table; noevia used to render the whole block as body text, so a vault opened here
 * began with three dashes and a list of keys pretending to be prose.
 *
 * A deliberately small subset of YAML — scalars, `[a, b]` and `- a` lists — because that is
 * what notes actually contain, and because guessing at the rest would mean showing something
 * the file does not say. Anything it cannot read stays in `unparsed`, shown as written.
 */
export type Frontmatter = {
  fields: { key: string; values: string[] }[];
  unparsed: string[];
  /** Offset in the source where the body begins, so nothing has to be rewritten. */
  bodyStart: number;
};

export function readFrontmatter(text: string): Frontmatter | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(text);
  if (!match) return null;
  const fields: { key: string; values: string[] }[] = [];
  const unparsed: string[] = [];
  let current: { key: string; values: string[] } | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && current) { const value = scalar(item[1]); if (value) current.values.push(value); continue; }
    const pair = /^([A-Za-z0-9_][\w .-]{0,80}):[ \t]*(.*)$/.exec(line);
    if (!pair) { unparsed.push(line.trim().slice(0, 200)); current = null; continue; }
    const rest = pair[2].trim();
    const inline = /^\[(.*)\]$/.exec(rest);
    const values = inline
      ? inline[1].split(',').map((part) => scalar(part)).filter(Boolean)
      : rest ? [scalar(rest)].filter(Boolean) : [];
    current = { key: pair[1].trim(), values };
    fields.push(current);
    if (fields.length >= 60) break;
  }
  return { fields, unparsed, bodyStart: match[0].length };
}

/** One YAML scalar, unquoted. No type guessing: a note's properties are shown, not computed. */
function scalar(raw: string): string {
  const value = String(raw).trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
  return (quoted ? quoted[2] : value).trim().slice(0, 300);
}

/**
 * Tags written in frontmatter, which is where Obsidian puts them. `tags: [a, b]`, a block list,
 * or a single `tag:`; a leading "#" is optional there and is dropped, as Obsidian does.
 */
export function frontmatterTags(text: string): string[] {
  const front = readFrontmatter(text);
  if (!front) return [];
  const out: string[] = [];
  for (const field of front.fields) {
    if (!/^tags?$/i.test(field.key)) continue;
    for (const value of field.values) {
      for (const part of value.split(/[,\s]+/)) {
        const tag = part.replace(/^#/, '').trim().toLocaleLowerCase();
        if (/^[\p{L}\p{N}_][\p{L}\p{N}_/-]{0,79}$/u.test(tag)) out.push(tag);
      }
    }
  }
  return [...new Set(out)];
}

/**
 * Fill a template the way Obsidian's core Templates plugin does: `{{date}}`, `{{time}}` and
 * `{{title}}`, with an optional format for date and time (`{{date:YYYY-MM-DD}}`). Anything else
 * in braces is left exactly as written — a template is the owner's text, not a program.
 */
export function fillTemplate(template: string, { title, now = new Date() }: { title: string; now?: Date }): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const tokens: Record<string, string> = {
    YYYY: String(now.getFullYear()), MM: pad(now.getMonth() + 1), DD: pad(now.getDate()),
    HH: pad(now.getHours()), mm: pad(now.getMinutes()),
  };
  const format = (pattern: string) => pattern.replace(/YYYY|MM|DD|HH|mm/g, (t) => tokens[t]);
  return template.replace(/\{\{\s*(date|time|title)(?::([^}]*))?\s*\}\}/gi, (_, name: string, pattern?: string) => {
    const key = name.toLowerCase();
    if (key === 'title') return title;
    if (key === 'date') return format(pattern?.trim() || 'YYYY-MM-DD');
    return format(pattern?.trim() || 'HH:mm');
  });
}
