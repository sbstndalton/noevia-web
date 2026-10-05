// Which list holds a chat right now (#793): a project id, or null for the free-chat list.
// An accepted frame (#738) can move a chat to another list while one of its replies is still
// streaming, so a meta patch computed from that reply must not go to the list it was sent from.
// The chat's meta (as the workspace last reported it) wins; before its first save, a move this
// tab made (`moved`) does; otherwise the list the caller started from.

export function chatHome(
  chatId: string,
  metas: readonly { id: string; projectId?: string | null }[],
  moved: ReadonlyMap<string, string | null>,
  fallback: string | null,
): string | null {
  const meta = metas.find((c) => c.id === chatId);
  if (meta) return meta.projectId ?? null;
  if (moved.has(chatId)) return moved.get(chatId) ?? null;
  return fallback;
}
