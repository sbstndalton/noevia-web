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

/**
 * The names an upload to this project can collide with (#1454). A stored upload is named by its whole
 * storage path ("noevia projects/<id>/Text/report.md"), so comparing a bare "report.md" against `f.name`
 * never found the clash and the server replaced the source. The collision is on the last segment of
 * a source that lives in the project's own upload folder or has no folder at all; a file synced from a
 * linked folder is a different file and does not take the name.
 */
export function uploadTakenNames(project: Pick<Project, 'files' | 'projectFolder'>): { name: string }[] {
  return (project.files || [])
    .filter((f) => !f.source || f.source === project.projectFolder)
    .map((f) => ({ name: f.name.split('/').pop() || f.name }));
}

/**
 * Runs `upload` under `name`, or the first free numbered copy of it, and returns the name it used.
 * The list the client holds can be stale, so when the server refuses a name with its `sourceExists`
 * code (it never replaces a source unless asked to) the next free number is tried instead; nothing is
 * ever written over a source (#1454).
 */
/** #1653: each attempt resends the whole file, so a list that is this stale gives up instead of retrying on. */
export const FREE_NAME_ATTEMPTS = 10;
export async function uploadUnderFreeName<T>(name: string, taken: { name: string }[], upload: (name: string) => Promise<T>): Promise<{ name: string; result: T }> {
  const refused: { name: string }[] = [];
  for (let attempt = 0; attempt < FREE_NAME_ATTEMPTS; attempt++) {
    const candidate = uniqueName(name, [...taken, ...refused]);
    try { return { name: candidate, result: await upload(candidate) }; }
    catch (err) {
      if ((err as { code?: string } | null)?.code !== 'sourceExists') throw err;
      refused.push({ name: candidate });
    }
  }
  // The code is what the interface translates (upload.noFreeName); the English message is for logs.
  throw Object.assign(new Error(`Every numbered copy of ${name} is already taken`), { code: 'noFreeName' });
}

/**
 * The storage folder name a project gets from its name: a mirror of the server's projectFolderName
 * (noevia-core server/project-folders.cjs), so the web can tell whether a stored folder still matches.
 */
export function storageFolderName(name: string): string {
  return String(name || '').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ').trim().replace(/^\.+|[.\s]+$/g, '').slice(0, 80).replace(/[.\s]+$/g, '') || 'Untitled project';
}

/**
 * True when a project's stored storage folder no longer carries its current name (#1458). Renaming a
 * project does not move the folder: it is fixed at the first upload. Folders made before #1458 were named after
 * the project, so only those can now disagree with its name; newer ones are keyed by the project id. Accepts the WebDAV forms ("Name", "Name (2)") and the S3 form ("Name--<id>").
 */
export function storageFolderKeepsOldName(folder: string, name: string, id: string): boolean {
  const base = folder.split('/').filter(Boolean).pop() ?? '';
  // A folder keyed by the project id (every folder made since #1458) never claims a name, so a rename cannot stale it.
  if (base === storageFolderName(id) || base.startsWith(`${storageFolderName(id)} (`)) return false;
  // #1653: an id longer than 80 characters is keyed as its first 67 characters, '-', then 12 hex of a sha256
  // of the whole id (core projectFolderKey), so the key stays unique. The hash is not recomputed here.
  const whole = String(id || '').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+|[.\s]+$/g, '');
  if (whole.length > 80) {
    const head = whole.slice(0, 67).replace(/[.\s]+$/g, '');
    if (base.startsWith(`${head}-`) && /^[0-9a-f]{12}( \(\d+\))?$/.test(base.slice(head.length + 1))) return false;
  }
  const expected = storageFolderName(name);
  const current = base === expected || base.startsWith(`${expected} (`) || base === `${expected}--${id}`;
  return !current;
}
