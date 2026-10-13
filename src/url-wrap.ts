// #1613: a long address (an AI provider's base URL) has no break point in Chrome's line breaking
// until the box is too narrow for it, and then `overflow-wrap: anywhere` cuts it at an arbitrary
// character ("…/chat/comple" / "tions"). These are the places a person would break it by hand: after a
// path slash, dot, hyphen, underscore, query separator or "@", never inside the "//" after the scheme.
// The text itself is unchanged; the component puts a <wbr> between the parts, so copying the address
// still gives the address.
const AFTER = /(?<=[/.\-_?&=#@])(?!\/)/;

export function urlParts(text: string): string[] {
  return text.split(AFTER).filter((part) => part.length > 0);
}
