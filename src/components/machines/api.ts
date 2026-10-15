// #1638: Settings → Inference machines (GET/POST /api/models/machines, administrators only). Kept React-free.
import { apiFetch } from '../../api';

export type MachineServiceId = 'chatFast' | 'chatSmart' | 'chatCode' | 'vision' | 'decision' | 'sensitivity' | 'embedding' | 'reranker' | 'ocr' | 'documents';
/** How a service moves: 'runtime' at once, 'reindex' through the embedding re-index, 'local' stays here, 'deployment' set by the deployment. */
export type MachineServiceMode = 'runtime' | 'reindex' | 'local' | 'deployment';
export type HealthState = 'up' | 'down' | 'unreachable' | 'unknown';
export type MachineHealthState = 'up' | 'down' | 'unreachable' | 'idle';

export interface Machine {
  id: string;
  builtIn?: boolean;
  /** null for "This machine". */
  name: string | null;
  address: string | null;
  /** The name did not resolve when it was saved. */
  unresolved?: boolean;
  services: MachineServiceId[];
}
export interface MachineService {
  id: MachineServiceId;
  mode: MachineServiceMode;
  /** 'local', a machine id, or 'other' (embeddings at an address no machine has). */
  machine: string;
  port?: number;
  protocol?: 'tei' | 'llamacpp';
  /** OCR and Docling only: whether the deployment has switched the worker on. False: nothing to move (#1847). */
  enabled?: boolean;
  /** Where it reaches now (administrators only). */
  url?: string | null;
}
export interface MachinesHealth { services: Partial<Record<MachineServiceId, { state: HealthState; reason?: string }>>; machines: Record<string, MachineHealthState> }
export interface MachinesView { machines: Machine[]; services: MachineService[]; health?: MachinesHealth }
export interface EmbeddingTarget { baseUrl: string; model: string; profile: string }

export const MACHINES_PATH = '/api/models/machines';

/** A refused change: `code` is the server's id; `target` comes with 'reindexRequired'. */
export class MachineError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly target?: EmbeddingTarget) { super(message); }
}

function shape(v: Partial<MachinesView> | null | undefined): MachinesView {
  return {
    machines: Array.isArray(v?.machines) ? v!.machines : [],
    services: Array.isArray(v?.services) ? v!.services : [],
    ...(v?.health && typeof v.health === 'object' ? { health: v.health } : {}),
  };
}

export async function fetchMachines({ health = false }: { health?: boolean } = {}): Promise<MachinesView> {
  const r = await apiFetch(health ? `${MACHINES_PATH}?health=1` : MACHINES_PATH);
  const v = await r.json().catch(() => null) as (MachinesView & { error?: string }) | null;
  if (!r.ok) throw new MachineError(v?.error || `HTTP ${r.status}`, r.status);
  return shape(v);
}

export type MachineAction =
  | { action: 'add'; name: string; address: string }
  | { action: 'update'; id: string; name?: string; address?: string }
  | { action: 'remove'; id: string }
  | { action: 'assign'; service: MachineServiceId; machine: string; port?: number; protocol?: 'tei' | 'llamacpp' };

export async function machineAction(body: MachineAction): Promise<MachinesView> {
  const r = await apiFetch(MACHINES_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const v = await r.json().catch(() => null) as (MachinesView & { error?: string; code?: string; target?: EmbeddingTarget }) | null;
  if (!r.ok) throw new MachineError(v?.error || `HTTP ${r.status}`, r.status, v?.code, v?.target);
  return shape(v);
}

/** A port as typed: a whole number from 1 to 65535, else null. */
export function parsePort(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,5}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 65535 ? n : null;
}
