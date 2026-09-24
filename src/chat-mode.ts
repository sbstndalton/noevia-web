// Chat / Cowork session modes (#236). Pure: no React, no fetch, so the dispatch decision is
// tested on its own (tests/chat-mode.test.cjs).
//
// Chat   the conversational turn loop (/api/chat streaming).
// Cowork a coding task on the existing code harness (ACP), started through /api/chat with
//        mode:"cowork" and then followed on the task's own endpoint. The server re-checks all of
//        this (admin, harness flag, project); this helper only decides what to try and explains
//        a fallback in one line instead of failing the send.

export type ChatMode = 'chat' | 'cowork';

export const MODE_LABELS: Record<ChatMode, { label: string; description: string }> = {
  chat: { label: 'Chat', description: 'A conversational reply. Tools you allow may be called; writes ask first.' },
  cowork: { label: 'Cowork', description: 'A task on the coding harness in a project repository, with progress, approvals and cancel.' },
};

/** A stored value becomes a mode; anything unknown (older chats included) is Chat. */
export function parseMode(value: unknown): ChatMode {
  return value === 'cowork' ? 'cowork' : 'chat';
}

/** The session's mode: its saved record first, then an unsent choice for this chat, then the default. */
export function sessionMode(saved: unknown, pending: ChatMode | undefined, fallback: ChatMode = 'chat'): ChatMode {
  if (saved === 'cowork' || saved === 'chat') return saved;
  return pending ?? fallback;
}

/**
 * Switching mode in place is only safe before the first message: after that, the other harness
 * would run on context it never saw, so the switch becomes an explicit new session.
 */
export function switchNeedsNewSession(messageCount: number, current: ChatMode, next: ChatMode): boolean {
  return current !== next && messageCount > 0;
}

export interface DispatchInput {
  mode: ChatMode;
  /** features.codeHarness on this server. */
  harnessEnabled: boolean;
  /** The server answered this account's code state for the project (admins only). */
  canUseCode: boolean;
  projectId: string | null;
  repository: string | null;
}
export interface DispatchDecision {
  harness: ChatMode;
  /** One line shown with the reply when Cowork fell back to Chat; null otherwise. */
  notice: string | null;
  /** Why Cowork fell back to Chat, as a code the interface can translate; null when it did not. */
  reason: FallbackReason | null;
}
export type FallbackReason = 'harnessOff' | 'freeChat' | 'adminOnly' | 'noRepository';
const REASON_TEXT: Record<FallbackReason, string> = {
  harnessOff: 'the coding harness is off on this server',
  freeChat: 'Cowork runs inside a project, and this is a free chat',
  adminOnly: 'the coding harness is limited to administrators',
  noRepository: 'no repository is selected',
};

export function decideDispatch({ mode, harnessEnabled, canUseCode, projectId, repository }: DispatchInput): DispatchDecision {
  if (mode !== 'cowork') return { harness: 'chat', notice: null, reason: null };
  const reason: FallbackReason | null = !harnessEnabled ? 'harnessOff'
    : !projectId ? 'freeChat'
    : !canUseCode ? 'adminOnly'
    : !repository ? 'noRepository'
    : null;
  return reason ? { harness: 'chat', notice: `Sent as Chat: ${REASON_TEXT[reason]}.`, reason } : { harness: 'cowork', notice: null, reason: null };
}

/** Terminal task states: polling stops and the card shows its final state. */
export const TASK_FINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
