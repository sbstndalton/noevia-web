// #1006: how a chat or project picks its tools. Mirrors noevia-core's projectToolboxIds
// (toolboxes-permitted.cjs): an explicit toolsMode wins; without one, a project that holds its own
// toolbox list is Manual, and one without a list gets the default set, which is Automatic.
//
// #1522: a new project is Automatic because it is created with toolsMode: 'auto' (see
// NEW_PROJECT_TOOLS_MODE), not because of the fallback. The server used to create every project
// with a toolboxes array and no toolsMode, so every new chat opened in Manual. The fallback stays
// as it is because core still reads a list without a toolsMode as Manual, and the menu has to show
// what is actually sent.
import type { Project } from './types';

export type ToolsMode = 'auto' | 'manual';

/** The mode a new project is created with (#1522). Sent on create as toolsMode. */
export const NEW_PROJECT_TOOLS_MODE: ToolsMode = 'auto';

export function toolsModeOf(project: Pick<Project, 'toolsMode' | 'toolboxes'> | null | undefined): ToolsMode {
  if (project?.toolsMode === 'auto' || project?.toolsMode === 'manual') return project.toolsMode;
  return Array.isArray(project?.toolboxes) ? 'manual' : 'auto';
}
