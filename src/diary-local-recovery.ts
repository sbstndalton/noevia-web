import type { DirectoryHandle, DiaryFile } from './diary-workspace';
import type { DiaryTurn } from './diary-conversation';
export type PendingSave = { before: string | null; content: string };
export type RecoveryState = {
  draft: string; day: string | null; month: string | null;
  turns: Record<string, DiaryTurn[]>;
  pendingLocal: Record<string, PendingSave>; pendingSync: Record<string, PendingSave>;
  editor: DiaryFile | null; editText: string; interrupted: boolean; storageIdentity: string;
};
export type LocalRecovery = { id: string; owner: string; updatedAt: number; folder: DirectoryHandle; state: RecoveryState };
const limit = 4 * 1024 * 1024;
/** Approval ids are never reusable after recovery. Keep tool outcomes as history. */
export function recoveryState(state: RecoveryState): RecoveryState {
  const copy = JSON.parse(JSON.stringify(state)) as RecoveryState;
  if (new TextEncoder().encode(JSON.stringify(copy)).length > limit) throw Error('Browser recovery exceeds 4 MB. Save or discard older conversation text before continuing.');
  for (const turns of Object.values(copy.turns)) for (const turn of turns) {
    turn.tools = turn.tools?.filter(Boolean).map(({approvalId: _id, ...tool}) => tool.status === 'pending' || tool.status === 'running'
      ? {...tool, status: 'denied', args: 'Interrupted tool request. No approval was restored.'} : tool);
  }
  return copy;
}
export function restoredLocalState(state: RecoveryState): RecoveryState {
  const copy=recoveryState(state);
  if(copy.interrupted){
    const key=copy.day || '';
    const last=copy.turns[key]?.filter(turn=>turn.role==='assistant').at(-1);
    if(last)last.activity=[...(last.activity||[]),'Recovered after interruption. Check files and tool results; nothing was resent.'];
  }
  return copy;
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('cowork-diary-local-recovery', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions', {keyPath:'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error('This browser could not open local recovery storage.'));
    request.onblocked = () => reject(Error('Close other noevia tabs to open browser recovery storage.'));
  });
}
export async function listLocalRecovery(owner: string): Promise<LocalRecovery[]> {
  const db = await database();
  try { return await new Promise((resolve,reject) => {
    const request = db.transaction('sessions').objectStore('sessions').getAll();
    request.onsuccess = () => resolve((request.result as LocalRecovery[]).filter(record=>record.owner===owner).sort((a,b)=>b.updatedAt-a.updatedAt));
    request.onerror = () => reject(Error('Browser recovery could not be read.'));
  }); } finally { db.close(); }
}
// Serialize saves so a late disk transaction cannot replace a newer snapshot.
let queue: Promise<void> = Promise.resolve();
export function saveLocalRecovery(record: LocalRecovery): Promise<void> {
  const safe = {...record, state:recoveryState(record.state)};
  const work = queue.catch(()=>undefined).then(async()=>{
    const db=await database();
    try { await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put(safe);
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(Error('Browser recovery could not be saved. Check browser storage space before closing this page.'));
    }); } finally {db.close();}
  });
  queue=work;return work;
}
export async function forgetLocalRecovery(owner: string, id: string): Promise<void> {
  await queue.catch(()=>undefined);
  const db=await database();
  try {await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('sessions','readwrite'), store=tx.objectStore('sessions'), read=store.get(id);
    read.onsuccess=()=>{if(read.result?.owner===owner)store.delete(id);};
    tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(Error('Browser recovery could not be removed.'));
  });}finally{db.close();}
}
