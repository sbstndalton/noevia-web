import { DiaryWorkspaceTrash } from './DiaryWorkspaceTrash';
import { DiaryWorkspaceImport } from './DiaryWorkspaceImport';
import { apiFetch } from '../api';
import type { FileSearchReport, FileSearchFilters } from '../diary-file-search';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { DiaryFile, FileEntry } from '../diary-workspace';
import { markdownOutline, resolveMarkdownPath } from '../diary-markdown';
import { MarkdownPreview } from './DiaryModal';
import { ShellIcon } from './ShellIcon';

type Props = {
  navigationKey: number; file: DiaryFile; text: string; busy: boolean; error: string; status: string;
  stored: DiaryFile | null; local: boolean; managed?: boolean; syncPending: boolean;
  files: FileEntry[]; folderPath: string; filesLoading: boolean; filesError: string;
  onText: (text: string) => void; onPath: (path: string) => void;
  onFolder: (path: string) => void; onOpen: (path: string) => void; onNew: () => void;
  onSearch: (path: string, query: string, signal: AbortSignal, kind?: 'text'|'backlinks', filters?: FileSearchFilters) => Promise<FileSearchReport>;
  onRefresh: () => void; onSave: () => void; onCompare: () => void;
  onRebase: () => void; onReload: () => void; onClose: () => void;
};

