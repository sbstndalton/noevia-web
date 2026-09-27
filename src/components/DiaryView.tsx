import { DiaryStorageStatus } from './DiaryStorageStatus';
import { searchMarkdownFolder } from '../diary-file-search';
import { recoverDiaryTurns } from '../diary-server-recovery';
import { listLocalRecovery, saveLocalRecovery, forgetLocalRecovery, restoredLocalState } from '../diary-local-recovery';
import type { LocalRecovery, RecoveryState } from '../diary-local-recovery';
import { ReasoningControl } from './ReasoningControl';
import { DiaryMarkdownWorkspace } from './DiaryMarkdownWorkspace';
import { ComposerActions } from './ComposerActions';
import { ComposerModel } from './ComposerModel';
import { ModelPopup } from './ModelPopup';
import { useChatScroll } from '../useChatScroll';
import { LiveTimer, ThinkingBlock } from './ChatView';
import { TOOL_RESULT_LIMIT, ToolCalls } from './ToolCalls';
import { prepareDiaryExtras } from '../diary-extras';
import type { Project, ToolCallView } from '../types';
import { SendIcon } from './Icons';
import { ComposerTextarea } from './ComposerTextarea';
import { DiaryCalendar } from './DiaryCalendar';
import { DiaryContextPanel } from './DiaryContextPanel';
import { useEffect, useRef, useState } from 'react';
import { isFocusable } from '../focus-utils';
import { apiFetch, fetchProfile, deleteProjectFile, fetchDiaryMonth, fetchDiarySource, fetchStorage, streamChat } from '../api';
import type { StorageConnection } from '../api';
import { dateInText, dayLabel, localDay, monthLabel, splitDays } from '../diary-data';
import { DiaryRequestError, directoryPicker, directoryPickerBlockedReason, listFiles, randomSessionId, readFile, saveLocal, scanLocal, syncFileChange, writeFile } from '../diary-workspace';
import type { DiaryFile, DirectoryHandle, FileEntry } from '../diary-workspace';
import { DiaryModal, MarkdownPreview } from './DiaryModal';
import { StoragePicker } from './StoragePicker';
import { useT } from '../i18n';
import '../i18n/diary';

