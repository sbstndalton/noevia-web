/** Splits a catalogue sentence around one `{placeholder}` so the value can be markup (a <code>, a
 *  link) while the words stay translatable and in the locale's own order: `[before, after]`.
 *  Ask for the sentence with no parameters, so the placeholder is still in it. A sentence that
 *  lacks the placeholder comes back whole as `before`. */
export function around(text: string, name: string): [string, string] {
  const [before, ...rest] = text.split(`{${name}}`);
  return [before, rest.join(`{${name}}`)];
}
