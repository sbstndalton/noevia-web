// #1542: a project name such as "QA Haiku 20261012-0610" wrapped at the hyphen inside its identifier, so
// the number split over two lines and read as two names. A hyphen between two letters or digits gets a
// WORD JOINER after it, which forbids a line break there; the name still wraps at its spaces, and a
// word too long for its box still breaks (overflow-wrap is unchanged). For display only: the stored
// name, the title tooltip and anything compared or sent keep the original text.

const HYPHEN_BETWEEN_WORD_CHARS = /([A-Za-z0-9])-(?=[A-Za-z0-9])/g;
const WORD_JOINER = '⁠';

export function keepIdentifiersWhole(text: string): string {
  return text.replace(HYPHEN_BETWEEN_WORD_CHARS, `$1-${WORD_JOINER}`);
}
