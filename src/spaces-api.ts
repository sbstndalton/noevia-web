// Client for the Spaces routes (sbstndalton/noevia#2446, "Phase 1 design and API note"). Every call
// goes through apiFetch (session cookie, CSRF header, API-version check). Responses are read
// defensively: a malformed body is an error the screen words, never a crash.
import { apiFetch } from './api';

export interface Space { id: string; name: string; createdAt: number; updatedAt: number }
export interface PageRow { id: string; title: string; version: string; bytes: number; createdAt: number; updatedAt: number; savedBy: string }
export interface Page extends PageRow { content: string }
export interface SpaceList { revision: number; spaces: Space[] }
export interface PageList { pages: PageRow[]; truncated: boolean }

/** A refused request. `code` is the server's stable key (`stale_revision`, `page_too_large`, …);
 *  on a 409 `version` is the content's current version, which "keep mine" saves on top of. */
export class SpacesError extends Error {
  /** `revision` is a list's current revision on a 409 `stale_revision` of a list write. */
  constructor(message: string, readonly status: number, readonly code?: string, readonly version?: string, readonly revision?: number) { super(message); this.name = 'SpacesError'; }
}

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function parseSpace(v: unknown): Space {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.name !== 'string') throw new SpacesError('Space response was invalid.', 200);
  return { id: v.id, name: v.name, createdAt: num(v.createdAt), updatedAt: num(v.updatedAt) };
}
export function parsePageRow(v: unknown): PageRow {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.title !== 'string') throw new SpacesError('Page response was invalid.', 200);
  return { id: v.id, title: v.title, version: typeof v.version === 'string' ? v.version : '', bytes: num(v.bytes), createdAt: num(v.createdAt), updatedAt: num(v.updatedAt), savedBy: typeof v.savedBy === 'string' ? v.savedBy : 'you' };
}
/** GET a page: `{ page: <row>, content }`. */
export function parsePage(v: unknown): Page {
  if (!isObject(v)) throw new SpacesError('Page response was invalid.', 200);
  const row = parsePageRow(v.page);
  if (typeof v.content !== 'string' || !row.version) throw new SpacesError('Page response was invalid.', 200);
  return { ...row, content: v.content };
}
/** Create, and PUT: `{ page: <row> }` (PUT adds `changed`). */
export function parsePageWrite(v: unknown): PageRow {
  if (!isObject(v)) throw new SpacesError('Page response was invalid.', 200);
  return parsePageRow(v.page);
}
/** Create and rename: `{ revision, space }`. */
export function parseSpaceWrite(v: unknown): Space {
  if (!isObject(v)) throw new SpacesError('Space response was invalid.', 200);
  return parseSpace(v.space);
}
export function parseSpaceList(v: unknown): SpaceList {
  if (!isObject(v) || !Array.isArray(v.spaces)) throw new SpacesError('Space list was invalid.', 200);
  return { revision: num(v.revision), spaces: v.spaces.map(parseSpace) };
}
export function parsePageList(v: unknown): PageList {
  if (!isObject(v) || !Array.isArray(v.pages)) throw new SpacesError('Page list was invalid.', 200);
  return { pages: v.pages.map(parsePageRow), truncated: v.truncated === true };
}

/** One JSON call under `base` (`/api/spaces`, `/api/specialists`): the same errors and the same body rules for both areas. */
export async function areaRequest(base: string, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
  const response = await apiFetch(`${base}${path}`, {
    method: init.method ?? 'GET', signal: init.signal,
    ...(init.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const b = isObject(body) ? body : {};
    throw new SpacesError(typeof b.error === 'string' && b.error ? b.error : `Request failed (${response.status}).`, response.status,
      typeof b.code === 'string' ? b.code : undefined, typeof b.version === 'string' ? b.version : undefined, typeof b.revision === 'number' ? b.revision : undefined);
  }
  return body;
}
const call = (path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) => areaRequest('/api/spaces', path, init);

const enc = encodeURIComponent;

export const listSpaces = (signal?: AbortSignal) => call('', { signal }).then(parseSpaceList);
export const createSpace = (name: string) => call('', { method: 'POST', body: { name } }).then(parseSpaceWrite);
export const renameSpace = (id: string, name: string, revision: number) => call(`/${enc(id)}`, { method: 'PATCH', body: { name, revision } }).then(parseSpaceWrite);
/** `withPages` is sent only when the person confirmed deleting a space that still holds pages. */
export const deleteSpace = (id: string, revision: number, withPages: boolean) => call(`/${enc(id)}`, { method: 'DELETE', body: withPages ? { revision, withPages: true } : { revision } }).then(() => undefined);

export const listPages = (spaceId: string, opts: { q?: string; limit?: number; signal?: AbortSignal } = {}) => {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  params.set('limit', String(opts.limit ?? 100));
  return call(`/${enc(spaceId)}/pages?${params}`, { signal: opts.signal }).then(parsePageList);
};
/** Creates a page; the answer is its row (no text yet), which the editor then reads. */
export const createPage = (spaceId: string, title: string, content = '') => call(`/${enc(spaceId)}/pages`, { method: 'POST', body: { title, content } }).then(parsePageWrite);
export const readPage = (spaceId: string, pageId: string, signal?: AbortSignal) => call(`/${enc(spaceId)}/pages/${enc(pageId)}`, { signal }).then(parsePage);
/** The revision rule: `version` is the one this write is based on; a mismatch is a 409 carrying the current one. */
export const writePage = (spaceId: string, pageId: string, body: { title: string; content: string; version: string }, signal?: AbortSignal) =>
  call(`/${enc(spaceId)}/pages/${enc(pageId)}`, { method: 'PUT', body, signal }).then(parsePageWrite);
export const deletePage = (spaceId: string, pageId: string) => call(`/${enc(spaceId)}/pages/${enc(pageId)}`, { method: 'DELETE' }).then(() => undefined);