import { diaryExchangeTarget } from '../diary-conversation';
import type { DiaryTurn as Turn } from '../diary-conversation';
type Pending = { before: string | null; content: string };
// `active` is false while the Diary view is mounted but hidden behind another
// view (App.tsx keeps it alive so an in-progress draft, open editor, and
// scroll position survive switching to chat and back). Data-fetching effects
// below gate on `active` so a hidden Diary makes zero /api/diary requests;
// switching a still-mounted instance back to active re-runs those effects to
// pick up anything that changed while it was hidden.
export function DiaryView({ inferenceUp, active = true }: { inferenceUp?: boolean | null; active?: boolean }) {
  const t = useT();
  const [extrasEnabled, setExtrasEnabled] = useState(false);
  const [extraProject, setExtraProject] = useState<Project | null>(null);
  const [extraBusy, setExtraBusy] = useState(false);
  const [extraStatus, setExtraStatus] = useState('');
  const [extraModels, setExtraModels] = useState(false);
  const [extraFiles, setExtraFiles] = useState(false);
  const extraAbort = useRef<AbortController | null>(null);
  useEffect(() => () => extraAbort.current?.abort(), []);
  const refreshExtraProject = async () => {
    const response = await apiFetch('/api/diary/context');
    if (!response.ok) throw new Error(t('diary.errors.loadAttachments'));
    setExtraProject((await response.json()).project);
  };
  const toggleExtras = async () => {
    if (busyRef.current || extraBusy) return;
    if (extrasEnabled) { setExtrasEnabled(false); setExtraStatus(t('diary.extras.off')); return; }
    setExtraBusy(true);
    try {
      const response = await apiFetch('/api/diary/context', { method: 'POST' });
      if (!response.ok) throw new Error(t('diary.errors.enableExtras'));
      setExtraProject((await response.json()).project); setExtrasEnabled(true); setExtraStatus(t('diary.extras.on'));
    } catch (err) { setExtraStatus(err instanceof Error ? err.message : t('diary.errors.enableExtrasShort')); }
    finally { setExtraBusy(false); }
  };
  const [month, setMonth] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [overview, setOverview] = useState<{ready: boolean; failed: boolean; memory: FileEntry[]; sources: FileEntry[]; recentDays: string[]}>({ready:false,failed:false,memory:[],sources:[],recentDays:[]});
  const [months, setMonths] = useState<string[]>([]);
  const [days, setDays] = useState<Record<string,string>>({});
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Record<string,Turn[]>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [storageMode, setStorageMode] = useState<'managed' | 'legacy'>('legacy');
  const [storage, setStorage] = useState<StorageConnection | null>(null);
  const storageRequest = useRef(0);
  const [storageAttempt, setStorageAttempt] = useState(0);
  const [storageError, setStorageError] = useState('');
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
  const [editorError, setEditorError] = useState('');
  const [editorNavigation, setEditorNavigation] = useState(0);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [fileRevision, setFileRevision] = useState(0);
  const [editorStatus, setEditorStatus] = useState('');
  const [storedVersion, setStoredVersion] = useState<DiaryFile | null>(null);
  const [revision, setRevision] = useState(0);
  const session = useRef(randomSessionId());
  const [recoveryOwner,setRecoveryOwner]=useState('');
  const [localRecoveryEnabled,setLocalRecoveryEnabled]=useState(false);
  const [savedRecoveries,setSavedRecoveries]=useState<LocalRecovery[]>([]);
  const [localRecoveryError,setLocalRecoveryError]=useState('');
  const recoverySession=useRef(randomSessionId());
  const storageIdentity=JSON.stringify([storage?.kind,storage?.baseUrl,storage?.bucket,storage?.username,storage?.corpusRoot]);
  const recoverySnapshot=useRef<RecoveryState>(null!);
  recoverySnapshot.current={draft,day,month,turns,pendingLocal,pendingSync,editor,editText,interrupted:busy,storageIdentity};
  useEffect(()=>{
    let stopped=false;
    void fetchProfile().then(async({user})=>{
      const enabled=localStorage.getItem(`cowork-diary-recovery:${user.id}`)==='on';
      const records=await listLocalRecovery(user.id);
      if(!stopped){setRecoveryOwner(user.id);setLocalRecoveryEnabled(enabled);setSavedRecoveries(records);}
    }).catch(()=>{if(!stopped)setLocalRecoveryError(t('diary.errors.recoveryUnavailable'));});
    return()=>{stopped=true;};
  },[]);
  const persistRecovery=async(patch:Partial<RecoveryState>={})=>{
    if(!localRecoveryEnabled || !recoveryOwner || !folder)return;
    await saveLocalRecovery({id:`${recoveryOwner}:${recoverySession.current}`,owner:recoveryOwner,updatedAt:Date.now(),folder,state:{...recoverySnapshot.current,...patch}});
  };
  useEffect(()=>{
    if(!localRecoveryEnabled || !folder || !recoveryOwner)return;
    const timer=window.setTimeout(()=>{void persistRecovery().then(()=>setLocalRecoveryError('')).catch(e=>setLocalRecoveryError(String(e.message||e)));},200);
    return()=>window.clearTimeout(timer);
  },[localRecoveryEnabled,recoveryOwner,folder,draft,day,month,turns,pendingLocal,pendingSync,editor,editText,busy,storageIdentity]);
  const toggleLocalRecovery=async(enabled:boolean)=>{
    if(!recoveryOwner)return;
    try{
      localStorage.setItem(`cowork-diary-recovery:${recoveryOwner}`,enabled?'on':'off');
      setLocalRecoveryEnabled(enabled);
      if(!enabled){
        await forgetLocalRecovery(recoveryOwner,`${recoveryOwner}:${recoverySession.current}`);
        setSavedRecoveries(await listLocalRecovery(recoveryOwner));
      }
    }catch(e){setLocalRecoveryError(String(e));}
  };
  const restoreLocalRecovery=(record:LocalRecovery)=>{
    if((draft.trim() || (editor && editText!==(editor.content||''))) && !window.confirm(t('diary.confirm.replaceDraft')))return;
    const picker=directoryPicker();if(!picker){setError(t('diary.errors.needFolderAccess'));return;}
    const selection=picker({mode:'readwrite'});
    void run(async()=>{
      const selected=await selection;
      if(!selected.isSameEntry || !await selected.isSameEntry(record.folder))throw Error(t('diary.errors.chooseOriginalFolder'));
      if(Object.keys(record.state.pendingSync).length && record.state.storageIdentity!==storageIdentity)throw Error(t('diary.errors.onlineConnectionChanged'));
      const snapshot=await scanLocal(selected), state=restoredLocalState(record.state);
      recoverySession.current=randomSessionId();
      setFolder(selected);setLocalFiles(snapshot);setDraft(state.draft);setDay(state.day);setMonth(state.month);setTurns(state.turns);
      setPendingLocal(state.pendingLocal);setPendingSync(state.pendingSync);pendingSyncRef.current=state.pendingSync;
      setEditor(state.editor);setEditText(state.editText);setSync(false);setWizard(null);
      setStatus(t('diary.status.recoveredOnBrowser'));
      if(state.interrupted)setError(t('diary.errors.previousInterrupted'));
      localStorage.setItem(`cowork-diary-recovery:${recoveryOwner}`,'on');setLocalRecoveryEnabled(true);
      await saveLocalRecovery({id:`${recoveryOwner}:${recoverySession.current}`,owner:recoveryOwner,updatedAt:Date.now(),folder:selected,state});
      await forgetLocalRecovery(recoveryOwner,record.id);setSavedRecoveries(await listLocalRecovery(recoveryOwner));
    });
  };
  const today = localDay();
  const [recovering,setRecovering]=useState(false);
  const [recoveryNotice,setRecoveryNotice]=useState('');
  useEffect(()=>{
    if(folder){setRecovering(false);setRecoveryNotice('');return;}
    if(!active)return; // paused while hidden; re-runs (and refreshes immediately) on activation
    let stopped=false, polling=true;
    const target=day || localDay();
    const recover=async()=>{
      if(busyRef.current){polling=true;return;}
      if(!polling)return;
      try{
        const r=await apiFetch(`/api/diary/exchanges?day=${encodeURIComponent(target)}`);
        if(!r.ok)throw Error(t('diary.errors.recoveryUnavailableCheck'));
        const {exchanges}=await r.json();
        if(stopped || busyRef.current)return;
        const running=exchanges.some((e:{state:string})=>e.state==='running');setRecovering(running);polling=running;
        if(exchanges.length){
          const restored = recoverDiaryTurns(exchanges);
          setTurns(prev=>{const existing=prev[target]||[];return JSON.stringify(existing)===JSON.stringify(restored)?prev:{...prev,[target]:restored};});
        }
        setRecoveryNotice(running?t('diary.status.recoveringActive'):exchanges.some((e:{state:string;kind?:string})=>e.state==='uncertain'&&e.kind!=='preparation')?t('diary.status.uncertainSave'):'');
      }catch(e){if(!stopped)setRecoveryNotice(e instanceof Error?e.message:t('diary.errors.recoveryGeneric'));}
    };
    void recover();const timer=setInterval(()=>void recover(),5000);
    return()=>{stopped=true;clearInterval(timer);};
  },[day,folder,revision,active]);
  const scope = day || (month ? `month:${month}` : 'home');
  const conversation = turns[scope] || [];
  const { scrollRef, onScroll, follow } = useChatScroll(scope, turns, !!day);
  useEffect(() => {
    // Sending from home changes the visible scope while preparation is active.
    if (!busyRef.current) { setExtraStatus(''); }
  }, [scope]);
  const savedLabel = storageMode === 'managed' ? t('diary.storage.appStorage') : storage?.kind === 'local' ? t('diary.storage.server') : storage?.kind === 'nextcloud' ? t('diary.storage.nextcloud') : storage?.kind === 's3' ? t('diary.storage.s3') : storage?.kind === 'webdav' ? t('diary.storage.webdav') : t('diary.storage.saved');
  const pendingCount = Object.keys(pendingSync).length + Object.keys(pendingLocal).length;

  const emptyDiary = overview.ready && !months.length && !overview.memory.length && !overview.sources.length;

  useEffect(() => {
    if (!active) return; // paused while hidden; re-runs (and refreshes) on activation
    const request = ++storageRequest.current;
    setStorageError('');
    void fetchStorage().then(value => {
      if (request === storageRequest.current) setStorage(value);
    }).catch(() => {
      if (request === storageRequest.current) setStorageError(t('diary.errors.storageLoadFailed'));
    });
    return () => { storageRequest.current += 1; };
  }, [revision, storageAttempt, active]);
  useEffect(() => {
    if (!active) return; // paused while hidden; re-runs (and refreshes) on activation
    let stale = false;
    const load = async () => {
      setOverview(prev => ({...prev,ready:false,failed:false}));
      const memoryFolders = ['AI Memory','memory','Memory','context','Context'];
      const isMemory = (path: string) => /^(MEMORY|context|instructions)\.md$/i.test(path) || memoryFolders.some(f => path.startsWith(f+'/') && !path.slice(f.length+1).includes('/'));
      let memory: FileEntry[] = [], sources: FileEntry[] = [], recentDays: string[] = [];
      if (folder) {
        const parsed: Record<string,string> = {};
        for (const [path, text] of Object.entries(localFiles)) {
          for (const [date, content] of Object.entries(splitDays(text, dateInText(path)))) parsed[date] = (parsed[date] || '') + content;
        }
        setDays(parsed);
        recentDays = Object.keys(parsed);
        const rows = Object.keys(localFiles).map(path => ({path,name:path.split('/').pop()!,isDir:false}));
        memory = rows.filter(f => isMemory(f.path));
        sources = rows.filter(f => f.path.startsWith('Raw Sources/') && !f.path.slice(12).includes('/'));
        setMonths([...new Set(Object.keys(parsed).map(d => d.slice(0,7)))].sort().reverse());
      } else {
        const source = await fetchDiarySource();
        if (stale) return;
        setMonths([...new Set(source.months.map(m => m.id))].sort().reverse());
        const root = await listFiles('');
        const folders = root.files.filter(f => f.isDir && [...memoryFolders,'Raw Sources'].includes(f.name));
        const listings = await Promise.all(folders.map(f => listFiles(f.path)));
        const all = [...root.files,...listings.flatMap(row => row.files)].filter(f => !f.isDir);
        memory = all.filter(f => isMemory(f.path));
        sources = all.filter(f => f.path.startsWith('Raw Sources/'));
        const recent = await Promise.all(source.months.map(m=>m.id).sort().reverse().slice(0,2).map(fetchDiaryMonth));
        recentDays = recent.flatMap(r => Object.keys(splitDays(r.todayLog)));
        if (stale) return;
        {
          const result = await fetchDiaryMonth(month || today.slice(0,7));
          if (!stale) setDays(splitDays(result.todayLog));
        }
      }
      if (!stale) setOverview({ready:true,failed:false,memory,sources,recentDays:[...new Set(recentDays)].sort().reverse().slice(0,7)});
    };
    void load().catch(e => { if (!stale) { setError(String(e)); setOverview(prev => ({...prev,ready:false,failed:true})); } });
    return () => { stale = true; };
  }, [folder, localFiles, month, revision, today, active]);
  useEffect(() => {
    if (!active) return; // paused while hidden; re-runs (and refreshes) on activation
    let stale = false;
    setFiles([]); setFilesError(''); setFilesLoading(true);
    if (folder) {
      const entries = new Map<string, FileEntry>();
      const prefix = filePath ? filePath + '/' : '';
      for (const path of Object.keys(localFiles)) if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length), name = rest.split('/')[0];
        entries.set(name, { name, path: prefix+name, isDir: rest.includes('/') });
      }
      setFiles([...entries.values()]); setFilesLoading(false);
    } else void listFiles(filePath).then(r => { if (!stale) setFiles(r.files); }).catch(e => { if (!stale) setFilesError(e instanceof Error ? e.message : String(e)); }).finally(()=>{if(!stale)setFilesLoading(false);});
    return () => { stale = true; };
  }, [folder, localFiles, filePath, revision, fileRevision, active]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (busyRef.current || draft.trim() || pendingCount || (editor && editText !== editor.content)) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount, editor, editText, draft]);

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
        await persistRecovery({pendingSync:remaining,interrupted:true});
        await syncFileChange(path, item.before, item.content);
        delete remaining[path];
      } catch (e) {
        setPendingSync(remaining); pendingSyncRef.current = remaining;
        throw e;
      }
      setPendingSync({ ...remaining }); pendingSyncRef.current = { ...remaining };
    }
    setStatus(t('diary.status.savedAndSynced', { label: savedLabel }));
  };
  const commitLocal = async (changes: Record<string,Pending>) => {
    if (!folder) throw new Error(t('diary.errors.folderDisconnected'));
    const left = { ...changes };
    setPendingLocal(left);
    await persistRecovery({pendingLocal:left,interrupted:true});
    const queue = { ...pendingSyncRef.current };
    for (const [path, item] of Object.entries(changes)) {
      // A retry accepts a file already written successfully before interruption.
      const current = await scanLocal(folder);
      // Creating a new File System Access entry precedes createWritable. A failed
      // first write can leave that entry empty. An explicit retry may fill an
      // empty placeholder, but never replaces differing nonempty text.
      const expected = item.before === null && current[path] === '' ? '' : item.before;
      if (current[path] !== item.content) await saveLocal(folder, path, item.content, expected);
      setLocalFiles(prev => ({ ...prev, [path]: item.content }));
      delete left[path]; setPendingLocal({ ...left });
      if (sync) {
        queue[path] = { before: queue[path] ? queue[path].before : item.before, content: item.content };
        setPendingSync({ ...queue }); pendingSyncRef.current = { ...queue };
      }
    }
    setStatus(t('diary.status.savedLocally'));
    if (sync) { setPendingSync(queue); pendingSyncRef.current = queue; await syncChanges(queue); }
  };
  const submit = () => void run(async () => {
    const message = draft.trim();
    if (!message || extraBusy || recovering) return;
    if(folder && localRecoveryEnabled && localRecoveryError)throw Error(localRecoveryError);
    if (Object.keys(pendingLocal).length) throw new Error(t('diary.errors.retryPendingLocal'));
    const { entryDay, entryTime, month: entryMonth, history } = diaryExchangeTarget(day, turns);
    const displayHistory = turns[entryDay] || [];
    follow();
    // This is a submitted draft, so do not invoke navigate's discard prompt.
    if (month !== entryMonth) setDays({});
    setMonth(entryMonth); setDay(entryDay);
    setDraft('');
    setTurns(prev => ({ ...prev, [entryDay]: [...displayHistory, { role: 'user', content: message }, { role: 'assistant', content: '', startedAt: Date.now() }] }));
    const patchReply = (patch: Partial<Turn>) => setTurns(prev => {
      const current = prev[entryDay] || [];
      return {...prev, [entryDay]: [...current.slice(0,-1), {...current[current.length-1], ...patch}]};
    });
    let text = '', reasoning = '';
    const activity: string[] = [];
    const progress = (label: string) => {
      if (activity.at(-1) !== label) activity.push(label);
      patchReply({activity:[...activity]});
    };
    progress(t('diary.progress.preparing'));
    let answered = false, diaryStarted = false;
    const calls: ToolCallView[] = [];
    try {
      extraAbort.current = new AbortController();
      const useExtras = extrasEnabled && !!extraProject && !!((extraProject.files || []).length || (extraProject.assets || []).length || (extraProject.toolboxes || []).length);
      const preparationId = useExtras && !folder ? randomSessionId() : undefined;
      setExtraStatus(useExtras ? t('diary.progress.preparingContext') : '');
      const extraContext = await prepareDiaryExtras(useExtras, message, `${session.current.slice(0,36)}-${entryDay}-${entryDay}`, ev => {
        if (ev.type === 'status') { setExtraStatus(ev.text || t('diary.progress.preparingContext')); progress(ev.text || t('diary.progress.preparingContext')); }
        if (ev.type === 'reasoning') { reasoning += ev.text || ''; patchReply({reasoning}); }
        if (ev.type === 'tool' || ev.type === 'tool_pending' || ev.type === 'tool_result') {
          const index = ev.index ?? calls.length;
          calls[index] = ev.type === 'tool_result'
            ? {name:ev.name || 'tool',args:calls[index]?.args || '',result:(ev.text || '').slice(0, TOOL_RESULT_LIMIT),status:(ev.text || '').startsWith('ERROR: the user') ? 'denied' : 'done'}
            : {name:ev.name || 'tool',args:ev.args || '',status:ev.type === 'tool_pending' ? 'pending' : undefined,approvalId:ev.id};
          patchReply({tools:[...calls]});
        }
      }, extraAbort.current.signal, preparationId ? {recoveryId:preparationId,entryDay} : undefined);
      extraAbort.current = null;
      if (useExtras) setExtraStatus(t('diary.progress.contextReady'));

      const snapshot = folder ? await scanLocal(folder) : undefined;
      if (snapshot) setLocalFiles(snapshot);
      let decision = '', completed = false, changes: Record<string,string> | undefined;
      if(snapshot)await persistRecovery({interrupted:true});
      diaryStarted = true;
      for await (const ev of streamChat({spaceId:'diary', files:snapshot, extrasEnabled:useExtras, extraContext,
        message, history, preparationId, exchangeId:snapshot ? undefined : randomSessionId(), sessionId:`${session.current.slice(0,36)}-${entryDay}`, entryDay, entryTime})) {
        if (ev.type === 'error') throw new Error(ev.text || t('diary.errors.requestFailed'));
        if (ev.type === 'status') progress(ev.text || t('diary.progress.working'));
        if (ev.type === 'reasoning') { reasoning += ev.text || ''; patchReply({reasoning}); }
        if (ev.type === 'delta' || ev.type === 'answer') {
          text = ev.type === 'answer' ? ev.text || '' : text + (ev.text || '');
          patchReply({content:text}); answered = true;
        }
        if (ev.type === 'diary') { decision = ev.decision || ''; changes = ev.files; }
        if (ev.type === 'done') completed = true;
      }
      if (!completed || !decision) throw new Error(t('diary.errors.savingNotConfirmed'));
      if (decision === 'error') throw new Error(t('diary.errors.writeFailed'));
      if (snapshot) {
        if (!changes) throw new Error(t('diary.errors.localSaveFilesMissing'));
        progress(t('diary.progress.writingLocal'));
        const pending = Object.fromEntries(Object.entries(changes).map(([path,content])=>[path,{before:snapshot[path] ?? null,content}]));
        if (Object.keys(pending).length) await commitLocal(pending);
      }
      const saved = decision === 'logged' || decision === 'ok';
      progress(saved ? t('diary.progress.entrySaved') : t('diary.progress.noEntrySaved'));
      setStatus(saved ? t('diary.status.savedTo', { day: dayLabel(entryDay) }) : t('diary.status.conversationOnly'));
      setRevision(n => n+1);
    } catch (e) {
      const cancelled = extraAbort.current?.signal.aborted;
      extraAbort.current = null;
      progress(cancelled ? t('diary.progress.contextCancelled') : t('diary.progress.needsAttention'));
      setExtraStatus(cancelled ? t('diary.status.contextCancelledNoSend') : '');
      patchReply({tools:calls.map(call => call?.status === 'pending' ? {...call,status:'denied',approvalId:undefined,args:t('diary.errors.contextEndedBeforeApproval')} : call)});
      if (!answered && !diaryStarted) { setDraft(message); setTurns(previous => ({ ...previous, [entryDay]: displayHistory })); }
      if(diaryStarted && !folder)setRevision(n=>n+1);
      if (cancelled) throw new Error(t('diary.status.contextCancelledNoSend'));
      throw e;
    }
  });
  const navigate = (nextMonth: string | null, nextDay: string | null = null) => {
    if (busy) return;
    if (draft.trim() && !window.confirm(t('diary.confirm.discardDraft'))) return;
    setDraft(''); setMonth(nextMonth); setDay(nextDay); setStatus(''); setError('');
    if (nextMonth !== month) setDays({});
  };
  const editorOperation = async (label: string, action: () => Promise<void>, restoreFocus = false) => {
    if (busyRef.current) return;
    const previousFocus=document.activeElement as HTMLElement|null;
    busyRef.current=true;setBusy(true);setEditorError('');setEditorStatus(label);
    try { await action(); }
    catch(e) { setEditorError(e instanceof Error?e.message:String(e));setEditorStatus(t('diary.editor.operationFailed')); }
    finally {busyRef.current=false;setBusy(false);if(restoreFocus)requestAnimationFrame(()=>{if(isFocusable(previousFocus) && (document.activeElement===document.body || document.activeElement===previousFocus))previousFocus.focus({preventScroll:true});});}
  };
  const canLeaveEditor = () => !editor || (editor.content!==null && editText===editor.content) || window.confirm(t('diary.confirm.discardEdits'));
  const currentFile = async (path: string): Promise<DiaryFile> => folder ? {path,content:(await scanLocal(folder))[path] ?? null,version:null} : readFile(path);
  const openFile = (path: string) => {
    if (busyRef.current || !canLeaveEditor()) return;
    void editorOperation(t('diary.editor.loadingFile'), async()=>{
      const file=await currentFile(path);
      setEditorNavigation(n=>n+1);setEditor(file);setEditText(file.content || '');setEditorStatus('');setStoredVersion(null);
      setFilePath(path.split('/').slice(0,-1).join('/'));
    });
  };
  const newEditor = () => {
    if (busyRef.current || !canLeaveEditor()) return;
    setEditorNavigation(n=>n+1);setEditor({path:(filePath?filePath+'/':'')+'notes.md',content:null,version:null});
    setEditText('');setEditorError('');setEditorStatus(t('diary.editor.newFile'));setStoredVersion(null);
  };
  const closeEditor = () => {
    if (busyRef.current || !canLeaveEditor()) return;
    setEditor(null);setEditorError('');setStoredVersion(null);
    requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.diary-home-link')?.focus());
  };
  const saveEditor = () => void editorOperation(t('diary.editor.saving'), async () => {
    if (!editor || storedVersion) return;
    try {
      if (folder) {
        if(pendingLocal[editor.path])throw Error(t('diary.errors.earlierCaptureWaiting'));
        // Editor failures remain in editor state, separately from capture recovery.
        // Accept an already completed write on an explicit retry only.
        const current=await currentFile(editor.path);
        if(current.content!==editText)await saveLocal(folder,editor.path,editText,editor.content);
        setLocalFiles(prev=>({...prev,[editor.path]:editText}));
        setEditor({...editor,content:editText});setEditorStatus(t('diary.editor.savedLocally'));
        if(sync){
          const queue={...pendingSyncRef.current,[editor.path]:{before:pendingSyncRef.current[editor.path] ? pendingSyncRef.current[editor.path].before : editor.content,content:editText}};
          pendingSyncRef.current=queue;setPendingSync(queue);
          try{await syncChanges(queue);setEditorStatus(t('diary.editor.savedLocallyAndSynced'));}
          catch(e){setEditorStatus(t('diary.editor.savedLocallySyncAttention'));setEditorError(e instanceof Error?e.message:String(e));}
        }
      } else {setEditor(await writeFile({...editor,content:editText}));setEditorStatus(t('diary.editor.saved'));}
      setRevision(n=>n+1);
    } catch(e) {
      if(e instanceof DiaryRequestError && e.status===409){
        try {setStoredVersion(await currentFile(editor.path));}
        catch { /* The original failure stays visible; manual comparison can retry. */ }
      }
      throw e;
    }
  }, true);
  const compareStored = () => void editorOperation(t('diary.editor.loadingStoredVersion'), async () => {
    if (!editor) return;
    setStoredVersion(await currentFile(editor.path));setEditorStatus(t('diary.editor.reviewStoredVersion'));
  }, true);
  const acceptStored = (discard: boolean) => {
    if(!storedVersion || busyRef.current)return;
    if(discard && !window.confirm(t('diary.confirm.discardLoadStored')))return;
    setEditor(storedVersion);if(discard)setEditText(storedVersion.content || '');
    setStoredVersion(null);setEditorError('');setEditorStatus(discard?t('diary.editor.storedVersionLoaded'):t('diary.editor.newSaveBaseAccepted'));
  };
  const connectLocal = () => {
    const picker = directoryPicker();
    if (!picker) { setError(t('diary.errors.cannotEditFolder')); return; }
    // Native picker must run directly within the user's click gesture.
    const selection = picker({ mode: 'readwrite' });
    void run(async () => {
      const handle = await selection;
      const snapshot = await scanLocal(handle);
      setFolder(handle); setLocalFiles(snapshot); setWizard(null); setFilePath(''); setMonth(null); setDay(null); setTurns({}); setStatus(t('diary.status.localFolderConnected'));
    });
  };
  const disconnect = () => {
    if (busy || Object.keys(pendingLocal).length) return;
    if (pendingCount && !window.confirm(t('diary.confirm.someFilesNotSynced'))) return;
    setFolder(null); setPendingSync({}); pendingSyncRef.current = {}; setLocalFiles({}); setTurns({}); setMonth(null); setDay(null); setFilePath(''); setRevision(n=>n+1);
  };

  const blockedReason = wizard === 'local' ? directoryPickerBlockedReason() : null;
  const composer = <div className="diary-compose">
    <label htmlFor="diary-draft">{day ? t('diary.compose.addToDay', { day: dayLabel(day) }) : t('diary.compose.whatsOnYourMind')}</label>
    <div className="composer-inner chat-composer-inner pane"><ComposerTextarea id="diary-draft" rows={3} placeholder={day ? t('diary.compose.continueDay') : emptyDiary ? t('diary.compose.writeFirstEntry') : t('diary.compose.writeOrAsk')} value={draft} disabled={busy} onValue={setDraft} onSubmit={submit} /><ComposerActions diary project={extrasEnabled ? extraProject : null} disabled={busy || extraBusy} onChanged={refreshExtraProject} onModels={()=>setExtraModels(true)} onBusy={setExtraBusy} onStatus={setExtraStatus} header={<>
      <p><strong>{t('diary.compose.retrievalCaptureTitle')}</strong> · {t('diary.compose.alwaysOn')}</p>
      <label className="composer-tool-option"><input type="checkbox" checked={extrasEnabled} disabled={busy || extraBusy} onChange={()=>void toggleExtras()} /><span>{t('diary.compose.extraAttachments')}<small>{t('diary.compose.offByDefault')}</small></span></label>
      {extrasEnabled && <button type="button" onClick={()=>setExtraFiles(true)}>{t('diary.compose.manageAttachments', { count: extraProject?.files.length || 0 })}</button>}
    </>} />
    <ComposerModel label={extrasEnabled && extraProject ? t('diary.compose.extrasLabel', { model: extraProject.routing === 'auto' ? t('diary.compose.auto') : extraProject.model || t('diary.compose.localModel') }) : t('diary.compose.diaryCompanion')} disabled={!extrasEnabled || !extraProject || busy || extraBusy} onClick={()=>setExtraModels(true)} hint={extrasEnabled ? t('diary.compose.extrasHint') : t('diary.compose.extrasHintDisabled')} />
    {extrasEnabled && extraProject && <ReasoningControl project={extraProject} disabled={busy || extraBusy} onChanged={refreshExtraProject} />}
    <button className="send-btn glass glass-lens is-primary is-press" aria-label={t('diary.compose.sendLabel')} disabled={busy || recovering || extraBusy || !draft.trim()} onClick={submit}><SendIcon /></button></div>
    {!folder && !day && (turns[today] || []).length > 0 && <button className="popup-tab" onClick={()=>{setMonth(today.slice(0,7));setDay(today);}}>{t('diary.compose.openTodaysConversation')}</button>}
    {recoveryNotice && <p className="composer-action-status" role="status">{recoveryNotice}</p>}
    {extraStatus && <p className="composer-action-status" role="status">{extraStatus}</p>}
    {busy && extraAbort.current && <button className="popup-tab" onClick={()=>extraAbort.current?.abort()}>{t('diary.compose.cancelContext')}</button>}
    <p className="composer-hint">{busy ? t('diary.compose.workingOnDiary') : day ? t('diary.compose.writingToDay', { day: dayLabel(day) }) : t('diary.compose.localTimeHint')}</p>
  </div>;
  return <main className="main diary-workspace">
    <header className="chat-header diary-header"><div className="diary-breadcrumb"><button className="diary-home-link" disabled={busy} onClick={()=>editor?closeEditor():navigate(null)}>{t('diary.title')}</button>{month && <><span>/</span><button className="popup-tab" disabled={busy} onClick={()=>navigate(month)}>{monthLabel(month)}</button></>}{day && <span>/ {new Date(`${day}T12:00:00`).getDate()}</span>}</div><span className="diary-private">{t('diary.privateDiary')}</span></header>
    <div className="diary-layout" style={editor?{display:'none'}:undefined}><section className="diary-primary"><div className="diary-content-scroll" ref={scrollRef} onScroll={onScroll}>
      {inferenceUp === false && <p className="conn-banner">{t('diary.banners.inferenceDown')}</p>}
      {error && <p className="conn-banner" role="alert">{error}</p>}{!editor && editorError && <p className="conn-banner" role="alert">{editorError}</p>}
      {storageError && <div className="conn-banner" role="alert">{storageError} <button className="popup-tab" onClick={() => setStorageAttempt(n => n + 1)}>{t('diary.banners.retryStorage')}</button></div>}
      {localRecoveryError && <p className="conn-banner" role="alert">{localRecoveryError}</p>}
      {!!savedRecoveries.length && !folder && <section className="diary-pending"><div><strong>{t('diary.recovery.localSessionsTitle')}</strong><p>{t('diary.recovery.reconnectHint')}</p>{savedRecoveries.map(record=><div key={record.id}><span>{record.folder.name} · {new Date(record.updatedAt).toLocaleString()}</span><button className="popup-tab" disabled={busy || !storage} onClick={()=>restoreLocalRecovery(record)}>{t('diary.recovery.reconnectAndRecover')}</button><button className="popup-tab" disabled={busy} onClick={()=>{if(window.confirm(t('diary.confirm.removeRecoveryCopy')))void forgetLocalRecovery(recoveryOwner,record.id).then(()=>listLocalRecovery(recoveryOwner)).then(setSavedRecoveries).catch(e=>setError(String(e)));}}>{t('diary.recovery.forget')}</button></div>)}</div></section>}
      {pendingCount > 0 && <div className="diary-pending" role="status"><span>{Object.keys(pendingLocal).length ? t('diary.pending.localSaveNeedsAttention') : t.plural('diary.pending.filesWaiting', Object.keys(pendingSync).length)}</span><button className="popup-tab" disabled={busy} onClick={()=>void run(async()=>{ if(Object.keys(pendingLocal).length) await commitLocal(pendingLocal); else await syncChanges(pendingSync); })}>{t('diary.pending.retry')}</button></div>}
      {!day && <DiaryCalendar month={month || today.slice(0,7)} today={today} days={days} busy={busy} ready={overview.ready} failed={overview.failed} navigate={navigate} />}
      {day && <section className="diary-day"><h1>{dayLabel(day)}</h1>{days[day]?.trim() ? <details className="diary-saved-record" key={`${day}-${!!conversation.length}`} open={!conversation.length}><summary>{t('diary.day.savedEntry')}</summary><MarkdownPreview text={days[day]} /></details> : !conversation.length && <p className="diary-intro">{t('diary.day.blankPage')}</p>}</section>}
      {!!conversation.length && <section className="diary-conversation" aria-live="polite" aria-busy={busy}>{conversation.map((t2,i)=><article className="diary-reply" data-role={t2.role} key={i}><span className="msg-sender">{t2.role==='user'?t('diary.conversation.you'):t('diary.conversation.diaryCompanion')}</span>{t2.role === 'assistant' && t2.activity?.length && <details className="diary-activity" open={busy && i === conversation.length - 1}><summary>{busy && i === conversation.length - 1 ? <>{t2.activity.at(-1)}{t2.startedAt && <> · <LiveTimer startedAt={t2.startedAt} /></>}</> : t('diary.conversation.diaryActivity')}</summary><ol>{t2.activity.map((label,n)=><li key={n}>{label}</li>)}</ol></details>}{t2.reasoning && <ThinkingBlock text={t2.reasoning} live={busy && i === conversation.length - 1 && !t2.content} />}{!!t2.tools?.length && <ToolCalls calls={t2.tools.filter(Boolean)} />}<MarkdownPreview text={t2.content || (busy ? t('diary.conversation.workingOnDiary') : '')} /></article>)}</section>}
      </div>
      <div className="diary-composer-dock">{composer}</div>
      {status && <p className="diary-save-status" role="status">{status}</p>}

    </section><DiaryContextPanel filesLoading={filesLoading} filesError={filesError} retryFiles={()=>setFileRevision(n=>n+1)} recovery={folder && <section><label className="diary-sync-toggle"><input type="checkbox" checked={localRecoveryEnabled} disabled={busy || !recoveryOwner} onChange={e=>void toggleLocalRecovery(e.target.checked)} />{t('diary.recovery.saveOnBrowser')}</label><p className="diary-context-note">{t('diary.recovery.storesNote')}</p></section>} busy={busy} files={files} filePath={filePath} setFilePath={setFilePath} openFile={openFile}
      newFile={newEditor}
      chooseStorage={() => setWizard('choose')} pendingCount={pendingCount} pendingLocal={Object.keys(pendingLocal).length > 0}
      managed={storageMode === 'managed'} storageStatus={<DiaryStorageStatus active={active} onBusyChange={value=>{busyRef.current=value;setBusy(value);}} busy={busy} revision={revision} onMode={setStorageMode} onImported={()=>{setRevision(n=>n+1);setWizard(null);}} />} folderName={folder?.name} savedLabel={savedLabel} corpusRoot={storage?.corpusRoot} sync={sync} setSync={setSync} disconnect={disconnect} /></div>
    {extraModels && extraProject && <ModelPopup projects={[extraProject]} activeProject={extraProject} onClose={()=>setExtraModels(false)} onProjectsChanged={()=>void refreshExtraProject()} />}
    {extraFiles && <DiaryModal title={t('diary.attachments.title')} onClose={()=>setExtraFiles(false)}><p>{t('diary.attachments.storedSeparately')}</p>{(extraProject?.files || []).map(file=><div className="model-row" key={file.name}><span>{file.name}<small> · {file.attachment?.state || file.document?.state || t('diary.attachments.ready')}</small></span><button className="popup-tab" disabled={busy || extraBusy} onClick={()=>void (async()=>{if(!extraProject || !window.confirm(t('diary.confirm.deleteAttachment', { name: file.name })))return;setExtraBusy(true);try{await deleteProjectFile(extraProject.id,file.name);await refreshExtraProject();}catch(err){setExtraStatus(String(err));}finally{setExtraBusy(false);}})()}>{t('diary.attachments.delete')}</button></div>)}</DiaryModal>}

    {wizard && <DiaryModal title={t('diary.wizard.title')} onClose={()=>{if(!busy)setWizard(null);}}>{error&&<p className="conn-banner" role="alert">{error}</p>}{wizard==='choose'?<div className="diary-storage-options"><button className="month-card surface" disabled={busy} onClick={()=>setWizard('local')}><strong>{t('diary.wizard.browserFolder')}</strong><span>{t('diary.wizard.browserFolderHint')}</span></button><button className="month-card surface" disabled={busy || !!folder} onClick={()=>setWizard('online')}><strong>{storageMode === 'managed' ? t('diary.wizard.backupConnection') : t('diary.wizard.existingConnection')}</strong><span>{storageMode === 'managed' ? t('diary.wizard.backupConnectionHint') : t('diary.wizard.existingConnectionHint')}</span></button>{folder&&<p>{t('diary.wizard.returnToSavedStorage')}</p>}</div>:wizard==='local'?<div className="diary-wizard-step"><p>{t('diary.wizard.selectFolder')}</p><p>{t('diary.wizard.smbHint')}</p><label className="diary-sync-toggle"><input type="checkbox" checked={sync} onChange={e=>setSync(e.target.checked)} />{t('diary.wizard.alsoSyncTo', { label: savedLabel })}</label><p className="diary-context-note">{t('diary.wizard.diaryTextSentNote')}</p>{blockedReason==='insecure-context'&&<p role="alert">{t('diary.wizard.insecureContext')}</p>}{blockedReason==='unsupported'&&<p role="alert">{t('diary.wizard.unsupportedBrowser')}</p>}<button className="modal-btn primary" disabled={busy || !directoryPicker()} onClick={connectLocal}>{t('diary.wizard.chooseFolder')}</button><button className="modal-btn secondary" disabled={busy} onClick={()=>setWizard('choose')}>{t('diary.wizard.back')}</button></div>:<StoragePicker onlineOnly backupOnly={storageMode === 'managed'} onSaved={value=>{storageRequest.current+=1;setStorageError('');setStorage(value);setWizard(null);setFilePath('');setRevision(n=>n+1);setTurns({});}} />}</DiaryModal>}
    {editor && <DiaryMarkdownWorkspace navigationKey={editorNavigation} file={editor} text={editText} busy={busy} error={editorError} status={editorStatus} stored={storedVersion} managed={storageMode === 'managed'} local={!!folder} syncPending={!!pendingSync[editor.path]}
      files={files} folderPath={filePath} filesLoading={filesLoading} filesError={filesError}
      onText={setEditText} onPath={path=>setEditor({...editor,path})} onFolder={setFilePath} onOpen={openFile} onNew={newEditor}
      listTemplates={async()=>{
        // The Templates folder at the Diary's root, Obsidian's convention. Its absence is the
        // normal case and means no templates, not an error.
        const isTemplate=(path:string)=>/^Templates\/[^/]+\.md$/i.test(path);
        if(folder){const snapshot=await scanLocal(folder);return Object.entries(snapshot).filter(([path,content])=>isTemplate(path)&&typeof content==='string').slice(0,20).map(([path,content])=>({path,content:String(content)}));}
        const listing=await listFiles('Templates').catch(()=>null);
        const paths=(listing?.files||[]).filter(f=>!f.isDir && isTemplate(f.path)).slice(0,20).map(f=>f.path);
        const read=await Promise.all(paths.map(path=>readFile(path).then(f=>({path,content:f.content ?? ''})).catch(()=>null)));
        return read.filter((t3):t3 is {path:string;content:string}=>!!t3 && !!t3.content);
      }}
      onSearch={async(path,query,signal,kind,filters)=>{
        if(!folder)return searchMarkdownFolder({path,query,kind,signal,filters,list:dir=>listFiles(dir,signal),read:file=>readFile(file,signal)});
        const snapshot=await scanLocal(folder);
        return searchMarkdownFolder({path,query,kind,signal,filters,list:async(dir)=>{
          const prefix=dir?dir+'/':'',entries=new Map<string,FileEntry>();
          for(const key of Object.keys(snapshot))if(key.startsWith(prefix)){const rest=key.slice(prefix.length),name=rest.split('/')[0];entries.set(name,{path:prefix+name,name,isDir:rest.includes('/')});}
          return {files:[...entries.values()]};
        },read:async(file)=>({path:file,content:snapshot[file] ?? null,version:null})});
      }}
      onRefresh={()=>setFileRevision(n=>n+1)} onSave={saveEditor} onCompare={compareStored} onRebase={()=>acceptStored(false)} onReload={()=>acceptStored(true)} onClose={closeEditor} />}

  </main>;
}
