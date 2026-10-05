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

/** #778: where a reply was sent and why (codes only). */
export type RouteName = 'local' | 'cloud';
export type RouteReason = 'mode' | 'user-choice' | 'force-local' | 'sensitive-rule' | 'fail-closed' | 'remembered';
export type RouteFlag = 'diary' | 'secret' | 'iban' | 'card' | 'router' | 'unavailable';
export interface RouteTarget { route: RouteName; reason: RouteReason }

export interface Message {
  id: string;
  role: Role;
  senderLabel?: string;
  routingDecision?: RoutingDecision;
  /** #778: the local/cloud badge. */
  routeTarget?: RouteTarget;
  /** #778: a sensitive-looking turn waiting for Send to cloud / Keep local. Never persisted. */
  routePending?: { id: string; flag: RouteFlag; busy?: boolean };
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
  /** The same toolboxes by stable id (#624), so the "Using:" line can be worded in the interface language. */
  toolScopeBoxes?: { id: string; label: string; inApp?: boolean }[];
  /** Skills auto-loaded for this reply because the message matched them. */
  skillScope?: string;
  processingStatus?: string;
  /** The server's stable id for `processingStatus` (#624), so the line can be worded in the interface language. */
  processingStatusId?: string;
  stats?: MessageStats;
  /** Set when this message was edited and the exchange re-run from here. */
  edited?: boolean;
  /** A Cowork turn (#236): the code task this reply follows, shown as an inline task card. */
  coworkTask?: CoworkTaskRef;
  /** A Cowork start that failed keeps its repository so Retry uses the same harness. */
  coworkRepository?: string;
  /** The project passages placed in this reply's prompt (#552), in prompt order. */
  sources?: SourceRef[];
  /** On a user turn: the Skill pin it was sent with, `skill_<id>@<sha256>` (#571), so Retry survives a reload. */
  skill?: string;
  /** #658: the reply ended early after tool steps had run: step supervision paused it, or it
   *  failed after changes were saved. `applied` is how many changes were saved. Not an error. */
  paused?: ReplyPause;
}

/** Why a reply ended before a final answer, and how many changes it had already saved (#658).
 *  'declined' (#666): the person declined a write on its approval card, so the reply ended with
 *  no model text; `declined` names the tools they declined. */
export interface ReplyPause {
  reason: 'supervision' | 'stopped' | 'declined' | 'sensitive';
  applied: number;
  declined?: string[];
}

/** One project source the model was given for a reply. `file` is the project file's name. */
export interface SourceRef { id: string; file: string; snippet: string; kind: 'excerpt' | 'file'; score?: number }

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
  /** A pending project file edit: the full stored path of the file it would change (#648); for a
   *  Google Drive write, the Drive file's name and id (#659). Kept on the chip once it ran. */
  target?: string;
  /** #659: whose file `target` names: a Google Drive file, or a new one. Absent: a project file. */
  targetKind?: 'drive' | 'drive-new';
  /** #658: the same tool, target and arguments as a change already saved in this chat. */
  repeatOf?: boolean;
  /** #769: sensitive arguments holding untrusted text (or `unchecked`), shown on the card. */
  provenance?: ToolProvenance[];
  /** #658: a write that ran and succeeded. Later turns tell the model it is done. */
  applied?: boolean;
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
  errorId?: string;
  indexing?: string;
  pageStatus?: { number: number; status: string; reason?: string }[];
}

