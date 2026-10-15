import type { ProjectFile, SourceRef } from './types';

export interface SourceChip {
  /** The project file's name, which is its key in the project. */
  file: string;
  /** What the chip says: the shortest tail of the path that tells it from every other file (`readme.md`, or
   *  `docs/readme.md` when two files share a name, #1809), never the whole storage path. */
  label: string;
  /** The full project-relative path, for the tooltip and the accessible name. */
  path: string;
  /** The first passage used from this file, for the tooltip. */
  snippet: string;
  /** False once the file has left the project; the chip then explains instead of opening. */
  available: boolean;
}

/** The last path segment, so a synced or renamed-folder path never shows as a source's name. */
export function displayName(name: string): string {
  return name.split('/').filter(Boolean).pop() || name;
}

/** For each name, the shortest run of trailing path segments that no other name also ends with, so two
 *  `readme.md` files read `readme.md` and `docs/readme.md` while a unique file stays its bare name (#1809).
 *  A name that is itself the tail of another one (the root `readme.md`) keeps its full name. */
export function distinguishingNames(names: string[]): Map<string, string> {
  const all = Array.from(new Set(names.filter((n) => typeof n === 'string' && n)));
  const out = new Map<string, string>();
  for (const name of all) {
    const parts = name.split('/').filter(Boolean);
    let label = name;
    for (let k = 1; k <= parts.length; k++) {
      const tail = parts.slice(-k).join('/');
      if (!all.some((o) => o !== name && (o === tail || o.endsWith('/' + tail)))) { label = tail; break; }
    }
    out.set(name, label);
  }
  return out;
}

/** One chip per file, in the order the passages were used. */
export function sourceChips(sources: SourceRef[] | undefined, files: Pick<ProjectFile, 'name'>[] | undefined): SourceChip[] {
  const have = new Set((files ?? []).map((f) => f.name));
  const seen = new Set<string>();
  const chips: SourceChip[] = [];
  const labels = distinguishingNames([...(files ?? []).map((f) => f.name), ...(sources ?? []).map((s) => s && s.file)]);
  for (const s of sources ?? []) {
    if (!s || typeof s.file !== 'string' || seen.has(s.file)) continue;
    seen.add(s.file);
    chips.push({ file: s.file, label: labels.get(s.file) ?? displayName(s.file), path: s.file, snippet: s.snippet || '', available: have.has(s.file) });
  }
  return chips;
}
