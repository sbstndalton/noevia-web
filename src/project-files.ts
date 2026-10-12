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

/**
 * The name a new file is saved under when `name` is already taken: the name itself if it is free,
 * otherwise the first "stem (2).ext", "stem (3).ext", … that is free (#1454). An upload that
 * reuses a source's name is kept as a copy under this name; it never replaces the source silently.
 */
export function uniqueName(name: string, existing: { name: string }[]): string {
  if (!existing.some((f) => f.name === name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!existing.some((f) => f.name === candidate)) return candidate;
  }
}
