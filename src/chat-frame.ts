import type { ChatFrame, ChatKind } from './types';

// Chat framing, phase 2 (#738): the confirm row under a new chat's first message. A suggested
// frame is only a draft here; nothing is saved until the person accepts it. Pure and framework-free
// so the chip model and every reducer step are unit-tested without mounting App.tsx.

export const FRAME_KINDS: readonly ChatKind[] = ['search', 'action', 'idea', 'question', 'code'];
/** The server's limits (server/chat-framing.cjs normalizeFrame): a draft never holds more. */
export const MAX_FRAME_TAGS = 20;
export const MAX_FRAME_TAG_CHARS = 64;

export type FrameChip =
  | { id: 'project'; type: 'project'; projectId: string; label: string }
  | { id: 'kind'; type: 'kind'; kind: ChatKind }
  | { id: string; type: 'tag'; tag: string }
  | { id: 'links'; type: 'links'; count: number };

export interface FrameDraft {
  frame: ChatFrame;
  /** idle: waiting for the person; saving: accept in flight; error: the save failed (retry keeps the draft). */
  status: 'idle' | 'saving' | 'error';
}

export type FrameAction =
  | { type: 'removeProject' }
  | { type: 'removeTag'; tag: string }
  | { type: 'removeLinks' }
  | { type: 'setProject'; projectId: string | null }
  | { type: 'setTags'; text: string }
  | { type: 'saving' }
  | { type: 'failed' }
  | { type: 'dismiss' };

/** One tag the way the server stores it: no leading #, inner spaces as hyphens, capped. */
export function cleanTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').replace(/\s+/g, '-').slice(0, MAX_FRAME_TAG_CHARS);
}

/** Free text from the tag editor ("#plans, travel  budget") as a clean, de-duplicated list. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,]+/)) {
    const tag = cleanTag(part);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_FRAME_TAGS) break;
  }
  return out;
}

/** The suggestion as a draft, or null when it is not a usable frame. A project the person does not
 *  have (deleted since, or never theirs) is dropped rather than shown. */
export function startDraft(suggestion: unknown, projectIds: readonly string[]): FrameDraft | null {
  if (!suggestion || typeof suggestion !== 'object' || Array.isArray(suggestion)) return null;
  const s = suggestion as Partial<ChatFrame>;
  if (!s.kind || !FRAME_KINDS.includes(s.kind)) return null;
  const projectId = typeof s.projectId === 'string' && projectIds.includes(s.projectId) ? s.projectId : null;
  const tags = parseTags((Array.isArray(s.tags) ? s.tags : []).filter((t): t is string => typeof t === 'string').join(','));
  const links = Array.from(new Set((Array.isArray(s.links) ? s.links : []).filter((l): l is string => typeof l === 'string' && !!l)));
  return { frame: { projectId, kind: s.kind, tags, links, confirmed: false, source: 'suggested' }, status: 'idle' };
}

/** What the row shows, in reading order: project, kind, each tag, then "N related". */
export function frameChips(frame: ChatFrame, projects: readonly { id: string; name: string }[]): FrameChip[] {
  const chips: FrameChip[] = [];
  const project = frame.projectId ? projects.find((p) => p.id === frame.projectId) : undefined;
  if (project) chips.push({ id: 'project', type: 'project', projectId: project.id, label: project.name });
  chips.push({ id: 'kind', type: 'kind', kind: frame.kind });
  for (const tag of frame.tags) chips.push({ id: `tag:${tag}`, type: 'tag', tag });
  if (frame.links.length) chips.push({ id: 'links', type: 'links', count: frame.links.length });
  return chips;
}

/** One step of the confirm row. `dismiss` returns null: the row goes away and nothing is saved.
 *  The kind is never removable: every frame has exactly one (the server rejects a frame without). */
export function frameDraftReducer(draft: FrameDraft | null, action: FrameAction): FrameDraft | null {
  if (!draft) return null;
  if (action.type === 'dismiss') return null;
  if (action.type === 'saving') return { ...draft, status: 'saving' };
  if (action.type === 'failed') return { ...draft, status: 'error' };
  // Edits while a save is in flight would be lost or half-applied; they wait for the outcome.
  if (draft.status === 'saving') return draft;
  const edit = (frame: Partial<ChatFrame>): FrameDraft => ({ frame: { ...draft.frame, ...frame }, status: 'idle' });
  switch (action.type) {
    case 'removeProject': return edit({ projectId: null });
    case 'removeTag': return edit({ tags: draft.frame.tags.filter((t) => t !== action.tag) });
    case 'removeLinks': return edit({ links: [] });
    case 'setProject': return edit({ projectId: action.projectId || null });
    case 'setTags': return edit({ tags: parseTags(action.text) });
    default: return draft;
  }
}

/** The frame as saved on accept: confirmed by the person. */
export function acceptedFrame(frame: ChatFrame): ChatFrame {
  return { ...frame, tags: [...frame.tags], links: [...frame.links], confirmed: true, source: 'user' };
}

/** Where an accepted frame puts the chat: into the framed project when it names one the chat is not
 *  already in; otherwise the chat stays where it is and only the frame is saved. */
export function acceptPlan(frame: ChatFrame, currentProjectId: string | null): { move: boolean; projectId: string | null } {
  if (frame.projectId && frame.projectId !== currentProjectId) return { move: true, projectId: frame.projectId };
  return { move: false, projectId: currentProjectId };
}
