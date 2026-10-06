import type { ChatFrame, ChatMeta } from './types';
import { radialGraph } from './diary-local-graph';
import type { GraphNeighbour, LocalGraph } from './diary-local-graph';

// Chat framing, phase 5 (#741): Obsidian-style organisation over the frames chats already carry.
// Tags (nested with "/", like folders), [[chat]] links, backlinks and a one-hop graph. Everything
// here reads only the chat lists the caller passes in, which are the signed-in person's own lists
// (the workspace), so nothing can reach another account's chats. Pure and framework-free so it is
// unit-tested without a DOM (tests/client/chat-organise.test.cjs).

type ChatLike = Pick<ChatMeta, 'id' | 'title' | 'updatedAt'> & { archived?: boolean; frame?: ChatFrame | null; projectId?: string | null };

/** The server's limit (server/chat-framing.cjs normalizeFrame): a frame never holds more links. */
export const MAX_FRAME_LINKS = 20;
const MAX_CANDIDATES = 8;

const live = <T extends ChatLike>(chats: readonly T[]): T[] => chats.filter((c) => c && typeof c.id === 'string' && !c.archived);
const tagsOf = (chat: { frame?: ChatFrame | null }): string[] => (Array.isArray(chat.frame?.tags) ? chat.frame!.tags.filter((t) => typeof t === 'string' && t) : []);
const linksOf = (chat: { frame?: ChatFrame | null }): string[] => (Array.isArray(chat.frame?.links) ? chat.frame!.links.filter((l) => typeof l === 'string' && l) : []);
/** A tag's path segments; empty segments ("a//b", "/a") are dropped, so they cannot make blank rows. */
const segments = (tag: string): string[] => tag.split('/').map((s) => s.trim()).filter(Boolean);

export interface TagNode {
  /** The last segment, as first written. */
  name: string;
  /** The full path ("work/clients"), what a filter matches. */
  path: string;
  /** Chats tagged with this path or anything under it, each counted once. */
  count: number;
  children: TagNode[];
}

/** Every tag on the live (not archived) chats as a tree: "work/clients" sits under "work".
 *  Matching is case-insensitive; the spelling shown is the first one seen. Sorted by name. */
