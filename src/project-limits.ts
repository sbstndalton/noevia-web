// Single source of truth for the project name length cap (#398): the server
// (server/projects.cjs createProject, server/routes/projects.cjs PATCH) truncates a project
// name to this many characters, silently, before this fix. Both sides read the same JSON so a
// future change to the server's cap cannot drift from what the create/edit dialogs enforce.
import limits from '../server/project-limits.json';

export const PROJECT_NAME_MAX_LENGTH: number = limits.nameMaxLength;
