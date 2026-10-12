// Moving a chat between the person's own lists (#1511). Pure: no React, no fetch, so the rule for
// which projects are offered is tested on its own (tests/client/chat-move-1511.test.cjs).

import type { Project } from './types';

/** The projects a chat can be moved into: the same rule the server applies (noevia-core
 *  project-modes.cjs chatDestination, #810). A project takes chats when it is not archived and
 *  has Chat mode; a project without a `modes` list is Chat, as the server migrates it. The chat's
 *  current project is not a target (moving it there does nothing). Diary's internal project never
 *  reaches the client, so it needs no check here. */
export function chatMoveTargets(projects: readonly Project[], chat: { projectId?: string | null }): Project[] {
  const current = chat.projectId ?? null;
  return projects.filter((project) => project.archived !== true
    && (Array.isArray(project.modes) && project.modes.length ? project.modes : ['chat']).includes('chat')
    && project.id !== current);
}