export function tagTree(chats: readonly ChatLike[]): TagNode[] {
  type Draft = { name: string; path: string; chats: Set<string>; children: Map<string, Draft> };
  const root = new Map<string, Draft>();
  for (const chat of live(chats)) {
    for (const tag of tagsOf(chat)) {
      let level = root, path = '';
      for (const part of segments(tag)) {
        path = path ? `${path}/${part}` : part;
        const key = part.toLocaleLowerCase();
        let node = level.get(key);
        if (!node) { node = { name: part, path, chats: new Set(), children: new Map() }; level.set(key, node); }
        node.chats.add(chat.id);
        path = node.path;
        level = node.children;
      }
    }
  }
  const build = (level: Map<string, Draft>): TagNode[] => [...level.values()]
    .map((d) => ({ name: d.name, path: d.path, count: d.chats.size, children: build(d.children) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return build(root);
}

/** Whether `chat` carries `tag` itself or a tag nested under it ("work" matches "work/clients"). */
export function hasTag(chat: ChatLike, tag: string): boolean {
  const want = segments(tag).join('/').toLocaleLowerCase();
  if (!want) return false;
  return tagsOf(chat).some((t) => { const have = segments(t).join('/').toLocaleLowerCase(); return have === want || have.startsWith(`${want}/`); });
}

/** Chats whose frame links to `chatId`, newest first. Archived chats and the chat itself are left out. */
export function backlinks<T extends ChatLike>(chatId: string, chats: readonly T[]): T[] {
  return live(chats).filter((c) => c.id !== chatId && linksOf(c).includes(chatId)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** The chats `chat` links to that still exist in the lists (a deleted target simply drops out). */
export function outgoingLinks<T extends ChatLike>(chat: ChatLike | null | undefined, chats: readonly T[]): T[] {
  if (!chat) return [];
  const byId = new Map(live(chats).map((c) => [c.id, c]));
  return [...new Set(linksOf(chat))].map((id) => byId.get(id)).filter((c): c is T => !!c && c.id !== chat.id);
}

/** Chats a `[[` being typed could mean: titles containing the query (titles starting with it first,
 *  then the newest), never the chat being written in. At most eight. */
export function chatLinkCandidates<T extends ChatLike>(query: string, chats: readonly T[], selfId: string): T[] {
  const q = query.trim().toLocaleLowerCase();
  return live(chats)
    .filter((c) => c.id !== selfId && (c.title || '').trim() && (c.title || '').toLocaleLowerCase().includes(q))
    .sort((a, b) => Number((b.title || '').toLocaleLowerCase().startsWith(q)) - Number((a.title || '').toLocaleLowerCase().startsWith(q)) || (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_CANDIDATES);
}

/** The link text for a chosen chat. Brackets would end the link early, so they become parentheses. */
export function chatLinkText(title: string): string {
  return `[[${title.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim()}]]`;
}

/** `text` with the `[[query` at `start` replaced by the full link; returns the new text and caret. */
export function insertChatLink(text: string, start: number, caret: number, title: string): { text: string; caret: number } {
  const open = Math.max(0, start - 2);
  const link = chatLinkText(title);
  const next = `${text.slice(0, open)}${link}${text.slice(caret)}`;
  return { text: next, caret: open + link.length };
}

/** The frame `chat` should save after linking to `targetId`: its own frame with the link added, or,
 *  for a chat without one, a link-only frame. That frame is not confirmed, so it never steers an
 *  answer (server/chat-frame-steering.cjs reads confirmed frames only); the kind is the neutral one
 *  the server requires. Null when nothing changes (already linked, a self link, or full). */
export function frameWithLink(chat: Pick<ChatLike, 'id' | 'frame' | 'projectId'> | null | undefined, chatId: string, targetId: string, projectId: string | null): ChatFrame | null {
  if (!targetId || targetId === chatId) return null;
  const frame = chat?.frame;
  if (frame && typeof frame === 'object' && frame.kind) {
    const links = linksOf(chat!);
    if (links.includes(targetId) || links.length >= MAX_FRAME_LINKS) return null;
    return { ...frame, tags: [...tagsOf(chat!)], links: [...links, targetId] };
  }
  return { projectId: projectId ?? null, kind: 'question', tags: [], links: [targetId], confirmed: false, source: 'user' };
}

/** Links that an incoming frame would drop but the stored one has: kept, so accepting a suggested
 *  frame after a [[link]] was typed does not lose the link. */
export function keepLinks(next: ChatFrame, stored: ChatFrame | null | undefined): ChatFrame {
  const extra = (Array.isArray(stored?.links) ? stored!.links : []).filter((l) => !next.links.includes(l));
  return extra.length ? { ...next, links: [...next.links, ...extra].slice(0, MAX_FRAME_LINKS) } : next;
}

export const TAG_NODE_PREFIX = 'tag:';

/** One hop around a chat: the chats it links to, the chats linking to it, and a hub per tag. */
export function chatGraph<T extends ChatLike>(chat: T, chats: readonly T[], untitled = ''): LocalGraph {
  const out = new Set(outgoingLinks(chat, chats).map((c) => c.id));
  const incoming = new Set(backlinks(chat.id, chats).map((c) => c.id));
  const titles = new Map(chats.map((c) => [c.id, c.title || untitled]));
  const neighbours: GraphNeighbour[] = [...new Set([...out, ...incoming])].map((id) => ({
    id, label: titles.get(id) || untitled, relation: out.has(id) && incoming.has(id) ? 'both' : out.has(id) ? 'out' : 'in',
  }));
  for (const tag of new Set(tagsOf(chat).map((t) => segments(t).join('/')).filter(Boolean))) neighbours.push({ id: `${TAG_NODE_PREFIX}${tag}`, label: `#${tag}`, relation: 'tag' });
  return radialGraph({ id: chat.id, label: chat.title || untitled }, neighbours);
}
