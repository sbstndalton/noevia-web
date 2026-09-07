import { apiFetch } from './api';
export interface DiaryFile { path: string; content: string | null; version: string | null }
export interface FileEntry { path: string; name: string; isDir: boolean }
export async function diaryRequest<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const r = await apiFetch('/api/diary/' + path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || 'Diary request failed');
  return value;
}
export const listFiles = (path = '') => diaryRequest<{ files: FileEntry[] }>('files?path=' + encodeURIComponent(path));
export const readFile = (path: string) => diaryRequest<DiaryFile>('file', { path });
export const writeFile = (file: DiaryFile) => diaryRequest<DiaryFile>('file', file, 'PUT');
interface LocalFileHandle {
  kind: 'file'; name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(text: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
export interface DirectoryHandle {
  kind: 'directory'; name: string;
  values(): AsyncIterable<DirectoryHandle | LocalFileHandle>;
  getDirectoryHandle(name: string, options?: { create: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create: boolean }): Promise<LocalFileHandle>;
}
export const directoryPicker = () => (window as unknown as { showDirectoryPicker?: (options: { mode: string }) => Promise<DirectoryHandle> }).showDirectoryPicker;
/**
 * The File System Access API is spec'd to be unavailable outside a secure
 * context (https, or http://localhost/127.0.0.1) even in Chrome/Edge — so a
 * plain-HTTP LAN/Docker deployment fails this exactly like an unsupported
 * browser does. Surface which one it is so the message tells the user
 * something they can actually act on.
 */
export function directoryPickerBlockedReason(): 'insecure-context' | 'unsupported' | null {
  if (directoryPicker()) return null;
  return window.isSecureContext ? 'unsupported' : 'insecure-context';
}

/**
 * crypto.randomUUID() is also secure-context-only (unlike getRandomValues,
 * which has never been gated) — calling it unguarded on an insecure origin
 * throws, and since this id is generated at component-mount time with no
 * error boundary above it, that crash took down the whole page. This id is
 * only a client-side correlation key for a chat stream, not a security
 * token, so the getRandomValues-backed fallback is fine everywhere.
 */
export function randomSessionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function scanLocal(root: DirectoryHandle): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let total = 0, visited = 0;
  async function scan(dir: DirectoryHandle, prefix = '', depth = 0) {
    if (depth > 10) throw new Error('Folder nesting exceeds 10 levels. Choose a diary subfolder.');
    for await (const handle of dir.values()) {
      if (++visited > 2000) throw new Error('Too many items. Choose a diary subfolder.');
      if (handle.name.startsWith('.')) continue;
      const path = prefix + handle.name;
      if (handle.kind === 'directory') await scan(handle, path + '/', depth + 1);
      else if (path.toLowerCase().endsWith('.md')) {
        const file = await handle.getFile();
        total += file.size;
        if (file.size > 512*1024 || total > 12*1024*1024 || Object.keys(files).length >= 500) throw new Error('Choose a diary folder with at most 500 Markdown files, 512 KiB per file, and 12 MiB total.');
        files[path] = await file.text();
      }
    }
  }
  await scan(root);
  return files;
}
export async function saveLocal(root: DirectoryHandle, path: string, text: string, expected: string | null): Promise<void> {
  const parts = path.split('/');
  if (parts.some(p => !p || p.startsWith('.') || p.includes('\\')) || !path.toLowerCase().endsWith('.md')) throw new Error('Invalid Markdown path');
  let dir = root;
  for (const part of parts.slice(0,-1)) dir = await dir.getDirectoryHandle(part, { create: true });
  let file: LocalFileHandle | undefined;
  let current: string | null = null;
  try { file = await dir.getFileHandle(parts[parts.length-1]); current = await (await file.getFile()).text(); }
  catch (e) { if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e; }
  if (current !== expected) throw new Error(`${path} changed on your computer. Reopen it before saving.`);
  file ??= await dir.getFileHandle(parts[parts.length-1], { create: true });
  const writable = await file.createWritable();
  try { await writable.write(text); await writable.close(); }
  catch (e) { await writable.abort().catch(() => undefined); throw e; }
}
export async function syncFileChange(path: string, before: string | null, content: string): Promise<void> {
  const remote = await readFile(path);
  if (remote.content === content) return;
  if (remote.content !== null && remote.content !== before) throw new Error(`${path} differs in saved storage. Local copy kept; review the saved file before syncing.`);
  await writeFile({ ...remote, content });
}
