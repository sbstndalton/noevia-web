import { DiaryWorkspaceTrash } from './DiaryWorkspaceTrash';
import { DiaryWorkspaceImport } from './DiaryWorkspaceImport';
import { apiFetch } from '../api';
import type { FileSearchReport, FileSearchFilters } from '../diary-file-search';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { DiaryFile, FileEntry } from '../diary-workspace';
import { fillTemplate, markdownOutline, resolveMarkdownPath, wikiLinkCandidates, wikiLinkNameFor, wikiLinkQueryAt } from '../diary-markdown';
import { MarkdownPreview } from './DiaryModal';
import { ShellIcon } from './ShellIcon';
import { LocalGraph } from './diary-graph/LocalGraph';
import { useT } from '../i18n';

type Props = {
  navigationKey: number; file: DiaryFile; text: string; busy: boolean; error: string; status: string;
  stored: DiaryFile | null; local: boolean; managed?: boolean; syncPending: boolean;
  files: FileEntry[]; folderPath: string; filesLoading: boolean; filesError: string;
  onText: (text: string) => void; onPath: (path: string) => void;
  onFolder: (path: string) => void; onOpen: (path: string) => void; onNew: () => void;
  onSearch: (path: string, query: string, signal: AbortSignal, kind?: 'text'|'backlinks', filters?: FileSearchFilters) => Promise<FileSearchReport>;
  /** Markdown files in the Diary's Templates folder, the convention Obsidian uses. */
  listTemplates?: () => Promise<{ path: string; content: string }[]>;
  onRefresh: () => void; onSave: () => void; onCompare: () => void;
  onRebase: () => void; onReload: () => void; onClose: () => void;
};

