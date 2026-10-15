// #1805: import a whole folder from this computer, every subfolder included.
//
// A folder arrives two ways: the "Add folder" picker (<input webkitdirectory>, every file with its
// webkitRelativePath) or a dropped folder (DataTransferItem.webkitGetAsEntry, walked here). Both
// become a list of { file, path } where `path` starts with the folder's own name
// (`my-notes/docs/api/auth.md`), so two same-named files in different subfolders never meet and
// importing the same folder again lands on the same paths.
//
// The skip list and the readable types are the server's (contracts/folder-import.json, pinned
// from noevia-core). The browser applies them first only to keep a node_modules from being read
// or hashed; the server decides again, and its plan is what the screen shows.
import contract from '../contracts/folder-import.json';

export interface FolderFile { file: File; path: string }
export type SkipCode = 'invalidPath' | 'system' | 'hidden' | 'unsupported' | 'duplicate' | 'caseCollision' | 'empty' | 'tooLarge' | 'fileLimit' | 'sizeLimit' | 'sizeMismatch' | 'projectLimit' | 'documentLimit' | 'imageLimit' | 'failed';
export interface SkippedItem { path: string; code: SkipCode; count?: number; reason?: string; max?: number }

const SKIP = new Set(contract.skipNames.map((n) => n.toLowerCase()));
const READABLE = new Set(contract.readableExtensions);

/** 'system' or 'hidden' when a folder or file name is skipped wherever it appears; else null. */
export function skippedName(name: string): 'system' | 'hidden' | null {
  if (SKIP.has(name.toLowerCase())) return 'system';
  if (contract.skipHidden && name.startsWith('.')) return 'hidden';
  return null;
}

const extensionOf = (name: string) => { const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(dot).toLowerCase() : ''; };
export const isReadableName = (name: string) => READABLE.has(extensionOf(name));

/** Split a folder's files into candidates for the server's plan and what is skipped here. A skipped
 *  folder is one row (`app/node_modules`, with how many files it held), not one row per file. */
export function sortFolder(items: FolderFile[]): { candidates: FolderFile[]; skipped: SkippedItem[] } {
  const candidates: FolderFile[] = [];
  const folders = new Map<string, SkippedItem>();
  const skipped: SkippedItem[] = [];
  for (const item of items) {
    const segments = item.path.split('/').filter(Boolean);
    const at = segments.findIndex((s) => skippedName(s));
    if (at >= 0) {
      const code = skippedName(segments[at])!;
      if (at === segments.length - 1) { skipped.push({ path: item.path, code }); continue; }
      const key = segments.slice(0, at + 1).join('/');
      const row = folders.get(key) || { path: key, code, count: 0 };
      row.count = (row.count || 0) + 1;
      folders.set(key, row);
      continue;
    }
    if (!isReadableName(segments[segments.length - 1] || '')) { skipped.push({ path: item.path, code: 'unsupported' }); continue; }
    candidates.push(item);
  }
  return { candidates, skipped: [...folders.values(), ...skipped] };
}

/** The files an <input webkitdirectory> picked, with their paths inside the chosen folder. */
export function fromInput(list: FileList | File[] | null): FolderFile[] {
  // NFC, as the server stores it: a decomposed name from macOS must find its file in the plan's answer.
  return Array.from(list || []).map((file) => ({ file, path: ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).normalize('NFC') }));
}

// The File and Directory Entries API, as much of it as a drop needs.
interface Entry { isFile: boolean; isDirectory: boolean; name: string; fullPath: string }
interface FileEntry extends Entry { file(ok: (f: File) => void, fail: (e: unknown) => void): void }
interface DirEntry extends Entry { createReader(): { readEntries(ok: (e: Entry[]) => void, fail: (e: unknown) => void): void } }

/** Every file under the dropped folders (and any dropped loose files), walked breadth-first. A
 *  skipped folder is not entered at all: its files are never listed or read. */
export async function fromDrop(items: DataTransferItemList | null): Promise<{ files: FolderFile[]; skipped: SkippedItem[]; folders: number }> {
  const roots: Entry[] = [];
  for (const item of Array.from(items || [])) {
    if (item.kind !== 'file') continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  const files: FolderFile[] = [], skipped: SkippedItem[] = [];
  let queue = roots, folders = 0;
  while (queue.length) {
    const next: Entry[] = [];
    for (const entry of queue) {
      const path = (entry.fullPath.replace(/^\/+/, '') || entry.name).normalize('NFC');
      const why = skippedName(entry.name);
      if (why) { skipped.push({ path, code: why }); continue; }
      if (entry.isDirectory) {
        folders += 1;
        if (path.split('/').length > contract.maxDepth) { skipped.push({ path, code: 'invalidPath' }); continue; }
        const reader = (entry as DirEntry).createReader();
        // readEntries answers in batches (about 100 in Chrome) until it answers an empty one.
        for (;;) {
          const batch = await new Promise<Entry[]>((ok, fail) => reader.readEntries(ok, fail)).catch(() => [] as Entry[]);
          if (!batch.length) break;
          next.push(...batch);
        }
      } else if (entry.isFile) {
        const file = await new Promise<File | null>((ok) => (entry as FileEntry).file(ok, () => ok(null)));
        if (file) files.push({ file, path });
        else skipped.push({ path, code: 'failed' });
      }
    }
    queue = next;
  }
  return { files, skipped, folders };
}

/** True when a drag carries at least one folder (or file) the drop can take. */
export const dragHasFiles = (e: { dataTransfer: DataTransfer | null }) => Array.from(e.dataTransfer?.types || []).includes('Files');

/** Lowercase hex SHA-256 of a file, for the server's unchanged-file check; '' where SubtleCrypto
 *  is unavailable (plain http on a LAN name), and the server then treats the file as changed. */
export async function sha256(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) return '';
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The path a source shows in Sources: the part inside its folder, so `docs/api/auth.md` and
 *  `notes/auth.md` are told apart. A project's own upload drops the type group it is filed under. */
export function sourceDisplayPath(file: { name: string; source?: string | null; attachment?: { group?: string } | null }, projectFolder?: string | null): string {
  const name = file.name;
  if (file.source && projectFolder && file.source === projectFolder && file.attachment?.group && name.startsWith(`${projectFolder}/${file.attachment.group}/`)) {
    return name.slice(projectFolder.length + file.attachment.group.length + 2);
  }
  if (file.source && name.startsWith(`${file.source}/`)) return name.slice(file.source.length + 1);
  if (!file.source) return name;
  return name.split('/').pop() || name;
}

/** Until a plan answers with the server's values: a folder import's file cap follows the project source limit. */
export const FOLDER_IMPORT_DEFAULTS = { maxFiles: contract.projectLimits.sources, maxBytes: contract.maxBytes, projectSources: contract.projectLimits.sources, projectDocuments: contract.projectLimits.documents, projectImages: contract.projectLimits.images };
