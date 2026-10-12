// #1424: an archived chat is never pinned. Archiving takes the chat out of the Pinned group, so restoring
// it (from the Archived page, or from the undo that follows a quick archive) must not bring the pin back
// by itself. Undo puts back exactly what the archive changed: the pin the chat had before.
import type { ChatMeta } from './types';

/** The patch that archives a chat: it leaves the Pinned group too. */
export function archivePatch(): Partial<ChatMeta> {
  return { archived: true, pinned: false };
}

/** The patch that undoes a quick archive: the chat comes back as it was, pin included. */
export function undoArchivePatch(chat: Pick<ChatMeta, 'pinned'>): Partial<ChatMeta> {
  return { archived: false, pinned: !!chat.pinned };
}

/** The patch that restores a chat from the Archived page: back in the list, unpinned. */
export function restorePatch(): Partial<ChatMeta> {
  return { archived: false, pinned: false };
}
