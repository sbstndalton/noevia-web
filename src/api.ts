import { parseUsage, parseUsers, parseProfile, parseProviders } from './settings-data';
// API client — all calls go through the local proxy server (same origin),
// which holds credentials server-side.

import type {
  ChatMeta,
  DiaryCorpus,
  HealthState,
  HistoryEntry,
  InstalledModel,
  LiveStats,
  Project,
  Provider,
  Toolbox,
  WorkspaceInfo,
} from './types';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

function cookie(name: string): string {
  const item = document.cookie.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method || 'GET').toUpperCase();
  const csrf = cookie('cowork_csrf');
  if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', csrf);
  const response = await fetch(input, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 401) window.dispatchEvent(new Event('cowork:unauthorized'));
  return response;
}

export interface AuthUser { id: string; username: string; displayName: string; role: 'admin' | 'member'; disabled: boolean; diaryEnabled: boolean; onboarded?: boolean }
export const setupStatus = (): Promise<{ configured: boolean; publicOrigin: string }> => fetch('/api/setup/status').then(r => r.json());
export const completeSetup = (body: { setupCode: string; publicOrigin: string; username: string; displayName: string; password: string; diaryEnabled: boolean }) => postJson<{ user: AuthUser }>('/api/setup/complete', body);
export const passwordLogin = (username: string, password: string) => postJson<{ user: AuthUser }>('/api/auth/login/password', { username, password });
export const fetchSession = () => getJson<{ user: AuthUser }>('/api/auth/session');
/** Session probe that stays quiet on 401 (no cowork:unauthorized event) — used
 *  by the setup wizard, where "no session yet" is the normal fresh-deployment
 *  case, not an auth failure. Returns the user, or null when signed out. */
export const probeSession = (): Promise<AuthUser | null> =>
  fetch('/api/auth/session', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json().then((j: { user: AuthUser }) => j.user) : null))
    .catch(() => null);
export const logout = () => postJson<{ ok: true }>('/api/auth/logout', {});
export const passkeyLoginOptions = (username: string) => postJson<{ options: PublicKeyCredentialRequestOptionsJSON; challengeToken: string }>('/api/auth/login/passkey/options', { username });
export const passkeyLoginVerify = (challengeToken: string, response: unknown) => postJson<{ user: AuthUser }>('/api/auth/login/passkey/verify', { challengeToken, response });
export const passkeyRegistrationOptions = () => postJson<{ options: PublicKeyCredentialCreationOptionsJSON; challengeToken: string }>('/api/auth/passkeys/register/options', {});
export const passkeyRegistrationVerify = (challengeToken: string, response: unknown, name: string) => postJson<{ verified: boolean }>('/api/auth/passkeys/register/verify', { challengeToken, response, name });
export const acceptInvitation = (body: { token: string; username: string; displayName: string; password: string; diaryEnabled: boolean }) => postJson<{ user: AuthUser }>('/api/auth/invitations/accept', body);
export interface PasskeyInfo { id: string; name: string; deviceType: string; backedUp: boolean; createdAt: number; lastUsedAt?: number | null }
export interface SessionInfo { id: string; createdAt: number; lastSeenAt: number; expiresAt: number; userAgent?: string | null; ip?: string | null;
  /** #404: whether this row is the session the request that fetched the list was made with —
   *  "this device" versus every other signed-in session — not a liveness check. */
  current?: boolean }
