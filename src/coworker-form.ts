// The coworker settings form (sbstndalton/noevia#2446), pure: limits, validation, what changed, and what happens to the
// person's edits when the record turns out to have changed elsewhere (409 `stale_revision`).
import type { Specialist, SpecialistFields } from './specialists-api';

export const COWORKER_NAME_MAX = 60;
export const COWORKER_BRIEF_MAX = 8000;
export const COWORKER_GLYPH_MAX = 16;

/** The tints a coworker may have: design-token names (src/styles/system/tokens.css `--md-<name>`). '' is the default. */
export const TINTS = ['primary', 'secondary', 'tertiary', 'success', 'warning', 'info'] as const;
export type Tint = (typeof TINTS)[number];
export const tintOf = (value: string): Tint => (TINTS as readonly string[]).includes(value) ? value as Tint : 'secondary';

/** A few glyphs to start from; the field takes anything up to the limit. */
export const GLYPHS = ['✨', '🔎', '✍️', '📚', '🧭', '🛠️', '📊', '🗂️', '💡', '🧪', '🌱', '🎯'] as const;

export const countChars = (text: string): number => [...text].length;
/** What a coworker with no glyph shows: the first letter of its name. */
export const glyphOf = (c: { glyph: string; name: string }): string => c.glyph.trim() || ([...c.name.trim()][0] ?? '?').toUpperCase();

export type FormProblem = 'name-empty' | 'name-long' | 'brief-long' | 'glyph-long';

export function formProblems(f: SpecialistFields): FormProblem[] {
  const out: FormProblem[] = [];
  const name = countChars(f.name.trim());
  if (name === 0) out.push('name-empty'); else if (name > COWORKER_NAME_MAX) out.push('name-long');
  if (countChars(f.brief) > COWORKER_BRIEF_MAX) out.push('brief-long');
  if (countChars(f.glyph.trim()) > COWORKER_GLYPH_MAX) out.push('glyph-long');
  return out;
}

export const fieldsOf = (s: Specialist): SpecialistFields => ({
  name: s.name, glyph: s.glyph, tint: s.tint, brief: s.brief, spaces: [...s.spaces], defaultSpace: s.defaultSpace,
  ...(s.toolboxes ? { toolboxes: [...s.toolboxes] } : {}),
});

export const blankFields = (): SpecialistFields => ({ name: '', glyph: '', tint: '', brief: '', spaces: [], defaultSpace: null });

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The default Space must be one of the granted ones; revoking it falls back to the first granted, or none. */
export function withGrants(f: SpecialistFields, spaces: string[]): SpecialistFields {
  const defaultSpace = f.defaultSpace && spaces.includes(f.defaultSpace) ? f.defaultSpace : spaces[0] ?? null;
  return { ...f, spaces, defaultSpace };
}

/** A grant to a Space that no longer exists is dropped before saving (the server refuses unknown ids). */
export function pruneGrants(f: SpecialistFields, known: ReadonlySet<string>): SpecialistFields {
  return withGrants(f, f.spaces.filter((id) => known.has(id)));
}

/** Only what differs from `base` (trimmed text), or null when nothing does. */
export function changesFrom(base: SpecialistFields, draft: SpecialistFields): Partial<SpecialistFields> | null {
  const out: Partial<SpecialistFields> = {};
  if (draft.name.trim() !== base.name) out.name = draft.name.trim();
  if (draft.glyph.trim() !== base.glyph) out.glyph = draft.glyph.trim();
  if (draft.tint !== base.tint) out.tint = draft.tint;
  if (draft.brief !== base.brief) out.brief = draft.brief;
  if (!sameList(draft.spaces, base.spaces)) out.spaces = draft.spaces;
  if (draft.defaultSpace !== base.defaultSpace) out.defaultSpace = draft.defaultSpace;
  if (draft.toolboxes && base.toolboxes && !sameList(draft.toolboxes, base.toolboxes)) out.toolboxes = draft.toolboxes;
  return Object.keys(out).length ? out : null;
}

export interface FormState { base: { revision: number; fields: SpecialistFields }; draft: SpecialistFields }

/** The record changed elsewhere (409): reload it as the new base and keep what the person typed. Their edits (the fields
 *  that differ from the base they started from) are laid over the fresh record, so a field they did not touch takes the
 *  newer value and nothing they changed is lost; where both changed the same field, theirs stays. */
export function afterStale(state: FormState, fresh: { revision: number; specialist: Specialist }): FormState {
  const freshFields = fieldsOf(fresh.specialist);
  const mine = changesFrom(state.base.fields, state.draft) ?? {};
  const draft: SpecialistFields = { ...freshFields, ...mine };
  return { base: { revision: fresh.revision, fields: freshFields }, draft: mine.spaces || mine.defaultSpace !== undefined ? withGrants(draft, draft.spaces) : draft };
}
