import { frontmatterTags, markdownFileLinks, markdownWikiLinks, resolveMarkdownPath, wikiLinkCandidates } from './diary-markdown';
import type { DiaryFile, FileEntry } from './diary-workspace';

export type FileSearchFilters = {from?:string;to?:string;tag?:string};
function validDay(day:string):boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day+'T00:00:00Z')) && new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
}
/**
 * Tags a file carries: #hashtags in prose, and the `tags:` property, which is where a vault
 * written in Obsidian keeps them. Code is not prose, in a fence or in backticks.
 */
/** The prose of a note: no frontmatter, no fenced code, no inline code. */
export function proseOnly(text:string):string {
  const lines=text.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/,'').split('\n');
  let fence='';
  return lines.filter(line=>{
    const token=/^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if(fence){if(token && token[0]===fence[0] && token.length>=fence.length && line.trim()===token)fence='';return false;}
    if(token){fence=token;return false;}
    return true;
  }).join('\n').replace(/(`+)[\s\S]*?\1/g,'');
}
export function markdownTags(text:string):string[] {
  const prose=proseOnly(text);
  return [...new Set([...frontmatterTags(text),
    ...[...prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu)].map(m=>m[1].toLocaleLowerCase())])];
}
export type FileSearchResult = {path:string;snippet:string};
/** `mentions` is only filled for backlinks: files that name this one in prose without linking it. */
export type FileSearchReport = {results:FileSearchResult[];scanned:number;partial:boolean;skipped:number;mentions?:FileSearchResult[]};
/** Explicit, transient literal search. Source remains authoritative; no index or model. */
export async function searchMarkdownFolder(options: {
  path:string; query:string; kind?:'text'|'backlinks'; signal?:AbortSignal; filters?:FileSearchFilters;
  list:(path:string)=>Promise<{files:FileEntry[]}>; read:(path:string)=>Promise<DiaryFile>;
}):Promise<FileSearchReport> {
  const query=options.query.trim().toLocaleLowerCase();
  const filters=options.kind==='backlinks'?{}:options.filters || {};
  const tag=(filters.tag || '').trim().replace(/^#/,'').toLocaleLowerCase();
  const filtering=!!(filters.from || filters.to || tag);
  if((query.length<2 && !(query.length===0 && filtering)) || query.length>(options.kind==='backlinks'?500:200))throw Error('Search needs 2–200 characters, or a date/tag filter.');
  if([filters.from,filters.to].some(day=>day && !validDay(day)))throw Error('Choose valid dates.');
  if(filters.from && filters.to && filters.from>filters.to)throw Error('The start date must be on or before the end date.');
  if(tag && !/^[\p{L}\p{N}_][\p{L}\p{N}_/-]{0,79}$/u.test(tag))throw Error('Choose one hashtag, up to 80 characters.');
  const results:FileSearchResult[]=[],mentions:FileSearchResult[]=[],queue=[{path:options.path,depth:0}],seen=new Set<string>();
  // Unlinked mentions, as Obsidian calls them: the file's own name written in another note
  // without a link. Too short a name matches everything, so under three letters is skipped.
  const mentionName=options.kind==='backlinks'?(options.query.split('/').pop()||'').replace(/\.md$/i,'').trim():'';
  const mentionPattern=mentionName.length>=3
    ? new RegExp(`(^|[^\\p{L}\\p{N}_])${mentionName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=$|[^\\p{L}\\p{N}_])`,'iu')
    : null;
  let scanned=0,visited=0,bytes=0,skipped=0,partial=false;
  while(queue.length && scanned<50 && visited<50 && results.length<30){
    if(options.signal?.aborted)throw Error('Search cancelled.');
    const next=queue.shift()!;
    if(seen.has(next.path))continue;seen.add(next.path);visited++;
    let files:FileEntry[];
    try{files=(await options.list(next.path)).files;}
    catch(e){if(next.path===options.path)throw e;skipped++;continue;}
    for(const file of [...files].sort((a,b)=>a.path.localeCompare(b.path))){
      if(options.signal?.aborted)throw Error('Search cancelled.');
      // Never traverse a sibling or a path supplied outside the selected root.
      const prefix=next.path?next.path+'/':'';
      if(!file.path.startsWith(prefix) || file.path.slice(prefix.length).includes('/') || file.path.slice(prefix.length).startsWith('.') || file.path.includes('\\')){skipped++;continue;}
      if(file.isDir){if(next.depth<8)queue.push({path:file.path,depth:next.depth+1});else partial=true;continue;}
      if(scanned>=50 || results.length>=30){partial=true;break;}
      if(!file.path.toLowerCase().endsWith('.md'))continue;
      if(filters.from || filters.to){
        const day=/^(\d{4}-\d{2}-\d{2})(?:\.md$|[ _-])/i.exec(file.name)?.[1];
        if(!day || !validDay(day) || (filters.from && day<filters.from) || (filters.to && day>filters.to))continue;
      }
      scanned++;
      try{
        const row=await options.read(file.path),text=row.content;
        if(text===null){skipped++;continue;}
        bytes+=new TextEncoder().encode(text).length;
        if(bytes>4*1024*1024)return {results,scanned,partial:true,skipped,...(options.kind==='backlinks'?{mentions}:{})};
        if(tag && !markdownTags(text).includes(tag))continue;
        // Both ways of pointing at a file count. A diary kept in Obsidian is written in
        // `[[wiki links]]`, and finding none of them made "what links here" quietly wrong.
        const link=options.kind==='backlinks'
          ? (markdownFileLinks(text).find(link=>resolveMarkdownPath(file.path,link.href)===options.query)
            || markdownWikiLinks(text).find(link=>link.target && wikiLinkCandidates(file.path,options.path,link.target).includes(options.query)))
          : null;
        const match=options.kind==='backlinks'?(link?.offset ?? -1):text.toLocaleLowerCase().indexOf(query);
        if(match>=0)results.push({path:file.path,snippet:text.slice(Math.max(0,match-70),match+(link?.length ?? query.length)+140)});
        else if(mentionPattern && file.path!==options.query && mentions.length<30){
          // Prose only: a name inside code is not a mention, any more than it is a tag.
          const found=mentionPattern.exec(proseOnly(text));
          if(found){const at=found.index+found[1].length;const prose=proseOnly(text);mentions.push({path:file.path,snippet:prose.slice(Math.max(0,at-70),at+mentionName.length+140)});}
        }
      }catch{if(options.signal?.aborted)throw Error('Search cancelled.');skipped++;}
    }
  }
  return {results,scanned,partial:partial || queue.length>0 || skipped>0,skipped,...(options.kind==='backlinks'?{mentions}:{})};
}
