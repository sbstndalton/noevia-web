// Client for the coworker routes (sbstndalton/noevia#2446; the server side is sbstndalton/noevia-rs#445, routed
// as `specialist`). Lists answer `{revision, specialists}`, one record `{revision, specialist}`; a PATCH or DELETE
// carries the list `revision` it was based on and a mismatch is a 409 `stale_revision` with the current one.
import { areaRequest, isObject, num, SpacesError } from './spaces-api';

export interface Specialist {
  id: string; name: string; glyph: string; tint: string; brief: string;
  /** The backing project and conversation: null until the server creates them. */
  projectId: string | null; chatId: string | null;
  spaces: string[]; defaultSpace: string | null;
  /** Allowed toolboxes. Present only when the server keeps them on the record (see CoworkerSettings). */
  toolboxes?: string[];
  createdAt: number; updatedAt: number;
}
export interface SpecialistList { revision: number; specialists: Specialist[] }
export interface SpecialistRecord { revision: number; specialist: Specialist }
/** The fields a person edits; `toolboxes` only travels when the server has it. */
export interface SpecialistFields { name: string; glyph: string; tint: string; brief: string; spaces: string[]; defaultSpace: string | null; toolboxes?: string[] }

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const orNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function parseSpecialist(v: unknown): Specialist {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.name !== 'string') throw new SpacesError('Coworker response was invalid.', 200);
  return {
    id: v.id, name: v.name, glyph: typeof v.glyph === 'string' ? v.glyph : '', tint: typeof v.tint === 'string' ? v.tint : '',
    brief: typeof v.brief === 'string' ? v.brief : '', projectId: orNull(v.projectId), chatId: orNull(v.chatId),
    spaces: strings(v.spaces), defaultSpace: orNull(v.defaultSpace),
    ...(Array.isArray(v.toolboxes) ? { toolboxes: strings(v.toolboxes) } : {}),
    createdAt: num(v.createdAt), updatedAt: num(v.updatedAt),
  };
}
export function parseSpecialistList(v: unknown): SpecialistList {
  if (!isObject(v) || !Array.isArray(v.specialists)) throw new SpacesError('Coworker list was invalid.', 200);
  return { revision: num(v.revision), specialists: v.specialists.map(parseSpecialist) };
}
export function parseSpecialistRecord(v: unknown): SpecialistRecord {
  if (!isObject(v)) throw new SpacesError('Coworker response was invalid.', 200);
  return { revision: num(v.revision), specialist: parseSpecialist(v.specialist) };
}

const call = (path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) => areaRequest('/api/specialists', path, init);
const enc = encodeURIComponent;

export const listSpecialists = (signal?: AbortSignal) => call('', { signal }).then(parseSpecialistList);
export const readSpecialist = (id: string, signal?: AbortSignal) => call(`/${enc(id)}`, { signal }).then(parseSpecialistRecord);
/** Create takes the person's fields except the tools (the server makes the backing project and chat). */
export const createSpecialist = (fields: Omit<SpecialistFields, 'toolboxes'>) => call('', { method: 'POST', body: fields }).then(parseSpecialistRecord);
export const patchSpecialist = (id: string, revision: number, changes: Partial<SpecialistFields>) => call(`/${enc(id)}`, { method: 'PATCH', body: { revision, ...changes } }).then(parseSpecialistRecord);
export const deleteSpecialist = (id: string, revision: number) => call(`/${enc(id)}`, { method: 'DELETE', body: { revision } }).then(() => undefined);
