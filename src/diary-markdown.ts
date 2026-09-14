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
