import { parseUsage, parseUsers, parseProfile, parseProviders } from './settings-data';
// API client — all calls go through the local proxy server (same origin),
// which holds credentials server-side.

import type {
  ChatFrame,
  ChatGptDeviceLogin,
  ChatGptPoll,
  ChatGptStatus,
  ChatMeta,
  DiaryCorpus,
  HealthState,
  HistoryEntry,
  InstalledModel,
  LiveStats,
  ModelHistoryEntry,
  Project,
  Provider,
  ProviderCapabilities,
  Toolbox,
  WorkspaceInfo,
} from './types';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { cached, invalidateCached, clearRequestCache } from './request-cache';
import { AUTO_ROLES_KEY, INSTALLED_MODELS_KEY, MODEL_READ_TTL_MS, REASONING_KEY_PREFIX, REASONING_TTL_MS, invalidateModelReads, invalidateReasoningSettings, isModelWritePath, isReasoningWritePath } from './model-reads';
import { clearDeviceState } from './account-device-state';
import { accountBlockReason, accountChangedElsewhere } from './account-session';
import { t } from './i18n';
import { rememberSystemModels } from './model-system';
import { API_MAJOR, hasApiMajorMismatch, hasApiMajorMismatchHeader, type SkillPin } from './api-contract';
import { withPartialTurn } from './interrupted-reply';

function cookie(name: string): string {
  const item = document.cookie.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

// #422: `fetchProfile()` is called independently by every component that needs the signed-in
// user (App, Sidebar, AccountMenu, MtpControl, GeneralSettings, DiaryView, UsageView,
// SettingsShell, PluginsView…) — none of them knows the others are asking the same question on
// the same page load. `PROFILE_KEY` is the shared cache slot; see request-cache.ts for the
// in-flight/TTL mechanics and every `invalidateCached(PROFILE_KEY)` call below for the points
// that must not let a stale profile survive a change (a save, a sign-out, a dropped session).
const PROFILE_KEY = 'noevia:profile';

/** #1643: another tab changed the browser's account (this tab is reloading and sends nothing more) or is
 *  signing in right now (nothing is sent for a moment, and the page stays). `reason` tells them apart. */
export class AccountChangedError extends Error {
  readonly reason: 'changed' | 'signing-in';
  constructor() {
    const reason = accountBlockReason();
    super(t(reason === 'signing-in' ? 'account.signingInElsewhere' : 'account.changedElsewhere'));
    this.name = 'AccountChangedError';
    this.reason = reason;
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  // The cookie every request carries is already the new account's; this tab's state and drafts are not.
  if (accountChangedElsewhere()) throw new AccountChangedError();
  const headers = new Headers(init.headers);
  const method = (init.method || 'GET').toUpperCase();
  const csrf = cookie('cowork_csrf');
  if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', csrf);
  const response = await fetch(input, { ...init, headers, credentials: 'same-origin' });
  if (hasApiMajorMismatch(response)) {
    window.dispatchEvent(new Event('noevia:api-mismatch'));
    throw new Error('The noevia app and server use different API versions. Reload the page.');
  }
  if (response.status === 401) {
    // The session that the cached profile belonged to is gone — a signed-in read served from
    // cache after this point would be a different (stale) answer than the server now gives.
    clearRequestCache();
    window.dispatchEvent(new Event('cowork:unauthorized'));
  }
  // Workspace refresh callers do not all dispatch workspace-changed (project creation,
  // deletion and configuration are examples). Successful writes invalidate before callers
  // can refresh. Conservatively include other writes, which may also change workspace data.
  if (response.ok && !['GET', 'HEAD', 'OPTIONS'].includes(method)) invalidateCached(WORKSPACE_KEY);
  // #1509: a successful write under the model or effort paths drops the shared reads for them.
  if (response.ok && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const pathname = new URL(raw, 'http://noevia.invalid').pathname;
    if (isModelWritePath(pathname)) invalidateModelReads();
    if (isReasoningWritePath(pathname)) invalidateReasoningSettings();
  }
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
// #791: drafts and the last place are this account's; they do not outlive its session here.
export const logout = () => postJson<{ ok: true }>('/api/auth/logout', {}).then((v) => { clearRequestCache(); clearDeviceState(); return v; });
export const passkeyLoginOptions = (username: string) => postJson<{ options: PublicKeyCredentialRequestOptionsJSON; challengeToken: string }>('/api/auth/login/passkey/options', { username });
export const passkeyLoginVerify = (challengeToken: string, response: unknown) => postJson<{ user: AuthUser }>('/api/auth/login/passkey/verify', { challengeToken, response });
export const passkeyRegistrationOptions = () => postJson<{ options: PublicKeyCredentialCreationOptionsJSON; challengeToken: string }>('/api/auth/passkeys/register/options', {});
export const passkeyRegistrationVerify = (challengeToken: string, response: unknown, name: string) => postJson<{ verified: boolean }>('/api/auth/passkeys/register/verify', { challengeToken, response, name }).then(v => { invalidateCached(PROFILE_KEY); return v; });
export const acceptInvitation = (body: { token: string; username: string; displayName: string; password: string; diaryEnabled: boolean }) => postJson<{ user: AuthUser }>('/api/auth/invitations/accept', body);
export interface PasskeyInfo { id: string; name: string; deviceType: string; backedUp: boolean; createdAt: number; lastUsedAt?: number | null }
export interface SessionInfo { id: string; createdAt: number; lastSeenAt: number; expiresAt: number; userAgent?: string | null; ip?: string | null;
  /** #404: whether this row is the session the request that fetched the list was made with —
   *  "this device" versus every other signed-in session — not a liveness check. */
  current?: boolean }
export const fetchProfile = () => cached(PROFILE_KEY, () => getJson<unknown>('/api/profile').then(parseProfile));
export const revokeSession = (id: string) => apiFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => { if (!r.ok) throw new Error('session revoke failed'); invalidateCached(PROFILE_KEY); });
export const updateProfile = (displayName: string) => apiFetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) }).then(r => { if (!r.ok) throw new Error('profile update failed'); return r.json(); }).then(v => { invalidateCached(PROFILE_KEY); return v; });
export const updateFeatures = (diaryEnabled: boolean) => putJson<{ diaryEnabled: boolean }>('/api/profile/features', { diaryEnabled }).then(v => { invalidateCached(PROFILE_KEY); return v; });
/** Marks the setup wizard as finished for this account (resumability gate). */
export const completeOnboarding = () => postJson<{ onboarded: boolean }>('/api/profile/onboarding', {}).then(v => { invalidateCached(PROFILE_KEY); return v; });
// #863: a 409 is the server refusing to delete the account's last sign-in method. Its reason is
// written for the user, so it travels on the error as `userMessage` for the caller to show as is.
export const removePasskey = (id: string) => apiFetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(async r => {
  if (!r.ok) {
    const reason = r.status === 409 ? (await r.json().catch(() => ({})) as { error?: unknown }).error : undefined;
    throw Object.assign(new Error('Passkey could not be removed'), typeof reason === 'string' && reason ? { userMessage: reason } : {});
  }
  return r.json();
}).then(v => { invalidateCached(PROFILE_KEY); return v; });
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
/** #770: the server checks a WebDAV/Nextcloud login before saving. A rejected login throws an
 *  error carrying `code: 'storageLoginRejected'`; an unreachable server saves with `warningCode`. */
