// Text shown on the approval card must read exactly as it will act (#648). Unicode bidi embedding,
// override and isolate controls (U+202A–U+202E, U+2066–U+2069) and the direction marks
// (U+200E, U+200F) are invisible but reorder what follows, so a file name carrying one could make
// `notes.md` display as something else, or make the path read in a different order. They are
// shown as visible escapes, e.g. `<U+202E>`, wherever the card prints a name, path or argument.
const DIRECTION_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

export function showDirectionControls(text: string): string {
  return String(text).replace(DIRECTION_CONTROLS, (c) => `<U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}>`);
}
