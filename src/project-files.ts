import type { Project } from './types';

/**
 * Files after removing one uploaded file by name. Filters by name alone: an
 * earlier version also required `!source`, which meant the array sent to the
 * server dropped every synced (folder-derived) file, not just the one being
 * removed. The config-patch endpoint (server/routes/projects.cjs) rebuilds
 * the synced portion of `files` itself from the project's previous state —
 * it never trusts what a patch sends for `source` entries — so that drop was
 * silently harmless for synced files today, but the intent of the filter was
 * still wrong and would matter the moment that server safety net changes.
 */
export function filesAfterRemoval(files: Project['files'], name: string): Project['files'] {
  return files.filter((f) => f.name !== name);
}
