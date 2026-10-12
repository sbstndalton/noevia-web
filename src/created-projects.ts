// #1417: a project this session has just created is opened straight away, and the page that opens for it
// reads the project from the workspace list. The list is re-read after the create, and that read can
// still be behind the create, so a project created here stays in the list until a workspace read
// includes it. An entry is also dropped after a grace period, so a project deleted elsewhere is not
// shown for long, and when this session deletes it.
import type { Project } from './types';

export const CREATED_PROJECT_GRACE_MS = 15000;

export interface CreatedProject { project: Project; at: number }

/** Records a project the server has just created. */
export function rememberCreatedProject(created: Map<string, CreatedProject>, project: Project, now: number): void {
  created.set(project.id, { project, at: now });
}

/** The workspace list with this session's created projects kept in it until the server lists them. */
export function withCreatedProjects(listed: Project[], created: Map<string, CreatedProject>, now: number): Project[] {
  const ids = new Set(listed.map((p) => p.id));
  const next = [...listed];
  for (const [id, entry] of created) {
    if (ids.has(id) || now - entry.at > CREATED_PROJECT_GRACE_MS) { created.delete(id); continue; }
    next.push(entry.project);
  }
  return next;
}
