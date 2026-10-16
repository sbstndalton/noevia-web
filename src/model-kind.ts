import { isSystemModel } from './model-system';
// Which models can answer a chat-generation prompt (#206). Mirrors
// server/chat-model-kind.cjs, which rejects the same models server-side.
const NON_CHAT_LABEL = /^(embedding|embeddings|rerank|reranking|reranker)$/i;
const NON_CHAT_NAME = /embed|rerank/i;

export function isChatGenerationModel(name: string, labels: readonly string[] = []): boolean {
  const n = String(name || '').trim();
  // Laya (the routing model) comes from the explicit system kind, not its name (#1179).
  if (!n || isSystemModel(n) || NON_CHAT_NAME.test(n)) return false;
  return !labels.some((l) => NON_CHAT_LABEL.test(l));
}

/** #1895: the installed models a chat could answer with. The composer pill's label is picked from this list only, so an
 *  embedding, reranking or system model that happens to be loaded is never shown as the chat's model. Same rule as
 *  pickInspectorModel (inspector-model.ts). Null (catalogue unknown) stays null. */
export function chatGenerationModels<T extends { name: string; labels?: readonly string[] }>(models: readonly T[] | null | undefined): T[] | null {
  return models ? models.filter((m) => isChatGenerationModel(m.name, m.labels ?? [])) : null;
}

/** Split benchmark sections into chat models and the rest, using the installed
 *  list's labels where a section appears there. */
export function splitChatSections(sections: readonly string[], installed: readonly { name: string; labels: string[]; system?: boolean }[]): { chat: string[]; excluded: string[] } {
  const chat: string[] = [], excluded: string[] = [];
  for (const s of sections) {
    const labels = installed.find((m) => m.name === s)?.labels ?? [];
    (isChatGenerationModel(s, labels) ? chat : excluded).push(s);
  }
  return { chat, excluded };
}