/** Editing is a page surface. The parent retains the source across app navigation. */
export function DiaryMarkdownWorkspace(input: Props) {
  const [trashWorking,setTrashWorking]=useState(false);
  const p={...input,busy:input.busy || trashWorking};
  const [mode, setMode] = useState<'source' | 'preview' | 'split'>('split');
  const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState(''),[exportStatus,setExportStatus]=useState('');
  const [filter, setFilter] = useState('');
  const [query,setQuery]=useState(''),[searching,setSearching]=useState(false),[searchError,setSearchError]=useState('');
  const [filters,setFilters]=useState<FileSearchFilters>({});
  const hasFilter=!!(filters.from || filters.to || filters.tag?.trim());
  const [report,setReport]=useState<FileSearchReport|null>(null);
  const [searchKind,setSearchKind]=useState<'text'|'backlinks'>('text');
  const searchAbort=useRef<AbortController|null>(null);
  useEffect(()=>{setReport(null);setSearchError('');setSearching(false);return()=>{searchAbort.current?.abort();searchAbort.current=null;};},[p.folderPath,p.file.path,p.file.content,query,filters]);
  const search=async(kind:'text'|'backlinks'='text')=>{
    searchAbort.current?.abort();const controller=new AbortController();searchAbort.current=controller;
    setSearching(true);setSearchError('');setReport(null);setSearchKind(kind);
    const timeout=window.setTimeout(()=>controller.abort(),15000);
    try{
      const found=await p.onSearch(kind==='backlinks'?'':p.folderPath,kind==='backlinks'?p.file.path:query,controller.signal,kind,kind==='text'?filters:undefined);
      if(!controller.signal.aborted)setReport(found);
    }catch(e){if(searchAbort.current===controller)setSearchError(controller.signal.aborted?'Search stopped. Try a smaller folder or retry.':e instanceof Error?e.message:'Search failed.');}
    finally{window.clearTimeout(timeout);if(searchAbort.current===controller)setSearching(false);}
  };
  const heading = useRef<HTMLHeadingElement>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const deferredText = useDeferredValue(p.text);
  const outline = useMemo(() => markdownOutline(deferredText), [deferredText]);
  const dirty = p.file.content === null || p.text !== p.file.content;
  useEffect(() => { heading.current?.focus(); }, [p.navigationKey]);
  useEffect(() => { setFilter(''); }, [p.folderPath]);
  const rows = p.files.filter(f => f.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
    .sort((a,b) => Number(b.isDir)-Number(a.isDir) || a.name.localeCompare(b.name));
  const jump = (offset: number) => {
    setMode('source');
    requestAnimationFrame(() => { source.current?.focus(); source.current?.setSelectionRange(offset, offset); });
  };
  const downloadDraft = () => {
    const url=URL.createObjectURL(new Blob([p.text],{type:'text/markdown;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=p.file.path.split('/').pop() || 'note.md';anchor.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const downloadWorkspace=async()=>{
    setExporting(true);setExportError('');setExportStatus('Reading and verifying stored files…');
    const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),300000);
    try {
      const response=await apiFetch('/api/diary/workspace-export',{signal:controller.signal});
      if(!response.ok){const body=await response.json();throw Error(body.error || 'Export failed. Please retry.');}
      if(!response.headers.get('content-type')?.startsWith('application/zip'))throw Error('Unexpected export response. Please retry.');
      setExportStatus('Preparing download…');
      const blob=await response.blob(),url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');anchor.href=url;anchor.download='noevia-workspace.zip';anchor.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);setExportStatus('Download ready. Check your browser downloads.');
    }catch(e){setExportStatus('');setExportError(controller.signal.aborted?'Export timed out. Retry when storage is available.':e instanceof Error?e.message:'Export failed. Please retry.');}
    finally{window.clearTimeout(timer);setExporting(false);}
  };
  return <section className="diary-markdown-workspace" aria-label="Markdown workspace" onKeyDown={e=>{
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='s') {
      e.preventDefault(); if (!p.busy && !p.stored && p.file.path) p.onSave();
    }
  }}>
    <header className="diary-workspace-heading"><div><h1 ref={heading} tabIndex={-1}>Markdown workspace</h1><p>{p.local ? 'Folder on this computer' : 'Saved Diary storage'} · explicit saves</p></div><button className="modal-btn secondary" disabled={p.busy} onClick={p.onClose}>Back to Diary</button></header>
    <div className="diary-workspace-body">
      <div className="diary-workspace-document">
        <label className="diary-editor-path">File path<input value={p.file.path} readOnly={p.file.content!==null || !!p.stored} disabled={p.busy} onChange={e=>p.onPath(e.target.value)} /></label>
        <div className="diary-editor-tabs" role="group" aria-label="Editor view">{(['source','preview','split'] as const).map(value=><button key={value} className="popup-tab" aria-pressed={mode===value} onClick={()=>setMode(value)}>{value==='source'?'Edit Markdown':value==='preview'?'Preview':'Source & preview'}</button>)}</div>
        <p className="diary-editor-state" role="status">{p.busy ? p.status || 'Working…' : p.error ? 'Save or load needs attention · draft kept' : dirty ? 'Unsaved changes' : p.status || 'No unsaved changes'}</p>
        {p.error && <p className="conn-banner" role="alert">{p.error}</p>}
        {p.syncPending && <p className="conn-banner">Local copy saved. Online sync needs attention; use Retry save / sync in Diary to retry the existing guarded sync.</p>}
        <div className="diary-editor-panes">
          <section hidden={mode==='preview'}><label htmlFor="diary-markdown-source">Markdown source</label><textarea ref={source} id="diary-markdown-source" className="diary-md-input" aria-label="Markdown content" value={p.text} disabled={p.busy} onChange={e=>p.onText(e.target.value)} spellCheck={false}/></section>
          {mode!=='source' && <section aria-label="Markdown preview" aria-busy={p.text!==deferredText}><h2 className="diary-pane-label">Preview</h2><MarkdownPreview text={deferredText || 'This file is empty.'} internalLink={href=>{const path=resolveMarkdownPath(p.file.path,href);return path ? ()=>p.onOpen(path) : undefined;}} /></section>}
        </div>
        {p.stored && <section className="diary-stored-version"><h2>Current stored version</h2><p>Your draft is retained above. Reconcile it with this source, then accept the reviewed version as the next save base. The next save checks the reviewed version again.</p><pre>{p.stored.content ?? 'This file no longer exists.'}</pre><div className="diary-workspace-file-actions"><button className="modal-btn secondary" disabled={p.busy} onClick={p.onRebase}>Keep draft with this save base</button><button className="modal-btn secondary" disabled={p.busy} onClick={p.onReload}>Discard draft and reload</button></div></section>}
        <footer className="diary-workspace-save"><button className="modal-btn secondary" onClick={downloadDraft}>Download Markdown</button><span>{p.status || '⌘/Ctrl + S to save'}</span><button className="modal-btn secondary" disabled={p.busy} onClick={p.onCompare}>Compare stored version</button><button className="modal-btn primary" disabled={p.busy || !p.file.path || !!p.stored} onClick={p.onSave}>{p.busy?'Working…':'Save'}</button></footer>
      </div>
      <aside className="diary-workspace-navigation" aria-label="Workspace navigation">
        <details className="diary-workspace-files" open><summary>Markdown files</summary>
          <div className="diary-file-breadcrumb"><button className="popup-tab" disabled={p.busy} onClick={()=>p.onFolder('')}>Diary folder</button>{p.folderPath && <><span>/ {p.folderPath}</span><button className="popup-tab" disabled={p.busy} onClick={()=>p.onFolder(p.folderPath.split('/').slice(0,-1).join('/'))}>Up</button></>}</div>
          <label className="diary-workspace-filter">Filter this folder<input value={filter} onChange={e=>setFilter(e.target.value)} type="search" /></label>
          <div className="diary-workspace-file-actions"><button className="popup-tab" disabled={p.busy} onClick={p.onNew}>New file</button><button className="popup-tab" disabled={p.busy || p.filesLoading} onClick={p.onRefresh}>Refresh files</button></div>
          {p.filesLoading ? <p role="status">Loading files…</p> : p.filesError ? <div role="alert"><p>{p.filesError}</p><button className="popup-tab" onClick={p.onRefresh}>Retry file list</button></div> : <nav className="diary-file-list" aria-label="Markdown files">{rows.map(file=><button key={file.path} title={file.path} disabled={p.busy} aria-current={!file.isDir && file.path===p.file.path?'page':undefined} onClick={()=>file.isDir?p.onFolder(file.path):p.onOpen(file.path)}><ShellIcon name={file.isDir?'folder':'book'} size={16}/>{file.name}</button>)}{!rows.length && <p>{filter ? 'No matching files in this folder.' : 'No Markdown files in this folder.'}</p>}</nav>}
        </details>
        <details className="diary-workspace-export"><summary>Export workspace</summary>
          <p>{p.local ? 'Whole-workspace ZIP export is available for saved Diary storage. This folder is already on your computer; copy it with your file manager.' : 'Download all stored files, including Markdown, attachments and empty folders, with a checksum manifest. Unsaved drafts and optional chat attachments are not included. Up to 5,000 files, 64 MiB per file and 256 MiB total.'}</p>
          {!p.local && <button className="modal-btn secondary" disabled={p.busy || exporting} onClick={()=>void downloadWorkspace()}>{exporting?'Preparing ZIP…':'Download workspace ZIP'}</button>}
          {exportStatus && <p role="status">{exportStatus}</p>}{exportError && <p role="alert">{exportError}</p>}
        </details>
        <DiaryWorkspaceTrash enabled={!p.local && !!p.managed} busy={p.busy} file={p.file} dirty={dirty || !!p.stored || p.syncPending} onWorking={setTrashWorking} onChanged={p.onRefresh}/>
        <DiaryWorkspaceImport enabled={!p.local && !!p.managed} busy={p.busy} onImported={p.onRefresh}/>
        <details className="diary-workspace-search"><summary>Search &amp; backlinks</summary><p>Search stored Markdown in this folder and its subfolders. Up to 50 files / 4 MiB per search; unsaved text is not included.</p><form onSubmit={e=>{e.preventDefault();void search();}}><label className="diary-workspace-filter">Search text<input type="search" minLength={2} maxLength={200} required={!hasFilter} value={query} onChange={e=>setQuery(e.target.value)}/></label>
          <label className="diary-workspace-filter">From date<input type="date" value={filters.from || ''} onChange={e=>setFilters({...filters,from:e.target.value})}/></label>
          <label className="diary-workspace-filter">Through date<input type="date" min={filters.from} value={filters.to || ''} onChange={e=>setFilters({...filters,to:e.target.value})}/></label>
          <label className="diary-workspace-filter">Hashtag<input placeholder="#tag" maxLength={81} value={filters.tag || ''} onChange={e=>setFilters({...filters,tag:e.target.value})}/></label>
          <p>Dates match filenames beginning YYYY-MM-DD. Undated files are excluded when a date is set. Tags match whole #hashtags in prose, ignoring case and code; frontmatter tags are not included.</p>
          <button className="popup-tab" disabled={searching || (!hasFilter && query.trim().length<2) || (query.trim().length>0 && query.trim().length<2)}>Search contents</button>
          {hasFilter && <button type="button" className="popup-tab" onClick={()=>setFilters({})}>Clear filters</button>}</form><button className="popup-tab" disabled={searching || !p.file.path} onClick={()=>void search('backlinks')}>Find links to this file</button><p>Backlinks scan the Diary folder within the same bounds. Inline relative Markdown links are supported; wiki links and anchors remain plain text.</p>
          {searching && <p role="status">Searching stored files…</p>}{searchError && <p role="alert">{searchError}</p>}
          {report && <div><p role="status">{report.results.length} {searchKind==='backlinks'?'linking files':'matches'} · {report.scanned} files checked{report.partial?' · Partial results':''}{report.skipped?` · ${report.skipped} unreadable items`:''}</p>{report.partial && <p>Some files were not searched. Choose a smaller folder to narrow the search.</p>}{report.results.map(result=><button className="diary-search-result" key={result.path} disabled={p.busy} onClick={()=>p.onOpen(result.path)}><strong>{result.path}</strong><span>{result.snippet}</span></button>)}</div>}
        </details>
        <details className="diary-workspace-outline"><summary>Outline ({outline.length})</summary>{outline.length ? outline.map(item=><button key={item.offset} className="popup-tab" onClick={()=>jump(item.offset)}>{item.label}</button>) : <p>Add Markdown headings to navigate this file.</p>}</details>
      </aside>
    </div>
  </section>;
}
