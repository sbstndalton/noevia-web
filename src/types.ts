export type Role = 'user' | 'assistant';

export interface RoutingDecision {
  offered: { id: string; label: string }[];
  scores: Record<string, number>;
  selectedRole: string | null;
  effectiveRole: string;
  backend: 'decision-service' | 'llama-logit' | 'legacy';
  model: 'convaiinnovations/laya' | null;
  calibrated: false;
  latencyMs: number | null;
  status: 'accepted' | 'fallback';
  fallbackReason: string | null;
}

export interface Message {
  id: string;
  role: Role;
  senderLabel?: string;
  routingDecision?: RoutingDecision;
  content: string;
  reasoningMode?: string;
  reasoningEffort?: string;
  reasoning?: string;
  /** How long the model thought before its answer began, measured on this client. */
  reasoningMs?: number;
  toolCalls?: ToolCallView[];
  error?: boolean;
  warning?: string;
  /** Toolboxes the router picked for this reply, shown as "Using: …". */
  toolScope?: string;
  /** Skills auto-loaded for this reply because the message matched them. */
  skillScope?: string;
  processingStatus?: string;
  stats?: MessageStats;
  /** Set when this message was edited and the exchange re-run from here. */
  edited?: boolean;
  /** A Cowork turn (#236): the code task this reply follows, shown as an inline task card. */
  coworkTask?: CoworkTaskRef;
  /** A Cowork start that failed keeps its repository so Retry uses the same harness. */
  coworkRepository?: string;
}

/** The code task a Cowork reply started; the card reads its live state from the code API. */
export interface CoworkTaskRef { projectId: string; taskId: string; repository: string }

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
  status?: 'running' | 'pending' | 'done' | 'denied' | 'stopped';
  approvalId?: string;
  /** What the tool returned, bounded for display and history. */
  result?: string;
}

export interface DocumentStatus {
  version?: string;
  byteHash?: string;
  state: 'ready' | 'partial' | 'failed';
  stale?: boolean;
  pages?: number;
  truncated?: boolean;
  error?: string;
  indexing?: string;
  pageStatus?: { number: number; status: string }[];
}

export interface ProjectFile {
  attachment?: { id: string; bytes: number; group: string; state: string; reason?: string; assetId?: string; readerVersion?: string };
  document?: DocumentStatus;
  name: string;
  content: string;
  /** The attached storage folder this came from. Absent for uploaded files,
   *  which a folder sync must never overwrite. */
  source?: string;
}

export interface ProjectAsset {
  sourceName?: string;
  storagePath?: string;
  id: string;
  name: string;
  mime: string;
  bytes: number;
}

export type ProjectMode = 'chat' | 'cowork' | 'code';

export interface Project {
  reasoningEffort?: 'default' | 'low' | 'high' | null;
  icon?: string;
  color?: string;
  id: string;
  name: string;
  goal: string;
  instructions: string;
  memories: string[];
  files: ProjectFile[];
  model?: string; // unset until picked; server defaults to the loaded model
  provider?: string; // unset = the server-configured default provider
  routing?: 'manual' | 'auto'; // default 'auto'; 'auto' = Fast/Smart per-message routing
  pinned?: boolean;
  archived?: boolean;
  /** Storage folders whose text files are pulled in as sources on sync. */
  sourceFolders?: string[];
  /** This project's own folder in storage. Uploads land here, and only files
   *  here may be deleted from within the project. */
  projectFolder?: string;
  /** Image sources. Stored as bytes on the server, not inline. */
  assets?: ProjectAsset[];
  toolboxes?: string[]; // step 14: named tool sets offered to the model; defaults to ['core']
  /** App modes this project appears in; the server migrates older projects to ['chat']. */
  modes?: ProjectMode[];
  /** Which modes receive the others' context (shared-context.cjs); both off by default. */
  sharedContext?: { chat: boolean; code: boolean };
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
  /** The session's harness (#236). Absent means Chat, as for every chat before modes. */
  mode?: 'chat' | 'cowork';
}

