const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
// #456: diary-workspace.ts now also imports `cached` from `./request-cache` (for the
// listFiles() dedup — see tests/client/diary-files-request-dedup.test.cjs for that behaviour). The
// stub here stays a plain pass-through (no memoization) so every existing test below keeps
// exercising exactly one network call per call site, unaffected by caching.
function load(name, apiFetch = () => {throw Error('unexpected request');}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src',name),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  const fakeRequestCache = { cached: (_key, run) => run(), invalidateCachedPrefix: () => {} };
  vm.runInNewContext(code,{exports,require:name=>name==='./diary-markdown'?load('diary-markdown.ts'):name==='./request-cache'?fakeRequestCache:({apiFetch}),DOMException,File,TextEncoder,window:{},Date,console});
  return exports;
}
const dates = load('diary-data.ts');
test('calendar has leap day and correctly aligned weekday cells',()=>{
  const grid=dates.calendarDays('2024-02');
  assert.equal(grid.length,33); assert.equal(grid[4],'2024-02-01'); assert.equal(grid.at(-1),'2024-02-29');
});
test('days stay separate and standing notes are not a diary day',()=>{
  const parsed=dates.splitDays('## Wednesday, July 8, 2026\nfirst\n## Thursday, July 9, 2026\nsecond\n## Open questions\nquestion');
  assert.match(parsed['2026-07-08'],/first/); assert.doesNotMatch(parsed['2026-07-08'],/second/); assert.doesNotMatch(parsed['2026-07-09'],/question/);
  assert.equal(dates.dateInText('2026-02-30'),null);
});
test('submission timestamp uses current local wall-clock date with offset',()=>{
  const now=new Date(2026,8,7,0,5,4);
  assert.equal(dates.localDay(now),'2026-09-07');
  assert.match(dates.localTimestamp(now),/^2026-09-07T00:05:04[+-]\d{2}:\d{2}$/);
});
function fakeFolder(initial={}) {
  const data={...initial};
  const dir={
    kind:'directory', name:'fixture',
    async *values(){ for(const name of Object.keys(data)) yield await this.getFileHandle(name); },
    async getDirectoryHandle(){ return dir; },
    async getFileHandle(name,opt={}) {
      if(!(name in data)&&!opt.create) throw new DOMException('missing','NotFoundError');
      return {
        kind:'file', name,
        async getFile(){ return new File([data[name]||''],name); },
        async createWritable(){ return { async write(text){data[name]=text;}, async close(){}, async abort(){} }; }
      };
    }
  };
  return {dir,data};
}
test('local-only save makes no server calls and preserves unrelated files',async()=>{
  const api=load('diary-workspace.ts');const f=fakeFolder({'MEMORY.md':'old','notes.md':'keep'});
  await api.saveLocal(f.dir,'MEMORY.md','new','old');
  assert.equal(f.data['MEMORY.md'],'new');assert.equal(f.data['notes.md'],'keep');
});
test('local conflict never overwrites newer file',async()=>{
  const api=load('diary-workspace.ts');const f=fakeFolder({'MEMORY.md':'external edit'});
  await assert.rejects(api.saveLocal(f.dir,'MEMORY.md','new','old'),/changed/);
  assert.equal(f.data['MEMORY.md'],'external edit');
});
test('folder scan only imports Markdown and rejects excess size',async()=>{
  const api=load('diary-workspace.ts');const f=fakeFolder({'MEMORY.md':'words','secret.txt':'not selected'});
  const files=await api.scanLocal(f.dir); assert.equal(files['MEMORY.md'],'words');assert.equal(files['secret.txt'],undefined);
  await assert.rejects(api.scanLocal(fakeFolder({'huge.md':'x'.repeat(512*1024+1)}).dir),/512 KiB/);
});
test('sync uses remote version and retries an already completed write without duplication',async()=>{
  let remote='old', puts=0;
  const api=load('diary-workspace.ts',async(_url,init)=>{
    if(init.method==='PUT'){ const b=JSON.parse(init.body);assert.equal(b.version,'v1');remote=b.content;puts++; }
    return {ok:true,json:async()=>({path:'MEMORY.md',content:remote,version:'v1'})};
  });
  await api.syncFileChange('MEMORY.md','old','new'); await api.syncFileChange('MEMORY.md','old','new');assert.equal(puts,1);
});
test('sync refuses divergent remote contents and remote failure is surfaced',async()=>{
  let puts=0; const api=load('diary-workspace.ts',async(_url,init)=>{if(init.method==='PUT')puts++;return {ok:true,json:async()=>({path:'MEMORY.md',content:'different',version:'v2'})};});
  await assert.rejects(api.syncFileChange('MEMORY.md','old','new'),/differs/);assert.equal(puts,0);
  const offline=load('diary-workspace.ts',async()=>{throw Error('offline');});
  await assert.rejects(offline.syncFileChange('MEMORY.md','old','new'),/offline/);
});

