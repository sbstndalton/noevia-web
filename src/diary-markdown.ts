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