export interface HistoryEntry {
  role: Role;
  content: string;
  model?: string;
  routingDecision?: RoutingDecision;
  // Persisted so a reloaded chat still shows its thinking, tool activity and
  // cost. The server stores these opaquely and strips everything but
  // role/content before the history is replayed to a model.
  reasoning?: string;
  reasoningMs?: number;
  toolCalls?: ToolCallView[];
  stats?: MessageStats;
  coworkTask?: CoworkTaskRef;
}

export interface WorkspaceInfo {
  projects: Project[];
  freeChats?: ChatMeta[];
}

export interface HealthState {
  inferenceUp: boolean | null;
  /** One-release compatibility field returned by older/newer mixed deployments. */
  lemonadeUp?: boolean | null;
  diaryUp: boolean | null;
  /** Project RAG readiness — false means native deps are missing (keyword-only context). */
  ragAvailable?: boolean | null;
  /**
   * Tri-state retrieval readiness (#340): 'available' the embedding probe answered; 'degraded'
   * the index is installed but the configured embedding endpoint could not be reached (small
   * files and source excerpts still reach the model, semantic search does not); 'unavailable'
   * native index deps are missing. Older/newer mixed deployments may omit this field.
   */
  retrieval?: 'available' | 'degraded' | 'unavailable' | null;
}

export interface InstalledModel {
  status?: string;
  failed?: boolean;
  canDelete?: boolean;
  /** True when a live sidecar (embedding or reranking) depends on this exact model right now
   *  (#336) — distinct from canDelete, which keeps the manager's own can_remove meaning and the
   *  client's existing folder-scan-delete fallback when it is false. */
  sidecarProtected?: boolean;
  source?: string | null;
  mtp?: {supported:boolean;enabled:boolean;reason:string};
  name: string;
  sizeGB: number | null;
  loaded: boolean;
  labels: string[];
  maxContext: number | null;
  suggested: boolean;
}

export interface DiaryCorpus {
  todayLog: string;
  standing: string;
}

export interface RouteRule {
  task: string;
  model: string;
}

/** Optional live statistics supplied by a model-management adapter. */
export interface LiveStats {
  mtp?: {model:string;source?:string;rate:number|null;drafted:number|null;accepted:number|null}[];
  up: boolean;
  tokensPerSecond: number | null;
  timeToFirstToken: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  telemetryScope?: string | null;
  inputTokensTotal: number | null;
  outputTokensTotal: number | null;
  requestCount: number | null;
  cpuPercent: number | null;
  gpuPercent: number | null;
  vramGb: number | null;
  memoryGb: number | null;
}

/** Request-local telemetry for one chat reply. Unlike LiveStats, these values
 * come from that reply's SSE stream, so an engine-wide poll cannot replace
 * them with another account's request or with an unavailable native gauge. */
export interface ReplyTelemetry {
  phase: 'waiting' | 'streaming' | 'complete' | 'stopped' | 'error';
  model: string | null;
  timeToFirstToken: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  tokensPerSecond: number | null;
  mtp: { model: string; source: 'last response'; rate: number; drafted: number; accepted: number }[];
}

/** Aggregate usage for the signed-in user, from GET /api/usage. Days are a
 *  dense series (zeros included) covering the retention window, oldest first,
 *  so the heat map can render straight from it. */
export interface UsageDay { day: string; input: number; output: number; replies: number }
export interface UsageTotals { input: number; output: number; replies: number }
export interface UsageModel { name: string; input: number; output: number; replies: number }
export interface UsageSummary {
  aggregate?: {accounts:number;unreadableAccounts:number;checkedAt:number};
  days: UsageDay[];
  allTime: UsageTotals;
  last7: UsageTotals;
  last30: UsageTotals;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  models: UsageModel[];
  /** Tools the model actually ran, busiest first. Empty before any ran. */
  tools: { name: string; calls: number }[];
  /** Replies per hour of the server's local clock, 0–23. */
  hours: number[];
  peakHour: { hour: number; replies: number } | null;
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