/** Editing is a page surface. The parent retains the source across app navigation. */
export function DiaryMarkdownWorkspace(input: Props) {
  const t = useT();
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
    }catch(e){if(searchAbort.current===controller)setSearchError(controller.signal.aborted?t('diary.workspace.searchStopped'):e instanceof Error?e.message:t('diary.workspace.searchFailed'));}
    finally{window.clearTimeout(timeout);if(searchAbort.current===controller)setSearching(false);}
  };
  const heading = useRef<HTMLHeadingElement>(null);
  const source = useRef<HTMLTextAreaElement>(null);

  // Typing `[[` offers the files in this folder. Linking by hand means remembering an exact
  // name, and that is the part of linking people quietly stop doing.
  const [suggest,setSuggest]=useState<{start:number;query:string;active:number}|null>(null);

  // A new, still-empty file can start from a template in the Diary's Templates folder. Only
  // offered then: filling a file that already has text would be overwriting it.
  const fresh=p.file.content===null && !p.text;
  const [templates,setTemplates]=useState<{path:string;content:string}[]|null>(null);
  useEffect(()=>{
    if(!fresh || !p.listTemplates){setTemplates(null);return;}
    let live=true;
    p.listTemplates().then(list=>{if(live)setTemplates(list);}).catch(()=>{if(live)setTemplates([]);});
    return()=>{live=false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[fresh,p.file.path]);
  const useTemplate=(content:string)=>{
    const title=(p.file.path.split('/').pop()||'').replace(/\.md$/i,'');
    p.onText(fillTemplate(content,{title}));
  };
  const names=useMemo(()=>{
    const paths=p.files.filter(f=>!f.isDir && /\.md$/i.test(f.path)).map(f=>f.path);
    return paths.map(path=>({path,name:wikiLinkNameFor(path,p.folderPath,paths)}));
  },[p.files,p.folderPath]);
  const matches=useMemo(()=>{
    if(!suggest)return [];
    const query=suggest.query.trim().toLocaleLowerCase();
    return names
      .filter(n=>n.path!==p.file.path && (!query || n.name.toLocaleLowerCase().includes(query)))
      .slice(0,8);
  },[suggest,names,p.file.path]);
  const closeSuggest=()=>setSuggest(null);
  const updateSuggest=(element:HTMLTextAreaElement)=>{
    const found=element.selectionStart===element.selectionEnd
      ? wikiLinkQueryAt(element.value,element.selectionStart) : null;
    setSuggest(found ? {start:found.start,query:found.query,active:0} : null);
  };
  // Where the caret goes once the inserted text has rendered. Not a frame callback: the caret
  // would then be restored after whatever the writer typed next, and a keystroke that arrived
  // in between would be measured against the old position.
  const [caretAfterInsert,setCaretAfterInsert]=useState<number|null>(null);
  useEffect(()=>{
    if(caretAfterInsert===null)return;
    const element=source.current;
    setCaretAfterInsert(null);
    if(!element)return;
    element.focus();
    element.setSelectionRange(caretAfterInsert,caretAfterInsert);
  },[caretAfterInsert,p.text]);
  const accept=(name:string)=>{
    const element=source.current;
    if(!element || !suggest)return;
    const caret=element.selectionStart;
    p.onText(`${element.value.slice(0,suggest.start)}${name}]]${element.value.slice(caret)}`);
    closeSuggest();
    setCaretAfterInsert(suggest.start+name.length+2);
  };
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
    setExporting(true);setExportError('');setExportStatus(t('diary.workspace.readingFiles'));
    const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),300000);
    try {
      const response=await apiFetch('/api/diary/workspace-export',{signal:controller.signal});
      if(!response.ok){const body=await response.json();throw Error(body.error || t('diary.workspace.exportFailed'));}
      if(!response.headers.get('content-type')?.startsWith('application/zip'))throw Error(t('diary.workspace.unexpectedExportResponse'));
      setExportStatus(t('diary.workspace.preparingDownload'));
      const blob=await response.blob(),url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');anchor.href=url;anchor.download='noevia-workspace.zip';anchor.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);setExportStatus(t('diary.workspace.downloadReady'));
    }catch(e){setExportStatus('');setExportError(controller.signal.aborted?t('diary.workspace.exportTimedOut'):e instanceof Error?e.message:t('diary.workspace.exportFailed'));}
    finally{window.clearTimeout(timer);setExporting(false);}
  };
  return <section className="diary-markdown-workspace" aria-label={t('diary.workspace.ariaLabel')} onKeyDown={e=>{
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='s') {
      e.preventDefault(); if (!p.busy && !p.stored && p.file.path) p.onSave();
    }
  }}>
    <header className="diary-workspace-heading"><div><h1 ref={heading} tabIndex={-1}>{t('diary.workspace.title')}</h1><p>{p.local ? t('diary.workspace.folderOnComputer') : t('diary.workspace.savedDiaryStorage')} · {t('diary.workspace.explicitSaves')}</p></div><button className="modal-btn secondary" disabled={p.busy} onClick={p.onClose}>{t('diary.workspace.backToDiary')}</button></header>
    <div className="diary-workspace-body">
      <div className="diary-workspace-document">
        <label className="diary-editor-path">{t('diary.workspace.filePath')}<input value={p.file.path} readOnly={p.file.content!==null || !!p.stored} disabled={p.busy} onChange={e=>p.onPath(e.target.value)} /></label>
        <div className="diary-editor-tabs" role="group" aria-label={t('diary.workspace.editorView')}>{(['source','preview','split'] as const).map(value=><button key={value} className="popup-tab" aria-pressed={mode===value} onClick={()=>setMode(value)}>{value==='source'?t('diary.workspace.editMarkdown'):value==='preview'?t('diary.workspace.preview'):t('diary.workspace.sourceAndPreview')}</button>)}</div>
        <p className="diary-editor-state" role="status">{p.busy ? p.status || t('diary.workspace.working') : p.error ? t('diary.workspace.needsAttention') : dirty ? t('diary.workspace.unsavedChanges') : p.status || t('diary.workspace.noUnsavedChanges')}</p>
        {p.error && <p className="conn-banner" role="alert">{p.error}</p>}
        {p.syncPending && <p className="conn-banner">{t('diary.workspace.syncPendingNote')}</p>}
        {fresh && templates && templates.length>0 && <div className="diary-template-row" role="group" aria-label={t('diary.workspace.startFromTemplate')}>
          <span>{t('diary.workspace.startFrom')}</span>
          {templates.map(tpl=><button key={tpl.path} type="button" className="popup-tab" disabled={p.busy} onClick={()=>useTemplate(tpl.content)}>
            {(tpl.path.split('/').pop()||tpl.path).replace(/\.md$/i,'')}
          </button>)}
        </div>}
        <div className="diary-editor-panes">
          <section hidden={mode==='preview'} className="diary-source-pane"><label htmlFor="diary-markdown-source">{t('diary.workspace.markdownSource')}</label>
            <textarea ref={source} id="diary-markdown-source" className="diary-md-input" aria-label={t('diary.workspace.markdownContent')}
              value={p.text} disabled={p.busy} spellCheck={false}
              // Deliberately still a textarea: `role="combobox"` would replace the role this
              // control has had all along, and writing Markdown is what it is for. The
              // suggestions are an offer beside it, announced politely, not a form control.
              aria-describedby={matches.length?'diary-wiki-suggestions-status':undefined}
              onChange={e=>{p.onText(e.target.value);updateSuggest(e.currentTarget);}}
              onSelect={e=>updateSuggest(e.currentTarget)}
              onBlur={closeSuggest}
              onKeyDown={e=>{
                if(!matches.length)return;
                if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeSuggest();return;}
                if(e.key==='ArrowDown'||e.key==='ArrowUp'){
                  e.preventDefault();
                  setSuggest(current=>current?{...current,active:(current.active+(e.key==='ArrowDown'?1:matches.length-1))%matches.length}:current);
                  return;
                }
                if(e.key==='Enter'||e.key==='Tab'){
                  e.preventDefault();
                  accept(matches[Math.min(suggest?.active ?? 0,matches.length-1)].name);
                }
              }}/>
            {matches.length>0 && <p id="diary-wiki-suggestions-status" className="diary-wiki-status" role="status">
              {t.plural('diary.workspace.filesMatch', matches.length)}
            </p>}
            {matches.length>0 && <ul className="diary-wiki-suggestions" id="diary-wiki-suggestions" role="listbox" aria-label={t('diary.workspace.filesYouCouldLink')}>
              {matches.map((match,i)=><li key={match.path} id={`diary-wiki-option-${i}`} role="option" aria-selected={i===(suggest?.active ?? 0)}>
                {/* Mouse down, not click: blur would close the list before a click landed. */}
                <button type="button" className={i===(suggest?.active ?? 0)?'is-active':''} onMouseDown={e=>{e.preventDefault();accept(match.name);}}>
                  <strong>{match.name}</strong>{match.name!==match.path && <span>{match.path}</span>}
                </button>
              </li>)}
            </ul>}
          </section>
          {mode!=='source' && <section aria-label={t('diary.workspace.markdownPreview')} aria-busy={p.text!==deferredText}><h2 className="diary-pane-label">{t('diary.workspace.preview')}</h2><MarkdownPreview text={deferredText || t('diary.workspace.fileIsEmpty')} properties internalLink={href=>{const path=resolveMarkdownPath(p.file.path,href);return path ? ()=>p.onOpen(path) : undefined;}}
          wikiLink={link=>{
            // A heading link with no file before the "#" points inside this file; there is
            // nothing to open, so it reads as text rather than as a link that does nothing.
            if(!link.target)return undefined;
            const candidates=wikiLinkCandidates(p.file.path,p.folderPath,link.target);
            const here=new Set(p.files.filter(f=>!f.isDir).map(f=>f.path));
            const path=candidates.find(c=>here.has(c)) || (p.filesLoading ? candidates[0] : undefined);
            return path ? ()=>p.onOpen(path) : undefined;
          }} /></section>}
        </div>
        {p.stored && <section className="diary-stored-version"><h2>{t('diary.workspace.currentStoredVersion')}</h2><p>{t('diary.workspace.reconcileHint')}</p><pre>{p.stored.content ?? t('diary.workspace.fileNoLongerExists')}</pre><div className="diary-workspace-file-actions"><button className="modal-btn secondary" disabled={p.busy} onClick={p.onRebase}>{t('diary.workspace.keepDraft')}</button><button className="modal-btn secondary" disabled={p.busy} onClick={p.onReload}>{t('diary.workspace.discardAndReload')}</button></div></section>}
        <footer className="diary-workspace-save"><button className="modal-btn secondary" onClick={downloadDraft}>{t('diary.workspace.downloadMarkdown')}</button><span>{p.status || t('diary.workspace.saveShortcut')}</span><button className="modal-btn secondary" disabled={p.busy} onClick={p.onCompare}>{t('diary.workspace.compareStoredVersion')}</button><button className="modal-btn primary" disabled={p.busy || !p.file.path || !!p.stored} onClick={p.onSave}>{p.busy?t('diary.workspace.working'):t('diary.workspace.save')}</button></footer>
      </div>
      <aside className="diary-workspace-navigation" aria-label={t('diary.workspace.navigation')}>
        <details className="diary-workspace-files" open><summary>{t('diary.workspace.markdownFiles')}</summary>
          <div className="diary-file-breadcrumb"><button className="popup-tab" disabled={p.busy} onClick={()=>p.onFolder('')}>{t('diary.context.diaryFolder')}</button>{p.folderPath && <><span>/ {p.folderPath}</span><button className="popup-tab" disabled={p.busy} onClick={()=>p.onFolder(p.folderPath.split('/').slice(0,-1).join('/'))}>{t('diary.context.up')}</button></>}</div>
          <label className="diary-workspace-filter">{t('diary.workspace.filterFolder')}<input value={filter} onChange={e=>setFilter(e.target.value)} type="search" /></label>
          <div className="diary-workspace-file-actions"><button className="popup-tab" disabled={p.busy} onClick={p.onNew}>{t('diary.workspace.newFile')}</button><button className="popup-tab" disabled={p.busy || p.filesLoading} onClick={p.onRefresh}>{t('diary.workspace.refreshFiles')}</button></div>
          {p.filesLoading ? <p role="status">{t('diary.context.loadingFiles')}</p> : p.filesError ? <div role="alert"><p>{p.filesError}</p><button className="popup-tab" onClick={p.onRefresh}>{t('diary.context.retryFileList')}</button></div> : <nav className="diary-file-list" aria-label={t('diary.workspace.markdownFiles')}>{rows.map(file=><button key={file.path} title={file.path} disabled={p.busy} aria-current={!file.isDir && file.path===p.file.path?'page':undefined} onClick={()=>file.isDir?p.onFolder(file.path):p.onOpen(file.path)}><ShellIcon name={file.isDir?'folder':'book'} size={16}/>{file.name}</button>)}{!rows.length && <p>{filter ? t('diary.workspace.noMatchingFiles') : t('diary.workspace.noMarkdownFiles')}</p>}</nav>}
        </details>
        <details className="diary-workspace-export"><summary>{t('diary.workspace.exportWorkspace')}</summary>
          <p>{p.local ? t('diary.workspace.exportLocalNote') : t('diary.workspace.exportOnlineNote')}</p>
          {!p.local && <button className="modal-btn secondary" disabled={p.busy || exporting} onClick={()=>void downloadWorkspace()}>{exporting?t('diary.workspace.preparingZip'):t('diary.workspace.downloadWorkspaceZip')}</button>}
          {exportStatus && <p role="status">{exportStatus}</p>}{exportError && <p role="alert">{exportError}</p>}
        </details>
        <DiaryWorkspaceTrash enabled={!p.local && !!p.managed} busy={p.busy} file={p.file} dirty={dirty || !!p.stored || p.syncPending} onWorking={setTrashWorking} onChanged={p.onRefresh}/>
        <DiaryWorkspaceImport enabled={!p.local && !!p.managed} busy={p.busy} onImported={p.onRefresh}/>
        <details className="diary-workspace-search"><summary>{t('diary.workspace.searchAndBacklinks')}</summary><p>{t('diary.workspace.searchHint')}</p><form onSubmit={e=>{e.preventDefault();void search();}}><label className="diary-workspace-filter">{t('diary.workspace.searchText')}<input type="search" minLength={2} maxLength={200} required={!hasFilter} value={query} onChange={e=>setQuery(e.target.value)}/></label>
          <label className="diary-workspace-filter">{t('diary.workspace.fromDate')}<input type="date" value={filters.from || ''} onChange={e=>setFilters({...filters,from:e.target.value})}/></label>
          <label className="diary-workspace-filter">{t('diary.workspace.throughDate')}<input type="date" min={filters.from} value={filters.to || ''} onChange={e=>setFilters({...filters,to:e.target.value})}/></label>
          <label className="diary-workspace-filter">{t('diary.workspace.hashtag')}<input placeholder="#tag" maxLength={81} value={filters.tag || ''} onChange={e=>setFilters({...filters,tag:e.target.value})}/></label>
          <p>{t('diary.workspace.dateFilterHint')}</p>
          <button className="popup-tab" disabled={searching || (!hasFilter && query.trim().length<2) || (query.trim().length>0 && query.trim().length<2)}>{t('diary.workspace.searchContents')}</button>
          {hasFilter && <button type="button" className="popup-tab" onClick={()=>setFilters({})}>{t('diary.workspace.clearFilters')}</button>}</form><button className="popup-tab" disabled={searching || !p.file.path} onClick={()=>void search('backlinks')}>{t('diary.workspace.findLinksToFile')}</button><p>{t('diary.workspace.backlinksHint')}</p>
          {searching && <p role="status">{t('diary.workspace.searchingFiles')}</p>}{searchError && <p role="alert">{searchError}</p>}
          {report && <div><p role="status">{t('diary.workspace.searchSummary', { results: searchKind==='backlinks'?t.plural('diary.workspace.linkingFiles', report.results.length):t.plural('diary.workspace.matches', report.results.length), checked: t.plural('diary.workspace.filesChecked', report.scanned) })}{report.partial?` · ${t('diary.workspace.partialResults')}`:''}{report.skipped?` · ${t.plural('diary.workspace.unreadableItems', report.skipped)}`:''}</p>{report.partial && <p>{t('diary.workspace.someFilesNotSearched')}</p>}{report.results.map(result=><button className="diary-search-result" key={result.path} disabled={p.busy} onClick={()=>p.onOpen(result.path)}><strong>{result.path}</strong><span>{result.snippet}</span></button>)}
            {/* Notes that name this one without linking it. Shown, never rewritten: turning a
                mention into a link is an edit to someone's note, and edits here are explicit. */}
            {searchKind==='backlinks' && report.mentions && <section className="diary-mentions" aria-label={t('diary.workspace.unlinkedMentions')}>
              <h3>{t('diary.workspace.unlinkedMentionsCount', { count: report.mentions.length })}</h3>
              {report.mentions.length===0
                ? <p>{t('diary.workspace.noOtherNoteNames')}</p>
                : report.mentions.map(result=><button className="diary-search-result" key={result.path} disabled={p.busy} onClick={()=>p.onOpen(result.path)}><strong>{result.path}</strong><span>{result.snippet}</span></button>)}
            </section>}</div>}
        </details>
        <LocalGraph path={p.file.path} text={p.text} root={p.folderPath} busy={p.busy} onSearch={p.onSearch} onOpen={p.onOpen}/>
        <details className="diary-workspace-outline"><summary>{t('diary.workspace.outlineCount', { count: outline.length })}</summary>{outline.length ? outline.map(item=><button key={item.offset} className="popup-tab" onClick={()=>jump(item.offset)}>{item.label}</button>) : <p>{t('diary.workspace.addHeadings')}</p>}</details>
      </aside>
    </div>
  </section>;
}