export const fetchProfile = () => getJson<unknown>('/api/profile').then(parseProfile);
export const revokeSession = (id: string) => apiFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => { if (!r.ok) throw new Error('session revoke failed'); });
export const updateProfile = (displayName: string) => apiFetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) }).then(r => { if (!r.ok) throw new Error('profile update failed'); return r.json(); });
export const updateFeatures = (diaryEnabled: boolean) => putJson<{ diaryEnabled: boolean }>('/api/profile/features', { diaryEnabled });
/** Marks the setup wizard as finished for this account (resumability gate). */
export const completeOnboarding = () => postJson<{ onboarded: boolean }>('/api/profile/onboarding', {});
export const removePasskey = (id: string) => apiFetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => { if (!r.ok) throw new Error('Passkey could not be removed'); return r.json(); });
export const fetchUsers = () => getJson<unknown>('/api/admin/users').then(parseUsers);
export const createInvitation = (role: 'admin' | 'member' = 'member') => postJson<{ token: string; expiresAt: number }>('/api/admin/invitations', { role });
export const setUserDisabled = (id: string, disabled: boolean) => putJson<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}/disabled`, { disabled });
export const createRecovery = (id: string) => postJson<{ token: string; expiresAt: number }>(`/api/admin/users/${encodeURIComponent(id)}/recovery`, {});
export const deleteUser = (id: string, username: string) => apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) }).then(async r => {
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || `Delete failed: ${r.status}`);
  return result;
});
export interface StorageConnection { kind: 'local' | 'nextcloud' | 'webdav' | 's3'; baseUrl: string; bucket?: string; region?: string; username: string; corpusRoot: string; secretConfigured?: boolean; secretNeedsReauth?: boolean }
export const fetchStorage = () => getJson<StorageConnection>('/api/integrations/storage');
export const saveStorage = (body: StorageConnection & { secret?: string }) => putJson<StorageConnection>('/api/integrations/storage', body);
export const testStorage = (body: Partial<StorageConnection> & { secret?: string; useSavedSecret?: boolean }) => postJson<{ ok: true }>('/api/integrations/storage/test', body);
export const startNextcloud = (baseUrl: string) => postJson<{ flowId: string; loginUrl: string; expiresAt: number }>('/api/integrations/storage/nextcloud/start', { baseUrl });
export const pollNextcloud = (flowId: string, corpusRoot: string) => postJson<StorageConnection & { pending?: boolean }>('/api/integrations/storage/nextcloud/poll', { flowId, corpusRoot });
export interface StorageEntry { name: string; path: string; isDir: boolean; size: number | null; ext: string }
export const browseStorage = (path: string) => getJson<{ entries: StorageEntry[] }>(`/api/integrations/storage/files${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}`);
export const deleteProjectImage = (id: string, assetId: string) =>
  apiFetch(`/api/projects/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' })
    .then((r) => { if (!r.ok) throw new Error('could not remove that image'); });

export const projectImageUrl = (id: string, assetId: string) =>
  `/api/projects/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`;

/** Upload a source file into the project's own storage folder. */
export interface UploadProgress { stage: string; percent?: number }
export async function uploadProjectFile(id: string, body: { name: string; dataBase64: string }, progress: (value: UploadProgress) => void = () => {}) {
  const response = await new Promise<{ poll: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/projects/${encodeURIComponent(id)}/upload?background=1`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    const csrf = cookie('cowork_csrf');
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.timeout = 120000;
    xhr.upload.onprogress = e => progress({ stage: 'Sending file', percent: e.lengthComputable ? Math.round(100 * e.loaded / e.total) : undefined });
    xhr.onerror = () => reject(new Error('Upload connection failed; retry.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out; retry.'));
    xhr.onload = () => {
      if (xhr.status === 401) window.dispatchEvent(new Event('cowork:unauthorized'));
      try { const value = JSON.parse(xhr.responseText); if (xhr.status >= 400) reject(new Error(value.error || 'Upload failed')); else resolve(value); }
      catch { reject(new Error('Invalid upload response')); }
    };
    xhr.send(JSON.stringify({ ...body, organized: true }));
  });
  progress({ stage: 'Upload received · waiting for processing' });
  for (;;) {
    const job = await getJson<{ done: boolean; stage?: string; status?: number; body?: { error?: string; name: string; path: string; bytes: number; attachment?: { reduction?: { note: string } } } }>(response.poll);
    if (job.done) {
      if ((job.status || 500) >= 400) throw new Error(job.body?.error || 'Source processing failed');
      progress({ stage: 'Saved', percent: 100 }); return job.body!;
    }
    progress({ stage: job.stage || 'Queued for processing' });
    await new Promise(resolve => setTimeout(resolve, 750));
  }
}

/** Delete one source file from the project's own folder — removes it from
 *  storage, not just from the project. */
export const deleteProjectFile = (id: string, path: string) =>
  apiFetch(`/api/projects/${encodeURIComponent(id)}/files`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then(async (r) => { if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || 'could not delete'); });

/** Re-read every attached folder and refresh the project's sources from it. */
export const syncProjectSources = (id: string) =>
  postJson<{ files: { name: string; source: string | null; bytes: number }[]; skipped: { folder: string; file?: string; reason: string; retained?: boolean }[] }>(
    `/api/projects/${encodeURIComponent(id)}/sources/sync?background=1`, {});
/** Create one directory in connected storage. */
export const createStorageFolder = (path: string) =>
  postJson<{ path: string; existed: boolean }>('/api/integrations/storage/folder', { path });
export const readStorageFile = (path: string) => postJson<{ name: string; content: string; truncated: boolean }>('/api/integrations/storage/file', { path });
export const completeRecovery = (token: string, password: string) => postJson<{ ok: true }>('/api/auth/recovery/complete', { token, password });

/** Prefer the server's own {error} message over a bare status code — the
 *  server already explains *why* (e.g. "origin not allowed", "invalid CSRF
 *  token"), and swallowing that forced users to guess from a status code alone. */
async function describeFailure(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.clone().json();
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch {
    // non-JSON body; fall through to the generic message
  }
  return `${fallback}: ${res.status}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(await describeFailure(res, `GET ${url} failed`));
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await describeFailure(res, `POST ${url} failed`));
  if (res.status === 202) {
    const { poll } = await res.json() as { poll: string };
    // Source processing can outlive a proxy request. Each poll is short and authenticated.
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const job = await getJson<{ done: boolean; status?: number; body?: T & { error?: string } }>(poll);
      if (!job.done) continue;
      if ((job.status || 500) >= 400) throw new Error(job.body?.error || 'Source processing failed');
      return job.body as T;
    }
  }
  return res.json() as Promise<T>;
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await describeFailure(res, `PUT ${url} failed`));
  return res.json() as Promise<T>;
}

