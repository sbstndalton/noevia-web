// The coworker settings form (sbstndalton/noevia#2446), pure: limits, validation, what changed, and what happens to the
// person's edits when the record turns out to have changed elsewhere (409 `stale_revision`).
//
// The rule that a coworker's default Space is one of the Spaces it is granted (`spaceIds` / `spaceId`) follows
// CopilotKit/OpenDots@46eaf96c9e3802adc972ceafd8f20f99bda34e70, src/client/WorkspaceDialog.tsx (MIT, Copyright (c) Atai Barkai;
// adapted from there, see also CoworkerSettings.tsx). The upstream notice follows.
//   The MIT License
//   Copyright (c) Atai Barkai
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
//   associated documentation files (the "Software"), to deal in the Software without restriction,
//   including without limitation the rights to use, copy, modify, merge, publish, distribute,
//   sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions: The above copyright notice and this
//   permission notice shall be included in all copies or substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
//   NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
import type { Specialist, SpecialistFields } from './specialists-api';

export const COWORKER_NAME_MAX = 60;
export const COWORKER_BRIEF_MAX = 8000;
export const COWORKER_GLYPH_MAX = 16;

/** The tints a coworker may have: design-token names (src/styles/system/tokens.css `--md-<name>`). '' is the default. */
export const TINTS = ['primary', 'secondary', 'tertiary', 'success', 'warning', 'info'] as const;
export type Tint = (typeof TINTS)[number];
export const tintOf = (value: string): Tint => (TINTS as readonly string[]).includes(value) ? value as Tint : 'secondary';

/** A few glyphs to start from: plain symbols that every system font draws the same way; the field takes anything up to the limit (an emoji too). */
export const GLYPHS = ['✦', '✎', '❖', '◆', '●', '▲', '★', '☾', '☀', '♥', '⚑', '✿'] as const;

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

/** The default Space must be one of the granted ones. "None" (null) is a choice and stays null; a default that is no longer
 *  granted falls back to the first granted Space, or to none. */
export function withGrants(f: SpecialistFields, spaces: string[]): SpecialistFields {
  const defaultSpace = f.defaultSpace === null ? null : spaces.includes(f.defaultSpace) ? f.defaultSpace : spaces[0] ?? null;
  return { ...f, spaces, defaultSpace };
}

/** A grant to a Space that no longer exists is dropped before saving (the server refuses unknown ids). */
export function pruneGrants(f: SpecialistFields, known: ReadonlySet<string>): SpecialistFields {
  return withGrants(f, f.spaces.filter((id) => known.has(id)));
}

/** Granting the first Space makes it the default (so a new grant is usable at once); later changes leave the default alone. */
export function toggleGrant(f: SpecialistFields, spaceId: string): SpecialistFields {
  const on = f.spaces.includes(spaceId);
  const spaces = on ? f.spaces.filter((x) => x !== spaceId) : [...f.spaces, spaceId];
  const next = withGrants(f, spaces);
  return !on && f.spaces.length === 0 && f.defaultSpace === null ? { ...next, defaultSpace: spaceId } : next;
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

/** A list the person edited (Spaces, tools), merged as a change, not as a replacement: what they added is added to the fresh list and
 *  what they removed is removed from it, so another tab's different change to the same list is kept. */
function mergeList(base: readonly string[], mine: readonly string[], fresh: readonly string[]): string[] {
  const removed = new Set(base.filter((x) => !mine.includes(x)));
  const added = mine.filter((x) => !base.includes(x));
  return [...fresh.filter((x) => !removed.has(x)), ...added.filter((x) => !fresh.includes(x))];
}

/** The record changed elsewhere (409): reload it as the new base and keep what the person typed. Their edits (the fields that differ
 *  from the base they started from) are laid over the fresh record, so a field they did not touch takes the newer value and nothing
 *  they changed is lost; where both changed the same text field, theirs stays; Spaces and tools merge as added/removed ids. */
export function afterStale(state: FormState, fresh: { revision: number; specialist: Specialist }): FormState {
  const freshFields = fieldsOf(fresh.specialist);
  const mine = changesFrom(state.base.fields, state.draft) ?? {};
  const merged: SpecialistFields = { ...freshFields, ...mine };
  if (mine.spaces) merged.spaces = mergeList(state.base.fields.spaces, mine.spaces, freshFields.spaces);
  if (mine.toolboxes && state.base.fields.toolboxes) merged.toolboxes = mergeList(state.base.fields.toolboxes, mine.toolboxes, freshFields.toolboxes ?? []);
  return { base: { revision: fresh.revision, fields: freshFields }, draft: mine.spaces || mine.defaultSpace !== undefined ? withGrants(merged, merged.spaces) : merged };
}

/** Anything typed that a close would throw away. */
export function isDirty(base: SpecialistFields, draft: SpecialistFields): boolean { return changesFrom(base, draft) !== null; }
