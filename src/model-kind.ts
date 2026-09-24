// Which models can answer a chat-generation prompt (#206). Mirrors
// server/chat-model-kind.cjs, which rejects the same models server-side.
const NON_CHAT_LABEL = /^(embedding|embeddings|rerank|reranking|reranker)$/i;
const NON_CHAT_NAME = /embed|rerank/i;
// Laya, the internal routing model (server/model-system.cjs).
const SYSTEM_NAME = /^laya(?:[_.-]|$)/i;

export function isChatGenerationModel(name: string, labels: readonly string[] = []): boolean {
  const n = String(name || '').trim();
  if (!n || SYSTEM_NAME.test(n) || NON_CHAT_NAME.test(n)) return false;
  return !labels.some((l) => NON_CHAT_LABEL.test(l));
}

/** Split benchmark sections into chat models and the rest, using the installed
 *  list's labels where a section appears there. */
export function splitChatSections(sections: readonly string[], installed: readonly { name: string; labels: string[] }[]): { chat: string[]; excluded: string[] } {
  const chat: string[] = [], excluded: string[] = [];
  for (const s of sections) {
    const labels = installed.find((m) => m.name === s)?.labels ?? [];
    (isChatGenerationModel(s, labels) ? chat : excluded).push(s);
  }
  return { chat, excluded };
}
