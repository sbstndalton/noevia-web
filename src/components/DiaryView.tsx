import { ComposerActions } from './ComposerActions';
import { ModelPopup } from './ModelPopup';
import { ToolChips } from './ChatView';
import { prepareDiaryExtras } from '../diary-extras';
import type { Project, ToolCallView } from '../types';
import { SendIcon } from './Icons';
import { ShellIcon } from './ShellIcon';
import { useEffect, useRef, useState } from 'react';
import { apiFetch, deleteProjectFile, fetchDiaryMonth, fetchDiarySource, fetchStorage, streamChat } from '../api';
import type { StorageConnection } from '../api';
import { calendarDays, dateInText, dayLabel, localDay, localTimestamp, monthLabel, splitDays } from '../diary-data';
import { diaryRequest, directoryPicker, directoryPickerBlockedReason, listFiles, randomSessionId, readFile, saveLocal, scanLocal, syncFileChange, writeFile } from '../diary-workspace';
import type { DiaryFile, DirectoryHandle, FileEntry } from '../diary-workspace';
import { DiaryModal, MarkdownPreview } from './DiaryModal';
import { StoragePicker } from './StoragePicker';

type Turn = { role: 'user' | 'assistant'; content: string };
type Pending = { before: string | null; content: string };
export function DiaryView({ inferenceUp }: { inferenceUp?: boolean | null }) {
  const [extrasEnabled, setExtrasEnabled] = useState(false);
  const [extraProject, setExtraProject] = useState<Project | null>(null);
  const [extraBusy, setExtraBusy] = useState(false);
  const [extraStatus, setExtraStatus] = useState('');
  const [extraCalls, setExtraCalls] = useState<ToolCallView[]>([]);
  const [extraModels, setExtraModels] = useState(false);
  const [extraFiles, setExtraFiles] = useState(false);
  const extraAbort = useRef<AbortController | null>(null);
  useEffect(() => () => extraAbort.current?.abort(), []);
  const refreshExtraProject = async () => {
    const response = await apiFetch('/api/diary/context');
    if (!response.ok) throw new Error('Could not load diary attachments');
    setExtraProject((await response.json()).project);
  };
  const toggleExtras = async () => {
    if (busyRef.current || extraBusy) return;
    if (extrasEnabled) { setExtrasEnabled(false); setExtraCalls([]); setExtraStatus('Extras off. Normal diary retrieval and capture remain active.'); return; }
    setExtraBusy(true);
    try {
      const response = await apiFetch('/api/diary/context', { method: 'POST' });
      if (!response.ok) throw new Error('Could not enable diary extras');
      setExtraProject((await response.json()).project); setExtrasEnabled(true); setExtraStatus('Extras on for this session. Attachments are stored separately from diary entries.');
    } catch (err) { setExtraStatus(err instanceof Error ? err.message : 'Could not enable extras'); }
    finally { setExtraBusy(false); }
  };
  const [month, setMonth] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [days, setDays] = useState<Record<string,string>>({});
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Record<string,Turn[]>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [storage, setStorage] = useState<StorageConnection | null>(null);
  const [folder, setFolder] = useState<DirectoryHandle | null>(null);
  const [localFiles, setLocalFiles] = useState<Record<string,string>>({});
  const [sync, setSync] = useState(true);
  const [pendingSync, setPendingSync] = useState<Record<string,Pending>>({});
  const pendingSyncRef = useRef(pendingSync); pendingSyncRef.current = pendingSync;
  const [pendingLocal, setPendingLocal] = useState<Record<string,Pending>>({});
  const [wizard, setWizard] = useState<'choose' | 'local' | 'online' | null>(null);
  const [filePath, setFilePath] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [editor, setEditor] = useState<DiaryFile | null>(null);
  const [editText, setEditText] = useState('');
  const [preview, setPreview] = useState(true);
  const [revision, setRevision] = useState(0);
  const session = useRef(randomSessionId());
  const today = localDay();
  const scope = day || (month ? `month:${month}` : 'home');
  const conversation = turns[scope] || [];
  useEffect(() => { setExtraCalls([]); setExtraStatus(''); }, [scope]);
  const savedLabel = storage?.kind === 'local' ? 'Server storage' : storage?.kind === 'nextcloud' ? 'Nextcloud' : storage?.kind === 's3' ? 'S3' : storage?.kind === 'webdav' ? 'WebDAV' : 'saved storage';
  const pendingCount = Object.keys(pendingSync).length + Object.keys(pendingLocal).length;

  useEffect(() => { fetchStorage().then(setStorage).catch(e => setError(String(e))); }, [revision]);
  useEffect(() => {
    let stale = false;
    const load = async () => {
      if (folder) {
        const parsed: Record<string,string> = {};
        for (const [path, text] of Object.entries(localFiles)) {
          for (const [date, content] of Object.entries(splitDays(text, dateInText(path)))) parsed[date] = (parsed[date] || '') + content;
        }
        setDays(parsed);
        setMonths([...new Set([...Object.keys(parsed).map(d => d.slice(0,7)), today.slice(0,7)])].sort().reverse());
      } else {
        const source = await fetchDiarySource();
        if (stale) return;
        setMonths([...new Set([...source.months.map(m => m.id), today.slice(0,7)])].sort().reverse());
        if (month) {
          const result = await fetchDiaryMonth(month);
          if (!stale) setDays(splitDays(result.todayLog));
        }
      }
    };
    void load().catch(e => { if (!stale) setError(String(e)); });
    return () => { stale = true; };
  }, [folder, localFiles, month, revision, today]);
  useEffect(() => {
    let stale = false;
    if (folder) {
      const entries = new Map<string, FileEntry>();
      const prefix = filePath ? filePath + '/' : '';
      for (const path of Object.keys(localFiles)) if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length), name = rest.split('/')[0];
        entries.set(name, { name, path: prefix+name, isDir: rest.includes('/') });
      }
      setFiles([...entries.values()]);
    } else void listFiles(filePath).then(r => { if (!stale) setFiles(r.files); }).catch(e => { if (!stale) setError(String(e)); });
    return () => { stale = true; };
  }, [folder, localFiles, filePath, revision]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (busyRef.current || pendingCount || (editor && editText !== editor.content)) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount, editor, editText]);

  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const syncChanges = async (queue: Record<string,Pending>) => {
    const remaining = { ...queue };
    for (const [path, item] of Object.entries(queue)) {
      try {
        await syncFileChange(path, item.before, item.content);
        delete remaining[path];
      } catch (e) {
        setPendingSync(remaining); pendingSyncRef.current = remaining;
        throw e;
      }
      setPendingSync({ ...remaining }); pendingSyncRef.current = { ...remaining };
    }
    setStatus(`Saved locally and synced to ${savedLabel}.`);
  };
  const commitLocal = async (changes: Record<string,Pending>) => {
    if (!folder) throw new Error('Local folder is no longer connected');
    const left = { ...changes };
    setPendingLocal(left);
    const queue = { ...pendingSyncRef.current };
    for (const [path, item] of Object.entries(changes)) {
      // A retry accepts a file already written successfully before interruption.
      const current = await scanLocal(folder);
      if (current[path] !== item.content) await saveLocal(folder, path, item.content, item.before);
      setLocalFiles(prev => ({ ...prev, [path]: item.content }));
      delete left[path]; setPendingLocal({ ...left });
      if (sync) {
        queue[path] = { before: queue[path] ? queue[path].before : item.before, content: item.content };
        setPendingSync({ ...queue }); pendingSyncRef.current = { ...queue };
      }
    }
    setStatus('Saved in your local folder.');
    if (sync) { setPendingSync(queue); pendingSyncRef.current = queue; await syncChanges(queue); }
  };
  const submit = () => void run(async () => {
    const message = draft.trim();
    if (!message || extraBusy) return;
    if (Object.keys(pendingLocal).length) throw new Error('Retry the pending local save before sending another entry.');
    const now = new Date(), entryDay = day || localDay(now), entryTime = localTimestamp(now);
    const history = conversation.slice(-16);
    setDraft('');
    setTurns(prev => ({ ...prev, [scope]: [...history, { role: 'user', content: message }, { role: 'assistant', content: '' }] }));
    const reply = (text: string) => setTurns(prev => ({ ...prev, [scope]: [...history, { role: 'user', content: message }, { role: 'assistant', content: text }] }));
    let answered = false;
    try {
      setExtraCalls([]);
      extraAbort.current = new AbortController();
      const useExtras = extrasEnabled && !!extraProject && !!((extraProject.files || []).length || (extraProject.assets || []).length || (extraProject.toolboxes || []).length);
      setExtraStatus(useExtras ? 'Preparing optional context…' : '');
      const extraContext = await prepareDiaryExtras(useExtras, message, `${session.current.slice(0,36)}-${entryDay}-${scope}`, ev => {
        if (ev.type === 'status') setExtraStatus(ev.text || 'Preparing optional context…');
        if (ev.type === 'tool' || ev.type === 'tool_pending' || ev.type === 'tool_result') {
          setExtraCalls(previous => {
            const next = [...previous], index = ev.index ?? next.length;
            next[index] = ev.type === 'tool_result'
              ? { name: ev.name || 'tool', args: ev.text || '', status: (ev.text || '').startsWith('ERROR: the user') ? 'denied' : 'done' }
              : { name: ev.name || 'tool', args: ev.args || '', status: ev.type === 'tool_pending' ? 'pending' : undefined, approvalId: ev.id };
            return next;
          });
        }
      }, extraAbort.current.signal);
      extraAbort.current = null;
      if (useExtras) setExtraStatus('Optional context ready · diary retrieval and capture now running');

      if (folder) {
        const snapshot = await scanLocal(folder); setLocalFiles(snapshot);
        const result = await diaryRequest<{reply: string; decision: string; files: Record<string,string>}>('local-exchange', { files: snapshot, message, history, entryDay, entryTime, extrasEnabled: useExtras, extraContext });
        reply(result.reply); answered = true;
        const changes = Object.fromEntries(Object.entries(result.files).map(([path, content]) => [path, { before: snapshot[path] ?? null, content }]));
        if (Object.keys(changes).length) await commitLocal(changes);
        else setStatus('Conversation only — no entry saved.');
      } else {
        let text = '', decision = '';
        for await (const ev of streamChat({ spaceId: 'diary', extrasEnabled: useExtras, extraContext, message, history, sessionId: `${session.current.slice(0,36)}-${entryDay}`, entryDay, entryTime })) {
          if (ev.type === 'error') throw new Error(ev.text || 'Diary request failed');
          if (ev.type === 'delta') { text += ev.text || ''; reply(text); }
          if (ev.type === 'diary') decision = ev.decision || '';
        }
        answered = true;
        if (decision === 'error') throw new Error('The reply arrived, but the diary write failed. Check storage before retrying.');
        setStatus(decision === 'logged' || decision === 'ok' ? `Saved to ${dayLabel(entryDay)}.` : 'Conversation only — no entry saved.');
      }
      setRevision(n => n+1);
    } catch (e) {
      const cancelled = extraAbort.current?.signal.aborted;
      extraAbort.current = null;
      setExtraStatus(cancelled ? 'Optional context cancelled. No diary entry was sent.' : 'Optional context or diary request failed; your draft is preserved.');
      setExtraCalls(previous => previous.map(call => call?.status === 'pending' ? { ...call, status: 'denied', approvalId: undefined, args: 'Optional context ended before this approval completed.' } : call));
      if (!answered) { setDraft(message); setTurns(previous => ({ ...previous, [scope]: history })); }
      if (cancelled) throw new Error('Optional context cancelled. No diary entry was sent.');
      throw e;
    }
  });
  const navigate = (nextMonth: string | null, nextDay: string | null = null) => {
    if (busy) return;
    if (draft.trim() && !window.confirm('Discard the unsent diary draft?')) return;
    setDraft(''); setMonth(nextMonth); setDay(nextDay); setStatus(''); setError('');
    if (nextMonth !== month) setDays({});
  };
  const openFile = (path: string) => void run(async () => {
    const file = folder ? { path, content: (await scanLocal(folder))[path] ?? null, version: null } : await readFile(path);
    setEditor(file); setEditText(file.content || ''); setPreview(true);
  });
  const closeEditor = () => {
    if (busy) return;
    if (editor && editText !== (editor.content || '') && !window.confirm('Discard your unsaved Markdown edits?')) return;
    setEditor(null);
  };
  const saveEditor = () => void run(async () => {
    if (!editor) return;
    if (folder) await commitLocal({ [editor.path]: { before: editor.content, content: editText } });
    else await writeFile({ ...editor, content: editText });
    setEditor(null); setRevision(n => n+1); setStatus('Markdown saved.');
  });
  const connectLocal = () => {
    const picker = directoryPicker();
    if (!picker) { setError('This browser cannot edit a selected folder. Use a browser with folder access, or choose online storage.'); return; }
    // Native picker must run directly within the user's click gesture.
    const selection = picker({ mode: 'readwrite' });
    void run(async () => {
      const handle = await selection;
      const snapshot = await scanLocal(handle);
      setFolder(handle); setLocalFiles(snapshot); setWizard(null); setFilePath(''); setMonth(null); setDay(null); setTurns({}); setStatus('Local folder connected for this session.');
    });
  };
  const disconnect = () => {
    if (busy || Object.keys(pendingLocal).length) return;
    if (pendingCount && !window.confirm('Some files have not synced. They remain in your local folder. Return to saved storage anyway?')) return;
    setFolder(null); setPendingSync({}); pendingSyncRef.current = {}; setLocalFiles({}); setTurns({}); setMonth(null); setDay(null); setFilePath(''); setRevision(n=>n+1);
  };

  const blockedReason = wizard === 'local' ? directoryPickerBlockedReason() : null;
  const composer = <div className="diary-compose">
    <label htmlFor="diary-draft">{day ? `Add to ${dayLabel(day)}` : 'What’s on your mind today?'}</label>
    <div className="composer-inner"><ComposerActions diary project={extrasEnabled ? extraProject : null} disabled={busy || extraBusy} onChanged={refreshExtraProject} onModels={()=>setExtraModels(true)} onBusy={setExtraBusy} onStatus={setExtraStatus} header={<>
      <p><strong>Diary retrieval &amp; capture</strong> · always on</p>
      <label className="composer-tool-option"><input type="checkbox" checked={extrasEnabled} disabled={busy || extraBusy} onChange={()=>void toggleExtras()} /><span>Extra attachments &amp; tools<small>Off by default. Applies while this session is open.</small></span></label>
      {extrasEnabled && <button type="button" onClick={()=>setExtraFiles(true)}>Manage attachments ({extraProject?.files.length || 0})</button>}
    </>} /><textarea id="diary-draft" className="composer-input" rows={3} placeholder={day ? 'Continue this day’s story…' : 'Write about your day, or ask your diary a question…'} value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();submit();} }} />
    <button className="send-btn" aria-label="Send diary message" disabled={busy || extraBusy || !draft.trim()} onClick={submit}><SendIcon /></button></div>
    {extraStatus && <p className="composer-action-status" role="status">{extraStatus}</p>}
    {!!extraCalls.length && <ToolChips calls={extraCalls.filter(Boolean)} />}
    {busy && extraAbort.current && <button className="popup-tab" onClick={()=>extraAbort.current?.abort()}>Cancel optional context</button>}
    <p className="composer-hint">{busy ? 'Working on your diary…' : day ? `Writing to ${dayLabel(day)} · Shift + Enter for a new line` : 'Your current local date and time are used when you send.'}</p>
  </div>;
  return <main className="main diary-workspace">
    <header className="chat-header"><div className="diary-breadcrumb"><button className="diary-home-link" disabled={busy} onClick={()=>navigate(null)}>Diary</button>{month && <><span>/</span><button className="popup-tab" disabled={busy} onClick={()=>navigate(month)}>{monthLabel(month)}</button></>}{day && <span>/ {new Date(`${day}T12:00:00`).getDate()}</span>}</div><span className="diary-private">Private diary</span></header>
    <div className="diary-layout"><section className="diary-primary">
      {inferenceUp === false && <p className="conn-banner">Inference is currently unavailable. Your saved files are still accessible.</p>}
      {error && <p className="conn-banner" role="alert">{error}</p>}
      {pendingCount > 0 && <div className="diary-pending" role="status"><span>{Object.keys(pendingLocal).length ? 'Local save needs attention.' : `${Object.keys(pendingSync).length} file(s) waiting to sync. Local copies are safe.`}</span><button className="popup-tab" disabled={busy} onClick={()=>void run(async()=>{ if(Object.keys(pendingLocal).length) await commitLocal(pendingLocal); else await syncChanges(pendingSync); })}>Retry save / sync</button></div>}
      {!month && <div className="diary-landing"><h1>How has your day been?</h1><p className="diary-intro">A moment, a thought, a question. Start wherever you are.</p>{composer}</div>}
      {month && !day && <section className="diary-calendar-section"><div className="diary-calendar-heading"><button className="popup-tab" disabled={busy} aria-label="Previous month" onClick={()=>{ const d=new Date(`${month}-01T12:00:00`);d.setMonth(d.getMonth()-1);navigate(localDay(d).slice(0,7)); }}>←</button><h1>{monthLabel(month)}</h1><button className="popup-tab" disabled={busy || month>=today.slice(0,7)} aria-label="Next month" onClick={()=>{const d=new Date(`${month}-01T12:00:00`);d.setMonth(d.getMonth()+1);navigate(localDay(d).slice(0,7));}}>→</button></div><p>Choose a day to read or add an entry.</p><div className="diary-calendar" aria-label={monthLabel(month)}>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><span className="calendar-weekday" key={d}>{d}</span>)}{calendarDays(month).map((d,i)=>d ? <button key={d} className={`calendar-day${d===today?' calendar-today':''}`} disabled={busy || d>today} aria-label={`${dayLabel(d)}${days[d]?.replace(/^#+.*$/gm,'').trim() ? ', has entries' : ', no entries'}`} onClick={()=>navigate(month,d)}><span>{Number(d.slice(-2))}</span>{!!days[d]?.replace(/^#+.*$/gm,'').trim() && <span className="calendar-dot" aria-hidden="true" />}</button>:<span key={`blank${i}`} />)}</div></section>}
      {day && <section className="diary-day"><h1>{dayLabel(day)}</h1>{days[day]?.trim() ? <MarkdownPreview text={days[day]} /> : <p className="diary-intro">A blank page for this day. Add something if you’d like.</p>}</section>}
      {!!conversation.length && <section className="diary-conversation" aria-live="polite" aria-busy={busy}>{conversation.map((t,i)=><article className="diary-reply" data-role={t.role} key={i}><span className="msg-sender">{t.role==='user'?'You':'Diary companion'}</span><MarkdownPreview text={t.content || 'Thinking…'} /></article>)}</section>}
      {day && composer}
      {status && <p className="diary-save-status" role="status">{status}</p>}
      {!month && <section className="diary-months"><h2>Past entries</h2><div className="diary-month-grid">{months.map(m=><button key={m} className="month-card" disabled={busy} onClick={()=>navigate(m)}><span className="month-card-name">{monthLabel(m)}</span><span className="month-card-meta">Open calendar <span aria-hidden="true">↗</span></span></button>)}</div></section>}
    </section><aside className="diary-context"><section><div className="diary-panel-heading"><h2>Memory & context</h2><button className="popup-tab" disabled={busy} onClick={()=>{setEditor({path:'memory/notes.md',content:null,version:null});setEditText('');setPreview(false);}}>New</button></div><p className="diary-intro">Open a Markdown file to read or edit it.</p><div className="diary-file-breadcrumb"><button className="popup-tab" disabled={busy} onClick={()=>setFilePath('')}>Diary folder</button>{filePath && <><span>/ {filePath}</span><button className="popup-tab" onClick={()=>setFilePath(filePath.split('/').slice(0,-1).join('/'))}>Up</button></>}</div><div className="diary-file-list">{files.map(f=><button key={f.path} disabled={busy} title={f.path} onClick={()=>f.isDir?setFilePath(f.path):openFile(f.path)}><ShellIcon name={f.isDir?'folder':'book'} size={16}/>{f.name}</button>)}{files.length===0&&<p className="diary-intro">No Markdown files here yet.</p>}</div><p className="diary-context-note">MEMORY.md and files in memory/ or context/ are included as diary reference material.</p></section><section><div className="diary-panel-heading"><h2>Storage location</h2><button className="popup-tab" disabled={busy || pendingCount>0} onClick={()=>setWizard('choose')}>Edit</button></div><strong>{folder ? folder.name : savedLabel}</strong><p className="diary-storage-path">{folder?'This computer · current session':storage?.corpusRoot || 'Diary folder'}</p>{folder ? <><label className="diary-sync-toggle"><input type="checkbox" checked={sync} disabled={busy} onChange={e=>setSync(e.target.checked)} />Also sync to {savedLabel}</label><p className="diary-context-note">Applies to new changes. Pending sync remains available to retry. Reopening noevia restores {savedLabel}.</p><button className="popup-tab" disabled={busy || Object.keys(pendingLocal).length>0} onClick={disconnect}>Return to {savedLabel}</button></>:<p className="diary-context-note">Your saved connection is used when you reopen noevia.</p>}</section></aside></div>
    {extraModels && extraProject && <ModelPopup projects={[extraProject]} activeProject={extraProject} onClose={()=>setExtraModels(false)} onProjectsChanged={()=>void refreshExtraProject()} />}
    {extraFiles && <DiaryModal title="Optional diary attachments" onClose={()=>setExtraFiles(false)}><p>Stored separately from your diary corpus. Used only while extras are on.</p>{(extraProject?.files || []).map(file=><div className="model-row" key={file.name}><span>{file.name}<small> · {file.attachment?.state || file.document?.state || 'ready'}</small></span><button className="popup-tab" disabled={busy || extraBusy} onClick={()=>void (async()=>{if(!extraProject || !window.confirm(`Delete attachment ${file.name} from storage?`))return;setExtraBusy(true);try{await deleteProjectFile(extraProject.id,file.name);await refreshExtraProject();}catch(err){setExtraStatus(String(err));}finally{setExtraBusy(false);}})()}>Delete attachment</button></div>)}</DiaryModal>}
    {wizard && <DiaryModal title="Choose diary storage" onClose={()=>{if(!busy)setWizard(null);}}>{error&&<p className="conn-banner" role="alert">{error}</p>}{wizard==='choose'?<div className="diary-storage-options"><button className="month-card" disabled={busy} onClick={()=>setWizard('local')}><strong>Folder on this computer</strong><span>Use a local or mounted SMB folder for this session.</span></button><button className="month-card" disabled={busy || !!folder} onClick={()=>setWizard('online')}><strong>Online connection</strong><span>Nextcloud, WebDAV, or S3-compatible storage.</span></button>{folder&&<p>Return to your saved storage before changing the online connection.</p>}</div>:wizard==='local'?<div className="diary-wizard-step"><p>Select your diary folder. noevia reads its Markdown files and saves new entries there while this page is open.</p><p>To use SMB, mount the share on your computer first, then select its folder.</p><label className="diary-sync-toggle"><input type="checkbox" checked={sync} onChange={e=>setSync(e.target.checked)} />Also sync to {savedLabel}</label><p className="diary-context-note">Diary text is sent to your configured noevia/inference service to answer questions. With sync off, it is processed in memory and is not saved to your online diary. The folder permission is not stored by noevia.</p>{blockedReason==='insecure-context'&&<p role="alert">This page isn’t loaded over HTTPS (or localhost), so browsers block local folder access here for security — even in Chrome/Edge. Access noevia via HTTPS or a localhost tunnel, or choose online storage.</p>}{blockedReason==='unsupported'&&<p role="alert">Your browser does not offer writable folder access. Use Chrome/Edge or choose online storage.</p>}<button className="modal-btn primary" disabled={busy || !directoryPicker()} onClick={connectLocal}>Choose folder</button><button className="modal-btn secondary" disabled={busy} onClick={()=>setWizard('choose')}>Back</button></div>:<StoragePicker onlineOnly onSaved={value=>{setStorage(value);setWizard(null);setFilePath('');setRevision(n=>n+1);setTurns({});}} />}</DiaryModal>}
    {editor && <DiaryModal title="Markdown viewer & editor" onClose={closeEditor}><label className="diary-editor-path">File path<input className="modal-input" value={editor.path} disabled={editor.content!==null || busy} onChange={e=>setEditor({...editor,path:e.target.value})} /></label><div className="diary-editor-tabs"><button className="popup-tab" aria-pressed={!preview} onClick={()=>setPreview(false)}>Edit Markdown</button><button className="popup-tab" aria-pressed={preview} onClick={()=>setPreview(true)}>Preview</button></div>{preview?<MarkdownPreview text={editText || 'This file is empty.'}/>:<textarea className="diary-md-input" aria-label="Markdown content" value={editText} disabled={busy} onChange={e=>setEditText(e.target.value)} spellCheck={false}/>} {error&&<p role="alert" className="conn-banner">{error}</p>}<footer><span>Changes are saved only when you choose Save.</span><button className="modal-btn secondary" disabled={busy} onClick={closeEditor}>Cancel</button><button className="modal-btn primary" disabled={busy || !editor.path} onClick={saveEditor}>{busy?'Saving…':'Save'}</button></footer></DiaryModal>}
  </main>;
}