export type StorageSaveResult = StorageConnection & { warning?: string; warningCode?: 'storageUnverified' | 'storageThrottled'; status?: number; reason?: 'redirect' | 'timeout' | 'network'; retryAfter?: number };
export async function saveStorage(body: StorageConnection & { secret?: string }): Promise<StorageSaveResult> {
  const res = await apiFetch('/api/integrations/storage', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let payload: { error?: string; code?: string } = {};
    try { payload = await res.clone().json(); } catch { /* not JSON */ }
    const err = new Error(payload.error || await describeFailure(res, 'PUT /api/integrations/storage failed')) as Error & { code?: string };
    if (payload.code) err.code = payload.code;
    throw err;
  }
  return res.json() as Promise<StorageSaveResult>;
}
export const testStorage = (body: Partial<StorageConnection> & { secret?: string; useSavedSecret?: boolean }) => postJson<{ ok: true }>('/api/integrations/storage/test', body);
/** #1427: a Nextcloud sign-in failure keeps the server's `code` (nextcloudUnreachable, nextcloudNotFound,
 *  nextcloudThrottled, nextcloudHttpsRequired, nextcloudFlowExpired, storageLoginRejected) plus
 *  `reason` and `retryAfter`, so the screen can say what actually happened. */
export type NextcloudError = Error & { code?: string; reason?: string; retryAfter?: number };
async function nextcloudCall<T>(url: string, body: unknown): Promise<T> {
  const res = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // Not postJson: its 202 means "a source job to poll", while here 202 means "not approved yet".
  if (res.status === 202) return { pending: true } as T;
  if (!res.ok) {
    let payload: { error?: string; code?: string; reason?: string; retryAfter?: number } = {};
    try { payload = await res.clone().json(); } catch { /* not JSON */ }
    const err = failureWithCode(payload.error || await describeFailure(res, `POST ${url} failed`), payload.code) as NextcloudError;
    if (typeof payload.reason === 'string') err.reason = payload.reason;
    if (typeof payload.retryAfter === 'number') err.retryAfter = payload.retryAfter;
    throw err;
  }
  return res.json() as Promise<T>;
}
export const startNextcloud = (baseUrl: string) => nextcloudCall<{ flowId: string; loginUrl: string; expiresAt: number }>('/api/integrations/storage/nextcloud/start', { baseUrl });
/** #1433: ends the sign-in on the server too, so a poll already in flight revokes instead of saving. */
export const cancelNextcloud = (flowId: string) => nextcloudCall<{ cancelled: boolean }>('/api/integrations/storage/nextcloud/cancel', { flowId });
/** An empty corpusRoot keeps the folder already saved (the server falls back to it, then to Cowork/Diary). */
export const pollNextcloud = (flowId: string, corpusRoot: string) => nextcloudCall<StorageSaveResult & { pending?: boolean }>('/api/integrations/storage/nextcloud/poll', { flowId, corpusRoot });
export interface StorageEntry { name: string; path: string; isDir: boolean; size: number | null; ext: string }
export const browseStorage = (path: string) => getJson<{ entries: StorageEntry[] }>(`/api/integrations/storage/files${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}`);
export const deleteProjectImage = (id: string, assetId: string) =>
  apiFetch(`/api/projects/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' })
    .then((r) => { if (!r.ok) throw new Error('could not remove that image'); });

export const projectImageUrl = (id: string, assetId: string) =>
  `/api/projects/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`;

/** An Error that keeps the server's stable `code` (#849: `storageLoginRejected`), so the screen can word it
 *  in the interface language instead of showing the server's English sentence. */
function failureWithCode(message: string, code: unknown, status?: number): Error & { code?: string; status?: number } {
  const err = new Error(message) as Error & { code?: string; status?: number };
  if (typeof code === 'string') err.code = code;
  if (typeof status === 'number') err.status = status;
  return err;
}

/** Upload a source file into the project's own storage folder. */
/** `stageKey` names a stage this client words itself, so the screen shows it in the interface language
 *  (uploadStageText); `stage` stays the English fallback, and the only text for a stage the server words. */
export type UploadStageKey = 'busy' | 'sending' | 'received' | 'queued' | 'saved';
export interface UploadProgress { stage: string; stageKey?: UploadStageKey; percent?: number }
/** One source upload. A folder import's file (#1805) also carries its path inside the folder and the
 *  import id its plan answered; the server refuses a path that plan did not accept. */
export interface SourceUploadBody { name: string; dataBase64: string; relativePath?: string; importId?: string }

/** #1805: what a folder import will do, before anything is uploaded. */
export interface FolderImportPlan {
  importId: string;
  limits: { maxFiles: number; maxBytes: number; projectSources: number; projectDocuments: number; projectImages: number };
  accepted: { path: string; size: number; change: 'new' | 'changed' }[];
  unchanged: { path: string }[];
  skipped: { path: string; code: string; reason: string; max?: number }[];
}
export const planFolderImport = (id: string, entries: { path: string; size: number; sha256?: string }[]) =>
  postJson<FolderImportPlan>(`/api/projects/${encodeURIComponent(id)}/folder-import/plan`, { entries });

/** #1451: the server runs at most two source jobs per account at once and answers 429 to a third. That
 *  answer comes before any job exists, so sending the same file again is safe. Waits between tries. */
const BUSY_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
/** One upload POST (the file is accepted and a job is started, or the server refuses it outright). */
function postSourceUpload(id: string, body: SourceUploadBody, progress: (value: UploadProgress) => void): Promise<{ poll: string }> {
  return new Promise<{ poll: string }>((resolve, reject) => {
    if (accountChangedElsewhere()) { reject(new AccountChangedError()); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/projects/${encodeURIComponent(id)}/upload?background=1`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    const csrf = cookie('cowork_csrf');
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.timeout = 120000;
    xhr.upload.onprogress = e => progress({ stage: 'Sending file', stageKey: 'sending', percent: e.lengthComputable ? Math.round(100 * e.loaded / e.total) : undefined });
    xhr.onerror = () => reject(new Error('Upload connection failed; retry.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out; retry.'));
    xhr.onload = () => {
      if (hasApiMajorMismatchHeader(xhr.getResponseHeader?.('X-Noevia-API') ?? null, xhr.status)) {
        window.dispatchEvent(new Event('noevia:api-mismatch'));
        reject(new Error(`The noevia app requires API ${API_MAJOR}. Reload the page.`));
        return;
      }
      if (xhr.status === 401) { clearRequestCache(); window.dispatchEvent(new Event('cowork:unauthorized')); }
      try { const value = JSON.parse(xhr.responseText); if (xhr.status >= 400) reject(failureWithCode(value.error || 'Upload failed', value.code, xhr.status)); else resolve(value); }
      catch { reject(new Error('Invalid upload response')); }
    };
    xhr.send(JSON.stringify({ ...body, organized: true }));
  });
}

