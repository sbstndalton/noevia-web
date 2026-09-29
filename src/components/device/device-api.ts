// Native-app sign-in (#555): the browser's side of the device flow (server/routes/device-auth.cjs).
// Every call goes through apiFetch, so it carries the session cookie and, for writes, the CSRF
// header. The server refuses all of these to a device token: only a signed-in browser approves
// devices or manages them.
import { apiFetch } from '../../api';

/** A pending sign-in request, as the approval screen shows it. */
/** `ip` is null unless the server trusts a proxy to report it (TRUST_PROXY); otherwise it would be the tunnel's. */
export interface DeviceRequest { clientName: string; userCode: string; requestedAt: number; expiresAt: number; ip: string | null; userAgent: string }

/** One signed-in device (a grant) in Settings → Security and login. */
export interface SignedInDevice { id: string; clientName: string; createdAt: number; lastUsedAt: number; expiresAt: number; ip: string | null; userAgent: string }

/** A refusal with its HTTP status, so a screen can say "expired" rather than "offline". */
export class DeviceApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await apiFetch(url, init); }
  catch (e) { throw new DeviceApiError(0, e instanceof Error ? e.message : 'network error'); }
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new DeviceApiError(response.status, body?.error || `HTTP ${response.status}`);
  return body;
}

const post = <T>(url: string, body: unknown) => call<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const lookupDeviceCode = (userCode: string) => post<DeviceRequest>('/api/auth/device/lookup', { user_code: userCode });
export const decideDeviceCode = (userCode: string, approve: boolean) => post<{ ok: true; approved: boolean; clientName: string }>('/api/auth/device/approve', { user_code: userCode, approve });
export const listDevices = () => call<{ devices: SignedInDevice[] }>('/api/auth/devices').then((b) => Array.isArray(b.devices) ? b.devices : []);
export const revokeDevice = (id: string) => call<{ ok: true }>(`/api/auth/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** `bcdf ghjk` -> `BCDF-GHJK` as the person types, capped at the code's eight letters. */
export function formatCodeInput(raw: string): string {
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
  return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}
