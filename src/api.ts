// API client — all calls go through the local proxy server (same origin),
// which holds credentials server-side.

import type {
  ChatMeta,
  DiaryCorpus,
  DownloadJob,
  HealthState,
  HistoryEntry,
  InstalledModel,
  LiveStats,
  ModelVariant,
  Project,
  Provider,
  SearchHit,
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
export interface SessionInfo { id: string; createdAt: number; lastSeenAt: number; expiresAt: number; userAgent?: string | null; ip?: string | null }
export const fetchProfile = () => getJson<{ user: AuthUser; passkeys: PasskeyInfo[]; sessions?: SessionInfo[] }>('/api/profile');
export const revokeSession = (id: string) => apiFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => { if (!r.ok) throw new Error('session revoke failed'); });
export const updateProfile = (displayName: string) => apiFetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) }).then(r => { if (!r.ok) throw new Error('profile update failed'); return r.json(); });
export const updateFeatures = (diaryEnabled: boolean) => putJson<{ diaryEnabled: boolean }>('/api/profile/features', { diaryEnabled });
/** Marks the setup wizard as finished for this account (resumability gate). */
export const completeOnboarding = () => postJson<{ onboarded: boolean }>('/api/profile/onboarding', {});
export const removePasskey = (id: string) => apiFetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => r.json());
export const fetchUsers = () => getJson<{ users: AuthUser[] }>('/api/admin/users');
export const createInvitation = (role: 'admin' | 'member' = 'member') => postJson<{ token: string; expiresAt: number }>('/api/admin/invitations', { role });
export const setUserDisabled = (id: string, disabled: boolean) => putJson<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}/disabled`, { disabled });
export const createRecovery = (id: string) => postJson<{ token: string; expiresAt: number }>(`/api/admin/users/${encodeURIComponent(id)}/recovery`, {});
export const deleteUser = (id: string, username: string) => apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) }).then(r => r.json());
export interface StorageConnection { kind: 'local' | 'nextcloud' | 'webdav' | 's3'; baseUrl: string; bucket?: string; username: string; corpusRoot: string; secretConfigured?: boolean }
export const fetchStorage = () => getJson<StorageConnection>('/api/integrations/storage');
export const saveStorage = (body: StorageConnection & { secret?: string }) => putJson<StorageConnection>('/api/integrations/storage', body);
export const testStorage = (body: Partial<StorageConnection> & { secret?: string; useSaved?: boolean }) => postJson<{ ok: true }>('/api/integrations/storage/test', body);
export const startNextcloud = (baseUrl: string) => postJson<{ flowId: string; loginUrl: string; expiresAt: number }>('/api/integrations/storage/nextcloud/start', { baseUrl });
export const pollNextcloud = (flowId: string, corpusRoot: string) => postJson<StorageConnection & { pending?: boolean }>('/api/integrations/storage/nextcloud/poll', { flowId, corpusRoot });
export interface StorageEntry { name: string; path: string; isDir: boolean; size: number | null; ext: string }
export const browseStorage = (path: string) => getJson<{ entries: StorageEntry[] }>(`/api/integrations/storage/files${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}`);
export const readStorageFile = (path: string) => postJson<{ name: string; content: string; truncated: boolean }>('/api/integrations/storage/file', { path });
export const completeRecovery = (token: string, password: string) => postJson<{ ok: true }>('/api/auth/recovery/complete', { token, password });

async function getJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${url} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchWorkspace(): Promise<WorkspaceInfo> {
  return getJson('/api/workspace');
}

// ── Providers (step 9: generic OpenAI-compatible endpoints) ─────────────────

export function fetchProviders(): Promise<{ providers: Provider[] }> {
  return getJson('/api/providers');
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
  patch: Partial<Pick<Project, 'name' | 'goal' | 'instructions' | 'model' | 'memories' | 'files'>> & {
    provider?: string;
    routing?: 'manual' | 'auto';
  },
): Promise<{ ok: true }> {
  return postJson(`/api/projects/${encodeURIComponent(projectId)}/config`, patch);
}

export function fetchAutoRoles(): Promise<{ configured: boolean; roles: { fast: string; smart: string } | null }> {
  return getJson('/api/auto-roles');
}

export function setAutoRoles(roles: { fast: string; smart: string }): Promise<{ configured: boolean }> {
  return putJson('/api/auto-roles', roles);
}

export function fetchProjectChats(projectId: string): Promise<ChatMeta[]> {
  return getJson<{ chats: ChatMeta[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/chats`,
  ).then((r) => (Array.isArray(r.chats) ? r.chats : []));
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
  return getJson('/api/models/installed');
}