/** #1451: a busy answer (429) is retried a bounded number of times, with a stage line saying so. Any
 *  other failure, or a busy answer after the last retry, is thrown as it was. `used` counts the retries
 *  already spent on this file (a job that ended busy spends from the same budget, #2245). */
async function postSourceUploadWithBusyRetry(id: string, body: SourceUploadBody, progress: (value: UploadProgress) => void, used: { n: number }): Promise<{ poll: string }> {
  for (;;) {
    try { return await postSourceUpload(id, body, progress); }
    catch (err) {
      if ((err as { status?: number }).status !== 429 || used.n >= BUSY_RETRY_DELAYS_MS.length) throw err;
      await waitForBusy(progress, used);
    }
  }
}
async function waitForBusy(progress: (value: UploadProgress) => void, used: { n: number }) {
  progress({ stage: 'Waiting for another file to finish processing', stageKey: 'busy' });
  await new Promise<void>(resolve => setTimeout(resolve, BUSY_RETRY_DELAYS_MS[used.n++]));
}

export async function uploadProjectFile(id: string, body: SourceUploadBody, progress: (value: UploadProgress) => void = () => {}) {
  // #2245: the job itself can end 429 ("another upload or sync of this project is still running; try again
  // shortly"): it did nothing, so the file is sent again, within the same bounded budget as a busy answer.
  const used = { n: 0 };
  for (;;) {
    const response = await postSourceUploadWithBusyRetry(id, body, progress, used);
    progress({ stage: 'Upload received · waiting for processing', stageKey: 'received' });
    for (;;) {
      const job = await getJson<{ done: boolean; stage?: string; status?: number; body?: { error?: string; code?: string; name: string; path: string; bytes: number; unchanged?: boolean; attachment?: { reduction?: { note: string }; assetId?: string; state?: string; group?: string; reason?: string; reasonId?: string; reasonParams?: Record<string, string | number> }; document?: { state?: string; error?: string; errorId?: string } } }>(response.poll);
      if (job.done) {
        if (job.status === 429 && used.n < BUSY_RETRY_DELAYS_MS.length) { await waitForBusy(progress, used); break; }
        if ((job.status || 500) >= 400) throw failureWithCode(job.body?.error || 'Source processing failed', job.body?.code);
        invalidateCached(WORKSPACE_KEY);
        progress({ stage: 'Saved', stageKey: 'saved', percent: 100 }); return job.body!;
      }
      progress(job.stage ? { stage: job.stage } : { stage: 'Queued for processing', stageKey: 'queued' });
      await new Promise(resolve => setTimeout(resolve, 750));
    }
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

/** Re-read every attached folder and refresh the project's sources from it. `storageRetry` is set only
 *  by the person's own "Refresh from storage" press (#1428/#1429, the Diary's X-Cowork-Storage-Retry
 *  contract): the server may then try storage again at once. Automatic refreshes never send it. */
export const syncProjectSources = (id: string, options: { storageRetry?: boolean } = {}) =>
  postJson<{ files: { name: string; source: string | null; bytes: number }[]; skipped: { folder: string; file?: string; reason: string; code?: string; retained?: boolean }[] }>(
    `/api/projects/${encodeURIComponent(id)}/sources/sync?background=1`, {},
    options.storageRetry ? { [STORAGE_RETRY_HEADER]: '1' } : {});
/** Create one directory in connected storage. */
export const createStorageFolder = (path: string) =>
  postJson<{ path: string; existed: boolean }>('/api/integrations/storage/folder', { path });
export const readStorageFile = (path: string) => postJson<{ name: string; content: string; truncated: boolean }>('/api/integrations/storage/file', { path });
export const completeRecovery = (token: string, password: string) => postJson<{ ok: true }>('/api/auth/recovery/complete', { token, password });

/** Prefer the server's own {error} message over a bare status code — the
 *  server already explains *why* (e.g. "origin not allowed", "invalid CSRF
 *  token"), and swallowing that forced users to guess from a status code alone. */
/** The error for a failed request: the server's message, and its stable `code` when it sent one (#1428). */
async function failureFromResponse(res: Response, fallback: string): Promise<Error & { code?: string }> {
  const payload = await res.clone().json().catch(() => null) as { error?: unknown; code?: unknown } | null;
  return failureWithCode(typeof payload?.error === 'string' && payload.error ? payload.error : `${fallback}: ${res.status}`, payload?.code);
}

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
  // Keeps the server's stable `code` (#2232: `diaryUnavailable`) so the screen can word it itself.
  if (!res.ok) throw await failureFromResponse(res, `GET ${url} failed`);
  return res.json() as Promise<T>;
}

/** The explicit-retry header (#1168, #1428): the same name diary-workspace.ts sends. */
const STORAGE_RETRY_HEADER = 'X-Cowork-Storage-Retry';
async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failureFromResponse(res, `POST ${url} failed`);
  if (res.status === 202) {
    const { poll } = await res.json() as { poll: string };
    // Source processing can outlive a proxy request. Each poll is short and authenticated.
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const job = await getJson<{ done: boolean; status?: number; body?: T & { error?: string; code?: string } }>(poll);
      if (!job.done) continue;
      if ((job.status || 500) >= 400) throw failureWithCode(job.body?.error || 'Source processing failed', job.body?.code);
      invalidateCached(WORKSPACE_KEY);
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

// Share the App and Archived-view mount reads. Successful API writes and explicit
// workspace-changed notifications invalidate this slot before subsequent refreshes.
export const WORKSPACE_KEY = 'noevia:workspace';
export function fetchWorkspace(): Promise<WorkspaceInfo> {
  return cached(WORKSPACE_KEY, () => getJson('/api/workspace'));
}

// ── Providers (step 9: generic OpenAI-compatible endpoints) ─────────────────

export function fetchProviders(): Promise<{ providers: Provider[] }> {
  return getJson<unknown>('/api/providers').then(parseProviders);
}

export function createProvider(body: { label: string; baseUrl: string; apiKey?: string; defaultModel?: string; shared?: boolean; contextTokens?: number | null; capabilities?: ProviderCapabilities }): Promise<Provider> {
  return postJson('/api/providers', body);
}
/** Edit in place (#535). Leave `apiKey` out to keep the stored key; `contextTokens: null` clears it. */
export function updateProvider(id: string, body: { label: string; baseUrl: string; apiKey?: string; defaultModel: string; contextTokens: number | null }): Promise<Provider> {
  return putJson(`/api/providers/${encodeURIComponent(id)}`, body);
}
/** `providerId` lets the server probe with that provider's stored key (same origin only) when none is typed. */
export function testProvider(body: { baseUrl: string; apiKey?: string; providerId?: string }): Promise<{ ok: true; models: string[] }> { return postJson('/api/providers/test', body); }

// Sign in with ChatGPT (#447). The server answers 404 on all of these while the feature is off.
export const fetchChatGptStatus = (): Promise<ChatGptStatus> => getJson('/api/providers/chatgpt');
export const startChatGptLogin = (): Promise<ChatGptDeviceLogin> => postJson('/api/providers/chatgpt/device', {});
export const pollChatGptLogin = (loginId: string): Promise<ChatGptPoll> => postJson('/api/providers/chatgpt/device/poll', { loginId });
export const cancelChatGptLogin = (loginId: string): Promise<{ ok: boolean }> => postJson('/api/providers/chatgpt/device/cancel', { loginId });
// #1862: the Routing tab shows this list twice (the connection note and the cloud model pickers); both ask through one
// shared read, so opening it makes one request. An explicit refresh drops it.
const CHATGPT_MODELS_KEY = 'chatgpt:models';
export const fetchChatGptModels = (): Promise<{ models: string[]; cached?: boolean; fetchedAt?: number }> => cached(CHATGPT_MODELS_KEY, () => getJson('/api/providers/chatgpt/models'));
/** An explicit "Refresh models" (#1306): asks the server to re-read the account's catalogue. The server allows one
 *  refresh per 10 s and answers `throttled: true` (with the cached list) or 429 when it has nothing to serve. */
export async function refreshChatGptModels(): Promise<{ models: string[]; throttled: boolean }> {
  invalidateCached(CHATGPT_MODELS_KEY);
  const res = await apiFetch('/api/providers/chatgpt/models?refresh=1');
  if (res.status === 429) return { models: [], throttled: true };
  if (!res.ok) throw new Error(await describeFailure(res, 'Refreshing the ChatGPT model list failed'));
  const r = await res.json() as { models?: unknown; throttled?: unknown };
  return { models: Array.isArray(r.models) ? r.models.filter((m): m is string => typeof m === 'string') : [], throttled: r.throttled === true };
}
export async function disconnectChatGpt(): Promise<{ ok: boolean }> {
  const res = await apiFetch('/api/providers/chatgpt', { method: 'DELETE' });
  if (!res.ok) throw new Error(await describeFailure(res, 'Disconnecting ChatGPT failed'));
  return res.json() as Promise<{ ok: boolean }>;
}

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
  /** #1522: a new project is created Automatic; the server stores it as toolsMode. */
  toolsMode?: 'auto' | 'manual';
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
    /** #1006: tools picked automatically or by hand from `toolboxes`. */
    toolsMode?: 'auto' | 'manual';
    /** #1007: this chat's or project's own routing mode; null follows the account's. */
    routingMode?: ProjectRoutingMode | null;
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

/** #778: answer a routing question (Send to cloud / Keep local). Same route and owner check as
 *  the write approvals; the server refuses a write answer here and a routing answer there. */
export function decideRoute(id: string, decision: 'cloud' | 'local', remember: boolean): Promise<{ ok: true }> {
  return postJson(`/api/tool-approvals/${encodeURIComponent(id)}`, { decision, remember });
}

export interface RoutingModeSettings {
  enabled: boolean;
  /** The mode replies actually use (#779 F5): a mode an administrator disallowed reads as 'local'. */
  mode?: 'local' | 'cloud' | 'hybrid' | null;
  /** The account's own saved choice, which the settings form edits. */
  storedMode?: 'local' | 'cloud' | 'hybrid' | null;
  whenSensitive?: 'ask' | 'local';
  cloud?: { providerId: string; fast: string; smart: string; code: string };
  allowed?: ('local' | 'cloud' | 'hybrid')[];
  admin?: boolean;
}

export async function fetchRoutingMode(): Promise<RoutingModeSettings> {
  const r = await apiFetch('/api/routing-mode');
  if (!r.ok) throw new Error(`routing mode ${r.status}`);
  return r.json();
}

export async function saveRoutingMode(body: { mode: RoutingModeSettings['mode']; whenSensitive: 'ask' | 'local'; cloud: NonNullable<RoutingModeSettings['cloud']> }): Promise<RoutingModeSettings> {
  return putJson('/api/routing-mode', body);
}

export type RoutingModeId = 'local' | 'cloud' | 'hybrid';
/** #1007: a chat's or project's own routing mode (the cloud provider and models stay the account's). */
export interface ProjectRoutingMode { mode: RoutingModeId; whenSensitive: 'ask' | 'local' }

/** #1009: a stored provider's model ids, fetched and cached by the server with the stored key.
 *  `refresh` skips the server's cache. The key itself never reaches the browser. */
export async function fetchProviderModels(providerId: string, refresh = false): Promise<{ models: string[]; cached?: boolean; fetchedAt?: number; throttled?: boolean }> {
  // #1862: the ChatGPT connection's plain list is the one shared read above, not a second request for the same data.
  if (!refresh && providerId === 'chatgpt-oauth') { const r = await fetchChatGptModels(); return { models: Array.isArray(r.models) ? r.models.filter((m): m is string => typeof m === 'string') : [], cached: r.cached, fetchedAt: r.fetchedAt }; }
  if (refresh && providerId === 'chatgpt-oauth') invalidateCached(CHATGPT_MODELS_KEY);
  const r = await apiFetch(`/api/providers/${encodeURIComponent(providerId)}/models${refresh ? '?refresh=1' : ''}`);
  const body = await r.json().catch(() => ({})) as { models?: unknown; cached?: boolean; fetchedAt?: number; error?: string; throttled?: unknown };
  // #1857: a refresh pressed again within the server's window is "wait", not a failure (as for the model popup, #1306).
  if (refresh && r.status === 429) return { models: [], throttled: true };
  if (!r.ok) throw new Error(body.error || `provider models ${r.status}`);
  return { models: Array.isArray(body.models) ? body.models.filter((m): m is string => typeof m === 'string') : [], cached: body.cached, fetchedAt: body.fetchedAt, ...(body.throttled === true ? { throttled: true } : {}) };
}

export async function saveAllowedRoutingModes(allowed: ('local' | 'cloud' | 'hybrid')[]): Promise<{ allowed: ('local' | 'cloud' | 'hybrid')[] }> {
  return putJson('/api/routing-mode/allowed', { allowed });
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
  /** A directory server's display name (#887). Absent for servers configured by the operator. */
  title?: string;
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

export interface AutoRoles { fast: string; smart: string; vision?: string; code?: string; creative?: string }

/** #1849: a model a chat role's Inference machine serves; a Manual pick of it runs on that machine. */
export interface MachineModel { model: string; machine: { id: string; name: string }; roles: string[] }

export function fetchAutoRoles(): Promise<{ configured: boolean; roles: AutoRoles | null; missing?: { role: 'fast' | 'smart' | 'vision' | 'code' | 'creative'; model: string }[]; machineModels?: MachineModel[] }> {
  // #1509: shared in flight and for MODEL_READ_TTL_MS; setAutoRoles and model writes drop it.
  return cached(AUTO_ROLES_KEY, () => getJson('/api/auto-roles'), MODEL_READ_TTL_MS);
}

export const fetchRoutingDefault = () => getJson<{ routing: 'auto' | 'manual' }>('/api/routing-default');
export const putRoutingDefault = (routing: 'auto' | 'manual', applyToExisting = false) =>
  putJson<{ routing: 'auto' | 'manual'; updated: number }>('/api/routing-default', { routing, applyToExisting });

export function setAutoRoles(roles: AutoRoles): Promise<{ configured: boolean }> {
  return putJson<{ configured: boolean }>('/api/auto-roles', roles).then(v => { invalidateModelReads(); return v; });
}

/** A whole-list chat save; `skipped` lists ids another list holds, which were not saved (#765). */
export type ListSaveResult = { ok: true; skipped?: string[] };

export function saveProjectChats(projectId: string, chats: ChatMeta[]): Promise<ListSaveResult> {
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
  // #1509/#1461: the list is shared in flight and for MODEL_READ_TTL_MS, so the chat, Settings and Diary
  // do not each wait on their own copy of the same slow model-manager read.
  return cached(INSTALLED_MODELS_KEY, () => getJson<InstalledModel[]>('/api/models/installed').then(rows => {
    if(!Array.isArray(rows) || rows.some(row=>!row || typeof row.name!=='string' || !Array.isArray(row.labels) || row.labels.some(label=>typeof label!=='string')))throw new Error('Model list was invalid. Try loading it again.');
    // #1179: the explicit system kind (Laya, marked in models.roles.json) for isSystemModel.
    rememberSystemModels(rows);
    return rows;
  }), MODEL_READ_TTL_MS);
}

/** #1509: the effort settings for the deployment (no project) or one project, shared in flight. */
export function fetchReasoningSettings(projectId?: string | null): Promise<{ default: string; effort: string; mode: string; admin: boolean }> {
  return cached(REASONING_KEY_PREFIX + (projectId || ''), () => getJson('/api/reasoning-settings' + (projectId ? '?projectId=' + encodeURIComponent(projectId) : '')), REASONING_TTL_MS);
}

export function fetchDiarySource(): Promise<{ source: string; months: { id: string; label: string }[] }> {
  return getJson('/api/diary/source');
}

export function fetchDiaryMonth(monthId: string): Promise<DiaryCorpus> {
  return getJson(`/api/diary/today?month=${encodeURIComponent(monthId)}`);
}

export const fetchUsage = (aggregate=false) => getJson<unknown>(aggregate?'/api/usage/aggregate':'/api/usage').then(parseUsage);

/** #1450: the chat ids whose message text holds `text` (titles are matched in the sidebar itself). */
export function searchChatText(text: string): Promise<{ chats: string[]; truncated: boolean }> {
  return getJson<{ chats: string[]; truncated: boolean }>(`/api/chats/search?q=${encodeURIComponent(text)}`).then((r) => ({
    chats: Array.isArray(r.chats) ? r.chats.filter((id): id is string => typeof id === 'string') : [],
    truncated: r.truncated === true,
  }));
}

export function fetchChatHistoryRevision(chatId: string): Promise<{ history: HistoryEntry[]; revision: string | null }> {
  // #1507: core sends a reply it kept partway as `partial` beside `history` (already marked interrupted);
  // it is added here as the chat's last turn, so the rest of the client reads one transcript.
  return getJson<{ history: HistoryEntry[]; revision?: string; partial?: HistoryEntry }>(
    `/api/chats/${encodeURIComponent(chatId)}/history`,
  ).then((r) => ({
    history: withPartialTurn(Array.isArray(r.history) ? r.history : [], r.partial),
    revision: typeof r.revision === 'string' ? r.revision : null,
  }));
}

// ── Free (non-project) chats — server-side metas so they survive browsers ──

export function saveFreeChats(chats: ChatMeta[]): Promise<ListSaveResult> {
  return postJson('/api/freechats', { chats });
}

export function deleteFreeChat(chatId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/freechats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }).then((r) => {
    if (!r.ok) throw new Error(`delete failed: ${r.status}`);
    return { ok: true } as const;
  });
}

// ── Chat framing (#737/#738) ─────────────────────────────────────────────

/** A suggested frame for a new chat, or null (flag off, no decision service, a miss). Never throws. */
export function suggestChatFrame(message: string, chatId: string): Promise<ChatFrame | null> {
  return postJson<{ frame?: ChatFrame | null }>('/api/chat-framing/suggest', { message, chatId })
    .then((r) => (r && r.frame && typeof r.frame === 'object' ? r.frame : null))
    .catch(() => null);
}

/** Move a chat between the caller's own lists (free = null), optionally saving its frame with it. */
export function moveChatToProject(chatId: string, projectId: string | null, frame?: ChatFrame | null): Promise<{ ok: true; from: string | null }> {
  return postJson(`/api/chats/${encodeURIComponent(chatId)}/move`, frame === undefined ? { projectId } : { projectId, frame });
}

export interface FramingPreferences { autoAccept: boolean; keepReasoningTraces: boolean }
export const fetchFramingPreferences = () => getJson<FramingPreferences>('/api/chat-framing/preferences')
  .then((r) => ({ autoAccept: r?.autoAccept === true, keepReasoningTraces: r?.keepReasoningTraces === true }));
/** A partial update: keys not given keep their saved value (#740). */
export const saveFramingPreferences = (prefs: Partial<FramingPreferences>) => putJson<FramingPreferences>('/api/chat-framing/preferences', prefs);
/** #741: "Mirror chats to Diary", the person's own switch (off by default). `available` is false
 *  without the Diary add-on or the chatFraming feature; the choice is kept either way. */
export type VaultMirrorPreferences = { enabled: boolean; available: boolean };
export const fetchVaultMirrorPreferences = () => getJson<VaultMirrorPreferences>('/api/chat-vault-mirror/preferences')
  .then((r) => ({ enabled: r?.enabled === true, available: r?.available === true }));
export const saveVaultMirrorPreferences = (prefs: { enabled: boolean }) => putJson<VaultMirrorPreferences>('/api/chat-vault-mirror/preferences', prefs);

export type HistorySave = { ok: true; revision: string | null } | { ok: false; conflict: { history: HistoryEntry[]; revision: string } };
/** Save a transcript. With a base revision, a concurrent save elsewhere returns the current copy to merge. */
/** The longest wait a busy (503) history save is retried after, whatever Retry-After asks. */
export const HISTORY_SAVE_RETRY_CAP_MS = 10_000;

/** Retry-After (delta seconds) as a wait in ms, capped; 1 s when absent or not a number. */
export function historySaveRetryDelay(header: string | null): number {
  const seconds = Number(header);
  const ms = header !== null && header.trim() !== '' && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000;
  return Math.min(ms, HISTORY_SAVE_RETRY_CAP_MS);
}

export async function saveChatHistory(chatId: string, history: HistoryEntry[], baseRevision?: string | null): Promise<HistorySave> {
  const post = () => apiFetch(`/api/chats/${encodeURIComponent(chatId)}/history`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(baseRevision ? { history, baseRevision } : { history }),
  });
  let res = await post();
  // The transcript store is busy (lock wait, restart): nothing was written, so one retry after
  // the wait the server asks for (capped) is safe. A second refusal is thrown to the caller.
  if (res.status === 503) {
    await new Promise((resolve) => setTimeout(resolve, historySaveRetryDelay(res.headers.get('Retry-After'))));
    res = await post();
  }
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
//   { type:'tool_pending', id, index, name, args, target? } — a WRITE tool is waiting
//     for the user. The stream stays open and nothing runs until a decision is
//     posted to /api/tool-approvals/:id. `target` is the resolved project file
//     an edit would change (#648).
//   { type:'tool_result', index, name, text, applied?, target? } — `applied`: a write that ran
//     and succeeded (#658)
//   { type:'paused', reason:'supervision', applied, text } — the reply ends here, normally, after
//     tool steps that finished; `applied` changes were saved (#658). Followed by 'done'.
//   { type:'paused', reason:'declined', applied, declined, text } — the person declined a write,
//     so the model is not asked for more text; `declined` names those tools (#666).
//   { type:'done', model } { type:'diary', decision }
//   { type:'telemetry', phase, model?, timeToFirstToken? }
//   { type:'usage', cumulative prompt/completion/total tokens, provider rate,
//     first-token time and optional MTP accepted/drafted counts }
export async function* streamChat(
  body: { spaceId: string; compactOnly?: boolean; extrasEnabled?: boolean; extraContext?: string;
    exchangeId?: string; recoveryId?: string; preparationId?: string; files?: Record<string,string>; entryTime?: string; entryDay?: string; sessionId?: string; message: string; history: ModelHistoryEntry[]; projectId?: string | null; chatId?: string | null;
    /** #236/#237: the session's harness, and boxes added for this turn only. */
    mode?: 'chat'; turnToolboxes?: string[];
    /** #1512: the project image sources this message attaches. Always sent (`[]` when none), so the
     *  server describes only these and a text-only turn does no vision work. */
    turnImageIds?: string[];
    /** #272: one exact reviewed Skill version for this message, as `skill_<id>@<sha256>`. */
    skill?: SkillPin;
    /** #682: this turn re-runs the last one (text-free outcome record). */
    resend?: import('./regenerate').ResendOutcome },
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
  /** 'status' (#1449): for a 'loadingModel' status, the model being loaded, its routed role and the expected wait. */
  detail?: unknown;
  /** 'tool_pending' (#648): the full stored path of the project file an edit would change; for a
   *  Google Drive write (#659) the Drive file's name and id. 'tool_result': the same, once it ran. */
  target?: string;
  /** 'tool_pending' (#659): 'drive' or 'drive-new' when `target` is a Google Drive file. */
  targetKind?: string;
  /** 'tool_pending' (#658): the same change as one already saved in this chat. */
  repeatOf?: boolean;
  /** 'tool_pending' (#769): sensitive arguments holding untrusted text; asked per call. */
  provenance?: unknown;
  /** 'tool_pending' (#865/#887): the id of the MCP server the call goes to. */
  server?: string;
  /** 'tool_result' (#658): a write that ran and succeeded. 'paused': how many changes were saved. */
  applied?: boolean | number;
  /** 'paused' (#658): why the reply ended before a final answer ('supervision' or, #666, 'declined'). */
  reason?: string;
  /** 'paused' with reason 'declined' (#666): the tools the person declined. 'tool_result': true when
   *  the call was not approved (declined or timed out), set by the server, never read from text. */
  declined?: string[] | boolean;
  /** 'tool_result' (#666 review): a write skipped because an earlier one in the reply was declined. */
  notRun?: boolean;
  /** 'tool_result' (#1700): the tool is positively public (search, Wikipedia). */
  public?: boolean;
  decision?: string;
  reasoning?: string;
  reasoningEffort?: string;
  route?: string;
  routingDecision?: import('./types').RoutingDecision;
  /** 'sources' (#552): the project passages placed in the prompt. */
  sources?: import('./types').SourceRef[];
  /** 'tools_scope' (#624): the same toolboxes as `text`, by stable id. */
  boxes?: { id: string; label: string; inApp?: boolean }[];
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
  /** 'error' on the Diary stream (#1422): a stable cause the screen words itself, `saved: false` when the
   *  server knows nothing was written, and `retryAfter` seconds for a storage throttle. */
  code?: string;
  saved?: boolean;
  retryAfter?: number;
  /** #778 'meta': where the reply went and why. */
  routing?: { route: string; reason: string; detail?: string };
  /** #778 'route_pending': why the turn looks sensitive. `id` is the question to answer. */
  flag?: string;
  /** #778 'route_remembered': the chat's routing flags the server just saved. */
  forceLocal?: boolean;
  allowCloud?: boolean;
  /** #1785 'title': a short title the local model gave the chat after its first reply. */
  title?: string;
}> {
  const send = () => apiFetch(body.files ? '/api/diary/local-exchange' : '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({...body, ...(body.spaceId === 'diary' ? {stream:true} : {})}),
    signal,
  }).catch(error => {
    if (body.spaceId === 'diary') throw new Error('The diary connection failed. Saving is unconfirmed; check the saved diary before sending again.');
    throw error;
  });
  let res = await send();
  // #1896: the server answers a retryable 503 (code inferenceMaintenance) while the engine is still busy with the
  // previous reply or a short maintenance step, after waiting a few seconds itself. Retry once, quietly.
  let retryableBusy = false;
  if (res.status === 503 && !body.files && body.spaceId !== 'diary') {
    const parsed = await readChatRefusal(res.clone());
    retryableBusy = parsed.retryable;
    if (retryableBusy && !signal?.aborted) {
      await abortableDelay(Math.min(Math.max(parsed.retryAfter, 1), 3) * 1000, signal);
      res = await send();
      retryableBusy = res.status === 503;
    }
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    let message = '', code: string | undefined;
    try { const error = JSON.parse(detail); message = typeof error.error === 'string' ? error.error : ''; if (typeof error.code === 'string') code = error.code; } catch { /* Proxy HTML is not a useful error. */ }
    // Still refused after the one retry: say what is going on instead of a bare failure (the reason is the server's own text).
    if (retryableBusy) throw new Error(`${t('chat.failure.stillFinishing')}${message ? ` (${message})` : ''}`);
    // A coded refusal keeps its code (#2232: `diaryUnavailable`); the Diary exchange is a write, so a timeout is not "nothing saved".
    if (code) throw Object.assign(new Error(message), { code, write: !!body.files });
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
  if (!completed && body.spaceId !== 'diary') throw new Error('The model connection ended before the answer completed. Compact this chat or check the backend before retrying.');
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
  return getPermitted(`/api/toolboxes/permitted?${q}`);
}

/** #2211: the 503 "The tool list is being prepared" (with Retry-After, toolbox_routes.rs) is not a failure: the list is not ready yet. */
export class ToolsPreparingError extends Error {
  constructor(message: string, readonly retryAfterMs: number) { super(message); this.name = 'ToolsPreparingError'; }
}
async function getPermitted<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  // Only the "being prepared" answer carries Retry-After; the 503 "tool permissions could not be read" does not, and is a failure to show.
  if (res.status === 503 && res.headers.get('Retry-After') !== null) throw new ToolsPreparingError(await describeFailure(res, `GET ${url} failed`), historySaveRetryDelay(res.headers.get('Retry-After')));
  if (!res.ok) throw new Error(await describeFailure(res, `GET ${url} failed`));
  return res.json() as Promise<T>;
}

/** #236: a Cowork turn. The server guards it (403 member, 409 harness off) and starts a code task. */
export async function startCowork(body: { projectId: string; chatId: string; repository: string; message: string }): Promise<{ taskId: string; branch: string; repository: string }> {
  const res = await apiFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, mode: 'cowork', spaceId: body.projectId }) });
  if (!res.ok) throw Object.assign(new Error(await describeFailure(res, 'Cowork task could not start')), { status: res.status });
  const { task } = await res.json() as { task: { taskId: string; branch: string; repository: string } };
  return task;
}

/** #1896: whether a 503 from /api/chat is the server's retryable "still busy" refusal, and how long it suggests waiting. */
async function readChatRefusal(res: Response): Promise<{ retryable: boolean; retryAfter: number }> {
  try {
    const j = JSON.parse(await res.text());
    return { retryable: j?.retryable === true, retryAfter: Number.isFinite(Number(j?.retryAfter)) ? Number(j.retryAfter) : 3 };
  } catch { return { retryable: false, retryAfter: 3 }; }
}
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  });
}