export interface ProjectFile {
  attachment?: { id: string; bytes: number; group: string; state: string; reason?: string; reasonId?: string; reasonParams?: Record<string, string | number>; assetId?: string; readerVersion?: string };
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
  /** Storage path reserved at creation; the first upload creates exactly this folder. */
  reservedFolder?: string;
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
export interface ProviderCapabilities {
  reasoningEffortParam?: boolean;
  reasoningEffortModels?: string[];
  tokenBudgetField?: 'max_tokens' | 'max_completion_tokens';
  /** Accepts `response_format` json_schema and constrains decoding to it (#517). */
  jsonSchemaParam?: boolean;
}

export interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyMasked?: string | null;
  isDefault?: boolean;
  managed?: boolean;
  shared?: boolean;
  defaultModel?: string;
  /** The person's stated context window in tokens (#536); absent means the server default. */
  contextTokens?: number;
  /** What the provider's API accepts (#675); the server fills a preset's default for older rows. */
  capabilities?: ProviderCapabilities;
  /** Sign in with ChatGPT (#447): the account's own private connection, sent to an external service. */
  kind?: 'chatgpt-oauth';
  external?: boolean;
  connection?: ChatGptConnectionState;
}

export type ChatGptConnectionState = 'connected' | 'reconnect' | 'disconnected';
/** GET /api/providers/chatgpt: never a token, only the state and a masked account. */
export interface ChatGptStatus {
  state: ChatGptConnectionState;
  account?: { email: string | null; plan: string | null };
  providerId?: string;
}
export interface ChatGptDeviceLogin { loginId: string; userCode: string; verificationUrl: string; interval: number; expiresAt: number }
export interface ChatGptPoll { state: 'pending' | 'connected' | 'expired'; interval?: number; account?: { email: string | null; plan: string | null } }

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
  /** When the chat was first saved (ms). Set once; the server keeps the first value (#737). */
  createdAt?: number;
  /** Chat framing (#737): suggested or confirmed. Absent means unframed. */
  frame?: ChatFrame | null;
  /** #778 routing modes: always local in this chat, no question asked. */
  forceLocal?: boolean;
  /** #778: the person chose "Send to cloud" and "remember for this chat". */
  allowCloud?: boolean;
}

export type ChatKind = 'search' | 'action' | 'idea' | 'question' | 'code';

export interface ChatFrame {
  projectId?: string | null;
  kind: ChatKind;
  tags: string[];
  /** Ids of related chats. */
  links: string[];
  confirmed: boolean;
  source: 'suggested' | 'user';
}

export interface HistoryEntry {
  role: Role;
  content: string;
  model?: string;
  routingDecision?: RoutingDecision;
  routeTarget?: RouteTarget;
  // Persisted so a reloaded chat still shows its thinking, tool activity and
  // cost. The server stores these opaquely and strips everything but
  // role/content before the history is replayed to a model.
  reasoning?: string;
  reasoningMs?: number;
  toolCalls?: ToolCallView[];
  stats?: MessageStats;
  coworkTask?: CoworkTaskRef;
  sources?: SourceRef[];
  /** User turns only (#571): the exact Skill pin the message was sent with. */
  skill?: string;
  /** Assistant turns (#658): the reply ended early after saving changes. */
  paused?: ReplyPause;
}

/** One entry of the history sent to /api/chat: a turn, or (#658) a change an earlier reply
 *  already saved, which the server words for the model as done so it is not proposed again. */
export type ModelHistoryEntry = HistoryEntry | { role: 'tool'; name: string; content: string; applied: true; target?: string; args?: string }
  /** #666: a write the user did not approve; the server tells the model it did not run. */
  | { role: 'tool'; name: string; content: string; declined: true };

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
  /** #545: a models.ini preset whose GGUF is not in the models folder. Listed as failed, never offered for chat, loading or tuning. */
  missingFile?: boolean;
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
  /** Shipped with noevia (built in, or curated in the MCP manifest): worded from the catalogue by id (#615). */
  inApp?: boolean;
  toolCount: number;
  estTokens: number;
  /** A connector (e.g. Google Drive): only ever present here when this account has it connected,
   *  since its on/off state lives in Settings → Connectors, not a project's own toolboxes list
   *  (#354). Every reader must count it as enabled and never offer it as a checkbox to toggle. */
  connector?: boolean;
}

/** #769: one sensitive argument of a write that holds text from an untrusted source. */
export type ToolProvenance = { field: string | null; source: string | null; unchecked?: boolean };