export function fetchWorkspace(): Promise<WorkspaceInfo> {
  return getJson('/api/workspace');
}

// ── Providers (step 9: generic OpenAI-compatible endpoints) ─────────────────

export function fetchProviders(): Promise<{ providers: Provider[] }> {
  return getJson<unknown>('/api/providers').then(parseProviders);
}

export function createProvider(body: { label: string; baseUrl: string; apiKey?: string; defaultModel?: string; shared?: boolean }): Promise<Provider> {
  return postJson('/api/providers', body);
}
export function testProvider(body: { baseUrl: string; apiKey?: string }): Promise<{ ok: true; models: string[] }> { return postJson('/api/providers/test', body); }

export function deleteProvider(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((res) => {
    if (!res.ok) throw new Error(`DELETE provider failed: ${res.status}`);
    return res.json() as Promise<{ ok: boolean }>;
  });
}

// ── Projects ─────────────────────────────────────────────────────────────────

export function createProject(body: {
  icon?: string;
  color?: string;
  name: string;
  goal?: string;
  instructions?: string;
  files?: { name: string; content: string }[];
  routing?: 'manual' | 'auto';
}): Promise<Project> {
  return postJson('/api/projects', body);
}

export function deleteProject(projectId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }).then(
    (r) => {
      if (!r.ok) throw new Error(`delete failed: ${r.status}`);
      return { ok: true } as const;
    },
  );
}

export function saveProjectConfig(
  projectId: string,
  patch: Partial<Pick<Project, 'name' | 'goal' | 'instructions' | 'model' | 'memories' | 'files' | 'icon' | 'color'>> & {
    provider?: string;
    routing?: 'manual' | 'auto';
    reasoningEffort?: 'default' | 'low' | 'high' | null;
    toolboxes?: string[];
  },
): Promise<{ ok: true }> {
  return postJson(`/api/projects/${encodeURIComponent(projectId)}/config`, patch);
}

/** Decide a pending write tool call. 'approve_all' also stops asking for the
 *  rest of this chat; there is deliberately no global "never ask". */
export function decideToolApproval(
  approvalId: string,
  decision: 'approve' | 'deny' | 'approve_all',
): Promise<{ ok: true }> {
  return postJson(`/api/tool-approvals/${encodeURIComponent(approvalId)}`, { decision });
}

export interface McpServerStatus {
  checkedAt?: number | null;
  missingCurated?: number;
  id: string;
  /** Mirrors the server's parser in index.cjs: `bearer` comes from a
   *  `bearer:ENV_NAME` entry and was missing here. */
  auth: 'nextcloud' | 'bearer' | 'internal' | 'none' | 'directory' | 'oauth' | 'personal';
  /** True only for a server an administrator added through the MCP directory (Plugins → Added,
   *  #366); everything else is configured for this deployment (the internal server or an
   *  MCP_SERVERS/MCP_SERVER_URL entry) and never appears in that list. */
  directory?: boolean;
  error: string | null;
  discovered: number;
}

export interface McpStatus {
  configured: boolean;
  /** The first server error, if any — kept for the single-server shape. */
  error?: string | null;
  discovered?: number;
  servers?: McpServerStatus[];
}

/** What noevia has measured about this hardware's prefill speed. `models` is
 *  keyed by model id; `tokensPerSecond` is null until enough real traffic has
 *  been seen to fit a rate. */
export interface PrefillStatus {
  targetMs: number;
  models: Record<string, { buckets: number; tokensPerSecond: number | null; range: [number, number] | null }>;
}

export function fetchToolboxes(): Promise<{ toolboxes: Toolbox[]; mcp: McpStatus; prefill?: PrefillStatus }> {
  return getJson('/api/toolboxes');
}