test('invalid listings and mismatched reads cannot replace editor state',async()=>{
  const malformed=load('diary-workspace.ts',async()=>({ok:true,json:async()=>({files:{}})}));
  await assert.rejects(malformed.listFiles(),/File list was invalid/);
  const wrong=load('diary-workspace.ts',async()=>({ok:true,json:async()=>({path:'other.md',content:'other',version:'v1'})}));
  await assert.rejects(wrong.readFile('note.md'),/File response was invalid/);
});
test('local byte limit rejects multi-byte content before creating directories or writing',async()=>{
  const api=load('diary-workspace.ts');let calls=0;
  await assert.rejects(api.saveLocal({getDirectoryHandle(){calls++;}},'new/note.md','é'.repeat(262145),null),/512 KiB/);
  assert.equal(calls,0);
});
test('conflict status survives the request boundary for editor comparison',async()=>{
  const api=load('diary-workspace.ts',async()=>({ok:false,status:409,json:async()=>({error:'changed'})}));
  await assert.rejects(api.writeFile({path:'note.md',content:'draft',version:'v1'}),e=>e instanceof api.DiaryRequestError && e.status===409);
});
test('outline preserves source offsets and skips frontmatter and fenced headings',()=>{
  const api=load('diary-markdown.ts');
  const text='---\n# metadata\n---\n# Real\n```md\n# Example\n```\n## Second';
  const rows=api.markdownOutline(text);
  assert.equal(rows.length,2);assert.equal(rows[0].label,'Real');assert.equal(rows[1].offset,text.indexOf('## Second'));
});
test('relative Markdown links stay within the tenant root and reject active or ambiguous URLs',()=>{
  const {resolveMarkdownPath}=load('diary-markdown.ts');
  assert.equal(resolveMarkdownPath('memory/note.md','../Entries/day.md'),'Entries/day.md');
  assert.equal(resolveMarkdownPath('note.md','space%20name.md'),'space name.md');
  for(const href of ['../secret.md','%2e%2e/secret.md','https://host/a.md','javascript:alert.md','//host/a.md','/other/a.md','a\\b.md','%00.md','.hidden/note.md','a.md?download=1','a.md#heading','%invalid'])assert.equal(resolveMarkdownPath('note.md',href),null,href);
});

test('folder search reads only in-scope Markdown and reports inaccessible files as partial',async()=>{
  const {searchMarkdownFolder}=load('diary-file-search.ts');const reads=[];
  const report=await searchMarkdownFolder({path:'notes',query:'target',list:async()=>({files:[
    {path:'other/private.md',name:'private.md',isDir:false},{path:'notes/a.md',name:'a.md',isDir:false},{path:'notes/b.md',name:'b.md',isDir:false}
  ]}),read:async path=>{reads.push(path);if(path.endsWith('b.md'))throw Error('offline');return {path,content:'A target phrase',version:'v1'};}});
  assert.deepEqual(reads,['notes/a.md','notes/b.md']);assert.equal(report.results.length,1);assert.equal(report.partial,true);assert.equal(report.skipped,2);
});
test('folder search enforces file and byte bounds, cancellation, and query length',async()=>{
  const {searchMarkdownFolder}=load('diary-file-search.ts');let reads=0;
  const list=async()=>({files:Array.from({length:70},(_,i)=>({path:`${i}.md`,name:`${i}.md`,isDir:false}))});
  const read=async path=>{reads++;return {path,content:'no matching term',version:'v1'};};
  const report=await searchMarkdownFolder({path:'',query:'absent',list,read});assert.equal(reads,50);assert.equal(report.partial,true);
  await assert.rejects(searchMarkdownFolder({path:'',query:'x',list,read}),/2–200/);
  await assert.rejects(searchMarkdownFolder({path:'',query:'xx',list,read,signal:{aborted:true}}),/cancelled/);
  reads=0;const large=await searchMarkdownFolder({path:'',query:'absent',list,read:async path=>{reads++;return {path,content:'a'.repeat(512*1024),version:'v1'};}});assert.equal(large.partial,true);assert.equal(reads,9);
});

