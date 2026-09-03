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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchWorkspace(): Promise<WorkspaceInfo> {
  return getJson('/api/workspace');
}

// ── Providers (step 9: generic OpenAI-compatible endpoints) ─────────────────

export function fetchProviders(): Promise<{ providers: Provider[] }> {
  return getJson('/api/providers');
}

export function createProvider(body: { label: string; baseUrl: string; apiKey?: string }): Promise<Provider> {
  return postJson('/api/providers', body);
}

export function deleteProvider(id: string): Promise<{ ok: boolean }> {
  return fetch(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((res) => {
    if (!res.ok) throw new Error(`DELETE provider failed: ${res.status}`);
    return res.json() as Promise<{ ok: boolean }>;
  });
}

// ── Projects (Claude-style) ──────────────────────────────────────────────────

export function createProject(body: {
  name: string;
  goal?: string;
  instructions?: string;
  files?: { name: string; content: string }[];
}): Promise<Project> {
  return postJson('/api/projects', body);
}

export function deleteProject(projectId: string): Promise<{ ok: true }> {
  return fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }).then(
    (r) => {
      if (!r.ok) throw new Error(`delete failed: ${r.status}`);
      return { ok: true } as const;
    },
  );
}

export function saveProjectConfig(
  projectId: string,
  patch: Partial<Pick<Project, 'name' | 'goal' | 'instructions' | 'model' | 'memories' | 'files'>>,
): Promise<{ ok: true }> {
  return postJson(`/api/projects/${encodeURIComponent(projectId)}/config`, patch);
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
  return fetch(
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
  return getJson('/api/health');
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
  return fetch(`/api/freechats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }).then((r) => {
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
}> {
  const res = await fetch('/api/chat', {
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
