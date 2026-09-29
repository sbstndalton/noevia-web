import type { ProjectFile, SourceRef } from './types';

export interface SourceChip {
  /** The project file's name, which is its key in the project. */
  file: string;
  /** What the chip says: the file's own name, not the folder path it was synced from. */
  label: string;
  /** The first passage used from this file, for the tooltip. */
  snippet: string;
  /** False once the file has left the project; the chip then explains instead of opening. */
  available: boolean;
}

/** The last path segment, so a synced or renamed-folder path never shows as a source's name. */
export function displayName(name: string): string {
  return name.split('/').filter(Boolean).pop() || name;
}

/** One chip per file, in the order the passages were used. */
export function sourceChips(sources: SourceRef[] | undefined, files: Pick<ProjectFile, 'name'>[] | undefined): SourceChip[] {
  const have = new Set((files ?? []).map((f) => f.name));
  const seen = new Set<string>();
  const chips: SourceChip[] = [];
  for (const s of sources ?? []) {
    if (!s || typeof s.file !== 'string' || seen.has(s.file)) continue;
    seen.add(s.file);
    chips.push({ file: s.file, label: displayName(s.file), snippet: s.snippet || '', available: have.has(s.file) });
  }
  return chips;
}