export interface AutoRoles { fast: string; smart: string; vision?: string; code?: string }

export function fetchAutoRoles(): Promise<{ configured: boolean; roles: AutoRoles | null; missing?: { role: 'fast' | 'smart' | 'vision' | 'code'; model: string }[] }> {
  return getJson('/api/auto-roles');
}

export const fetchRoutingDefault = () => getJson<{ routing: 'auto' | 'manual' }>('/api/routing-default');
export const putRoutingDefault = (routing: 'auto' | 'manual', applyToExisting = false) =>
  putJson<{ routing: 'auto' | 'manual'; updated: number }>('/api/routing-default', { routing, applyToExisting });

export function setAutoRoles(roles: AutoRoles): Promise<{ configured: boolean }> {
  return putJson('/api/auto-roles', roles);
}

export function saveProjectChats(projectId: string, chats: ChatMeta[]): Promise<{ ok: true }> {
  return postJson(`/api/projects/${encodeURIComponent(projectId)}/chats`, { chats });
}

export function deleteChat(projectId: string, chatId: string): Promise<{ ok: true }> {
  return apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/chats/${encodeURIComponent(chatId)}`,
    { method: 'DELETE' },
  ).then((r) => {
    if (!r.ok) throw new Error(`delete failed: ${r.status}`);
    return { ok: true } as const;
  });
}

export function fetchStats(): Promise<LiveStats> {
  return getJson('/api/stats');
}

export function fetchHealth(): Promise<HealthState> {
  return getJson<HealthState>('/api/health').then((health) => ({
    ...health,
    inferenceUp: health.inferenceUp ?? health.lemonadeUp ?? null,
  }));
}

export function fetchInstalledModels(): Promise<InstalledModel[]> {
  return getJson<InstalledModel[]>('/api/models/installed').then(rows => {
    if(!Array.isArray(rows) || rows.some(row=>!row || typeof row.name!=='string' || !Array.isArray(row.labels) || row.labels.some(label=>typeof label!=='string')))throw new Error('Model list was invalid. Try loading it again.');
    return rows;
  });
}

export function fetchDiarySource(): Promise<{ source: string; months: { id: string; label: string }[] }> {
  return getJson('/api/diary/source');
}

export function fetchDiaryMonth(monthId: string): Promise<DiaryCorpus> {
  return getJson(`/api/diary/today?month=${encodeURIComponent(monthId)}`);
}

export const fetchUsage = (aggregate=false) => getJson<unknown>(aggregate?'/api/usage/aggregate':'/api/usage').then(parseUsage);

export function fetchChatHistoryRevision(chatId: string): Promise<{ history: HistoryEntry[]; revision: string | null }> {
  return getJson<{ history: HistoryEntry[]; revision?: string }>(
    `/api/chats/${encodeURIComponent(chatId)}/history`,
  ).then((r) => ({ history: Array.isArray(r.history) ? r.history : [], revision: typeof r.revision === 'string' ? r.revision : null }));
}

// ── Free (non-project) chats — server-side metas so they survive browsers ──

export function saveFreeChats(chats: ChatMeta[]): Promise<{ ok: true }> {
  return postJson('/api/freechats', { chats });
}

export function deleteFreeChat(chatId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/freechats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }).then((r) => {
    if (!r.ok) throw new Error(`delete failed: ${r.status}`);
    return { ok: true } as const;
  });
}

export type HistorySave = { ok: true; revision: string | null } | { ok: false; conflict: { history: HistoryEntry[]; revision: string } };
/** Save a transcript. With a base revision, a concurrent save elsewhere returns the current copy to merge. */
export async function saveChatHistory(chatId: string, history: HistoryEntry[], baseRevision?: string | null): Promise<HistorySave> {
  const res = await apiFetch(`/api/chats/${encodeURIComponent(chatId)}/history`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(baseRevision ? { history, baseRevision } : { history }),
  });
  if (res.status === 409) {
    const body = await res.json();
    return { ok: false, conflict: { history: Array.isArray(body.history) ? body.history : [], revision: String(body.revision || '') } };
  }
  if (!res.ok) throw new Error(`history save failed (${res.status})`);
  const body = await res.json().catch(() => ({}));
  return { ok: true, revision: typeof body.revision === 'string' ? body.revision : null };
}

// Chat streams SSE events from the proxy:
//   { type:'meta', model, chatId? } { type:'reasoning', text } { type:'delta', text }
//   { type:'preamble', text } — delta text from a round that then called tools; move it to reasoning
//   { type:'tool', index, name, args } — accumulated state, upsert on index
//   { type:'tool_pending', id, index, name, args } — a WRITE tool is waiting
//     for the user. The stream stays open and nothing runs until a decision is
//     posted to /api/tool-approvals/:id.
//   { type:'done', model } { type:'diary', decision }
//   { type:'telemetry', phase, model?, timeToFirstToken? }
//   { type:'usage', cumulative prompt/completion/total tokens, provider rate,
//     first-token time and optional MTP accepted/drafted counts }
export async function* streamChat(
  body: { spaceId: string; compactOnly?: boolean; extrasEnabled?: boolean; extraContext?: string;
    exchangeId?: string; recoveryId?: string; preparationId?: string; files?: Record<string,string>; entryTime?: string; entryDay?: string; sessionId?: string; message: string; history: HistoryEntry[]; projectId?: string | null; chatId?: string | null;
    /** #236/#237: the session's harness, and boxes added for this turn only. */
    mode?: 'chat'; turnToolboxes?: string[] },
  signal?: AbortSignal,
): AsyncGenerator<{
  type: string;
  files?: Record<string,string>;
  reply?: string;
  text?: string;
  model?: string;
  chatId?: string;
  name?: string;
  args?: string;
  index?: number; // 'tool' events: which call this is, for upsert-by-index
  id?: string; // 'tool_pending': the approval id to post a decision against
  decision?: string;
  reasoning?: string;
  reasoningEffort?: string;
  route?: string;
  routingDecision?: import('./types').RoutingDecision;
  phase?: 'waiting' | 'streaming' | 'complete';
  // 'skills_scope' uses `text`: the skills auto-loaded for this reply.
  // 'tools_scope' uses `text`: the toolboxes offered for this reply ('' when not narrowed). // 'fast' | 'smart' when Auto routing picked the model (step 12)
  // Request-local telemetry. Usage values are cumulative across the reply's
  // tool rounds; null means the provider did not report that measurement.
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  tokensPerSecond?: number | null;
  timeToFirstToken?: number | null;
  drafted?: number | null;
  accepted?: number | null;
}> {
  const res = await apiFetch(body.files ? '/api/diary/local-exchange' : '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({...body, ...(body.spaceId === 'diary' ? {stream:true} : {})}),
    signal,
  }).catch(error => {
    if (body.spaceId === 'diary') throw new Error('The diary connection failed. Saving is unconfirmed; check the saved diary before sending again.');
    throw error;
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    let message = '';
    try { const error = JSON.parse(detail); message = typeof error.error === 'string' ? error.error : ''; } catch { /* Proxy HTML is not a useful error. */ }
    throw new Error(message || (res.status === 524
      ? (body.spaceId === 'diary' ? 'The connection timed out. Your diary entry may still be saving; check the saved diary before sending again.' : 'The model connection timed out. Try compacting this chat or check the backend.')
      : `Chat request failed (${res.status}). Please check the connection.`));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', completed = false;
  try {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (dataLine) {
        const event = JSON.parse(dataLine.slice(6));
        if (event.type === 'done' || event.type === 'error') completed = true;
        yield event;
      }
    }
  }
  if (!completed && body.spaceId !== 'diary') throw new Error('The model connection ended before the answer completed. Partial output was preserved; compact this chat or check the backend before retrying.');
  if (!completed && body.spaceId === 'diary') throw new Error('The diary connection ended before saving was confirmed. Check the saved diary before sending again.');
  } catch (error) {
    if (body.spaceId === 'diary' && !completed) throw new Error('The diary connection ended before saving was confirmed. Check the saved diary before sending again.');
    throw error;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** #237: the tools this account could use this turn, with permission state. Cached server-side ~30s. */
export function fetchPermittedTools(projectId: string | null, mode: 'chat' | 'cowork'): Promise<{ mode: string; boxes: import('./tool-catalogue').PermittedBox[] }> {
  const q = new URLSearchParams({ mode });
  if (projectId) q.set('projectId', projectId);
  return getJson(`/api/toolboxes/permitted?${q}`);
}

/** #236: a Cowork turn. The server guards it (403 member, 409 harness off) and starts a code task. */
export async function startCowork(body: { projectId: string; chatId: string; repository: string; message: string }): Promise<{ taskId: string; branch: string; repository: string }> {
  const res = await apiFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, mode: 'cowork', spaceId: body.projectId }) });
  if (!res.ok) throw Object.assign(new Error(await describeFailure(res, 'Cowork task could not start')), { status: res.status });
  const { task } = await res.json() as { task: { taskId: string; branch: string; repository: string } };
  return task;
}