export function searchModels(query: string): Promise<SearchHit[]> {
  return getJson(`/api/models/search?q=${encodeURIComponent(query)}`);
}

export function fetchVariants(repo: string): Promise<ModelVariant[]> {
  return getJson(`/api/models/variants?repo=${encodeURIComponent(repo)}`);
}

export function pullModel(checkpoint: string): Promise<{ jobId: string }> {
  return postJson('/api/models/pull', { checkpoint });
}

export function deleteModel(name: string): Promise<{ ok: true }> {
  return postJson('/api/models/delete', { name });
}

export function loadModel(name: string): Promise<{ ok: true }> {
  return postJson('/api/models/load', { name });
}

export function unloadModel(name: string): Promise<{ ok: true }> {
  return postJson('/api/models/unload', { name });
}

export function fetchDownloads(): Promise<DownloadJob[]> {
  return getJson('/api/models/downloads');
}

export function fetchDiaryCorpus(): Promise<DiaryCorpus> {
  return getJson('/api/diary/today');
}

export function fetchDiarySource(): Promise<{ source: string; months: { id: string; label: string }[] }> {
  return getJson('/api/diary/source');
}

export interface ExternalSourceFile {
  name: string;
  rel_path: string;
  size: number;
  date: string | null;
  date_source: 'filename' | 'mtime' | 'unavailable';
}

export interface ExternalSourcesScan {
  configured: boolean;
  sources: {
    path: string;
    exists: boolean;
    error?: string;
    files: ExternalSourceFile[];
    total: number;
    truncated: boolean;
  }[];
  total: number;
}

export function fetchExternalSources(): Promise<ExternalSourcesScan> {
  return getJson('/api/diary/external-sources');
}

export function importExternalFile(sourcePath: string, relPath: string): Promise<{ imported: boolean; day: string }> {
  return postJson('/api/diary/external-sources/import', { sourcePath, relPath });
}

export function fetchDiaryMonth(monthId: string): Promise<DiaryCorpus> {
  return getJson(`/api/diary/today?month=${encodeURIComponent(monthId)}`);
}

export function fetchChatHistory(chatId: string): Promise<HistoryEntry[]> {
  return getJson<{ history: HistoryEntry[] }>(
    `/api/chats/${encodeURIComponent(chatId)}/history`,
  ).then((r) => (Array.isArray(r.history) ? r.history : []));
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

export function saveChatHistory(chatId: string, history: HistoryEntry[]): Promise<{ ok: true }> {
  return postJson(`/api/chats/${encodeURIComponent(chatId)}/history`, { history });
}

// Chat streams SSE events from the proxy:
//   { type:'meta', model, chatId? } { type:'reasoning', text } { type:'delta', text }
//   { type:'tool', name, args } { type:'done', model } { type:'diary', decision }
export async function* streamChat(
  body: { spaceId: string; message: string; history: HistoryEntry[]; projectId?: string | null; chatId?: string | null },
  signal?: AbortSignal,
): AsyncGenerator<{
  type: string;
  text?: string;
  model?: string;
  chatId?: string;
  name?: string;
  args?: string;
  decision?: string;
  route?: string; // 'fast' | 'smart' when Auto routing picked the model (step 12)
}> {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`chat failed: ${res.status} ${detail.slice(0, 120)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (dataLine) yield JSON.parse(dataLine.slice(6));
    }
  }
}
