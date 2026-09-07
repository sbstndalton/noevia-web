export type Role = 'user' | 'assistant';

export interface Message {
  id: string;
  role: Role;
  senderLabel?: string;
  content: string;
  reasoning?: string;
  toolCalls?: ToolCallView[];
  error?: boolean;
  stats?: MessageStats;
  /** Set when this message was edited and the exchange re-run from here. */
  edited?: boolean;
}

/** What a finished reply cost. Token counts come from the provider's own
 *  usage chunk (never estimated locally); elapsedMs is measured client-side
 *  because it includes the queue/load time the provider does not report. */
export interface MessageStats {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokensPerSecond?: number;
  elapsedMs?: number;
}

export interface ToolCallView {
  name: string;
  args: string;
}

export interface ProjectFile {
  name: string;
  content: string;
}

export interface Project {
  id: string;
  name: string;
  goal: string;
  instructions: string;
  memories: string[];
  files: ProjectFile[];
  model?: string; // unset until picked; server defaults to the loaded model
  provider?: string; // unset = the server-configured default provider
  routing?: 'manual' | 'auto'; // default 'manual'; 'auto' = Fast/Smart per-message routing
  chats: ChatMeta[];
  createdAt: number;
  updatedAt: number;
}

/** An OpenAI-compatible chat and embedding endpoint. */
export interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyMasked?: string | null;
  isDefault?: boolean;
  managed?: boolean;
  shared?: boolean;
  defaultModel?: string;
}

/** A named conversation inside a project (or free-floating). */
export interface ChatMeta {
  id: string;
  title: string;
  projectId?: string | null;
  updatedAt: number;
}

export interface HistoryEntry {
  role: Role;
  content: string;
  model?: string;
  // Persisted so a reloaded chat still shows its thinking, tool activity and
  // cost. The server stores these opaquely and strips everything but
  // role/content before the history is replayed to a model.
  reasoning?: string;
  toolCalls?: ToolCallView[];
  stats?: MessageStats;
}

export interface WorkspaceInfo {
  projects: Project[];
  freeChats?: ChatMeta[];
}

export interface ChatMetaOnly {
  chats: ChatMeta[];
}

export interface HealthState {
  inferenceUp: boolean | null;
  /** One-release compatibility field returned by older/newer mixed deployments. */
  lemonadeUp?: boolean | null;
  diaryUp: boolean | null;
  /** Project RAG readiness — false means native deps are missing (keyword-only context). */
  ragAvailable?: boolean | null;
}

export interface InstalledModel {
  name: string;
  sizeGB: number | null;
  loaded: boolean;
  labels: string[];
  maxContext: number | null;
  suggested: boolean;
}

export interface SearchHit {
  repo: string;
  name: string;
  downloads?: number;
}

export interface ModelVariant {
  id: string;
  label: string;
  sizeGB?: number | null;
}

export interface DownloadJob {
  id: string;
  model: string;
  progress: number | null;
  status: string;
}

export interface DiaryCorpus {
  todayLog: string;
  standing: string;
}

export interface DiaryMonth {
  id: string;
  label: string;
}

export interface RouteRule {
  task: string;
  model: string;
}

/** Optional live statistics supplied by a model-management adapter. */
export interface LiveStats {
  up: boolean;
  tokensPerSecond: number | null;
  timeToFirstToken: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  inputTokensTotal: number | null;
  outputTokensTotal: number | null;
  requestCount: number | null;
  cpuPercent: number | null;
  gpuPercent: number | null;
  vramGb: number | null;
  memoryGb: number | null;
}
