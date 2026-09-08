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
  /** Write tools wait for a human before they run (step 16). 'pending' means
   *  the model has asked and the user has not answered yet; the id is what the
   *  approval is posted against. Reads never enter this state. */
  status?: 'running' | 'pending' | 'done' | 'denied';
  approvalId?: string;
}

export interface ProjectFile {
  name: string;
  content: string;
  /** The attached storage folder this came from. Absent for uploaded files,
   *  which a folder sync must never overwrite. */
  source?: string;
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
  pinned?: boolean;
  archived?: boolean;
  /** Storage folders whose text files are pulled in as sources on sync. */
  sourceFolders?: string[];
  toolboxes?: string[]; // step 14: named tool sets offered to the model; defaults to ['core']
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
  /** The latest user message, for the project chat list. */
  preview?: string;
  /** Sorts to a Pinned group above the rest; independent of archived. */
  pinned?: boolean;
  /** Hidden from the default lists, still reachable under Archived. */
  archived?: boolean;
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

/** Aggregate usage for the signed-in user, from GET /api/usage. Days are a
 *  dense series (zeros included) covering the retention window, oldest first,
 *  so the heat map can render straight from it. */
export interface UsageDay { day: string; input: number; output: number; replies: number }
export interface UsageTotals { input: number; output: number; replies: number }
export interface UsageModel { name: string; input: number; output: number; replies: number }
export interface UsageSummary {
  days: UsageDay[];
  allTime: UsageTotals;
  last7: UsageTotals;
  last30: UsageTotals;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  models: UsageModel[];
  retentionDays: number;
  timeZone: string;
}

// A selectable set of tools. `estTokens` is what the set costs in the prompt
// on every single turn — the number that decides whether a box is affordable
// on a small local model, so it is surfaced in the picker.
export interface Toolbox {
  id: string;
  label: string;
  description: string;
  source: 'builtin' | 'mcp';
  toolCount: number;
  estTokens: number;
}
