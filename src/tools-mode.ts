// #1006: how a chat or project picks its tools. Mirrors noevia-core's projectToolboxIds
// (toolboxes-permitted.cjs): an explicit toolsMode wins; without one, a project that holds its own
// toolbox list is Manual, and one without a list gets the default set, which is Automatic.
import type { Project } from './types';

export type ToolsMode = 'auto' | 'manual';

export function toolsModeOf(project: Pick<Project, 'toolsMode' | 'toolboxes'> | null | undefined): ToolsMode {
  if (project?.toolsMode === 'auto' || project?.toolsMode === 'manual') return project.toolsMode;
  return Array.isArray(project?.toolboxes) ? 'manual' : 'auto';
}