test('backlinks resolve source-relative paths and skip images and fenced code',async()=>{
 const {searchMarkdownFolder}=load('diary-file-search.ts');
 const files={'a.md':'[Real](nested/note.md)','b.md':'```md\n[Example](nested/note.md)\n```\n![Image](nested/note.md)','c.md':'`[Code](nested/note.md)`'};
 const report=await searchMarkdownFolder({path:'',query:'nested/note.md',kind:'backlinks',list:async()=>({files:Object.keys(files).map(path=>({path,name:path,isDir:false}))}),read:async path=>({path,content:files[path],version:'v1'})});
 assert.equal(report.results.length,1);assert.equal(report.results[0].path,'a.md');
});


test('backlinks also report notes that name the file without linking it',async()=>{
 // Obsidian's "unlinked mentions". Whole words only, prose only, and never the linking notes
 // twice: a note that links is a backlink, not also a mention.
 const {searchMarkdownFolder}=load('diary-file-search.ts');
 const files={
  'Garden plan.md':'# Garden plan',
  'linked.md':'See [[Garden plan]] and also the garden plan below.',
  'mention.md':'Today I revised the Garden Plan with Ada.',
  'partial.md':'The Garden planning group met.',
  'code.md':'```\nGarden plan\n```\n`Garden plan`',
  'front.md':'---\ntitle: Garden plan\n---\nNothing here.',
 };
 const report=await searchMarkdownFolder({path:'',query:'Garden plan.md',kind:'backlinks',
  list:async()=>({files:Object.keys(files).map(path=>({path,name:path,isDir:false}))}),read:async path=>({path,content:files[path],version:'v'})});
 assert.deepEqual(Array.from(report.results,r=>r.path),['linked.md']);
 assert.deepEqual(Array.from(report.mentions,r=>r.path),['mention.md'],'case-insensitive, whole words, prose only, not the file itself');
 assert.match(report.mentions[0].snippet,/Garden Plan with Ada/);
});
test('a name too short to mean anything reports no mentions rather than every note',async()=>{
 const {searchMarkdownFolder}=load('diary-file-search.ts');
 const files={'ab.md':'x','other.md':'ab ab ab'};
 const report=await searchMarkdownFolder({path:'',query:'ab.md',kind:'backlinks',
  list:async()=>({files:Object.keys(files).map(path=>({path,name:path,isDir:false}))}),read:async path=>({path,content:files[path],version:'v'})});
 assert.deepEqual(Array.from(report.mentions),[]);
});

test('date and whole-tag filters combine with text, inclusive dates and undated exclusion',async()=>{
 const {searchMarkdownFolder}=load('diary-file-search.ts');
 const files={'2024-02-29.md':'Target #Work','2024-03-01-note.md':'Target #work','2024-03-02.md':'Target #workday','undated.md':'Target #work','2024-02-30.md':'Target #work'};
 const options={path:'',query:'target',list:async()=>({files:Object.keys(files).map(path=>({path,name:path,isDir:false}))}),read:async path=>({path,content:files[path],version:'v'})};
 const report=await searchMarkdownFolder({...options,filters:{from:'2024-02-29',to:'2024-03-01',tag:'#WORK'}});
 assert.deepEqual(Array.from(report.results,r=>r.path),['2024-02-29.md','2024-03-01-note.md']);
 const tagOnly=await searchMarkdownFolder({...options,query:'',filters:{tag:'work'}});assert.equal(tagOnly.results.length,4);
 const dateOnly=await searchMarkdownFolder({...options,query:'',filters:{from:'2024-03-02'}});assert.deepEqual(Array.from(dateOnly.results,r=>r.path),['2024-03-02.md']);
 for(const filters of [{from:'2024-02-30'},{from:'2024-03-02',to:'2024-03-01'},{tag:'two tags'}])await assert.rejects(searchMarkdownFolder({...options,filters}));
});
test('tag matching reads the tags property as well as prose, and never reads code',()=>{
 // Frontmatter tags used to be excluded. A vault written in Obsidian keeps its tags there, so
 // excluding them meant the filter quietly missed most of a real diary's tags (2026-09-21).
 const {markdownTags}=load('diary-file-search.ts');
 const text='---\ntags: [#private]\n---\n# A heading\n#Work #work/project #café #workday\n`#inline`\n~~~js\n#hidden\n~~~~\n```\n#unfinished';
 assert.deepEqual(Array.from(markdownTags(text)),['private','work','work/project','café','workday']);
 // A heading is not a tag, and neither is anything inside a fence or backticks.
 assert.deepEqual(Array.from(markdownTags('# A heading\n`#inline`\n```\n#hidden\n```\n')),[]);
});
