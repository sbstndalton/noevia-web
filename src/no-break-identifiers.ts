// #1542: a project name such as "QA Haiku 20261012-0610" wrapped at the hyphen inside its identifier, so
// the number split over two lines and read as two names. A hyphen between two word characters with a
// digit on either side is part of an identifier, so it gets a WORD JOINER after it, which forbids a line
// break there. Plain hyphenated words (proj-synthetic-identifier-long-hyphenated-name) keep their hyphen
// breaks: joining every hyphen made the whole name one unbreakable word, which then broke mid-word
// ("identifi/er", "na/me") at narrow widths. The name still wraps at its spaces, and a word too long for
// its box still breaks (overflow-wrap is unchanged). For display only: the stored
// name, the title tooltip and anything compared or sent keep the original text.

const HYPHEN_BETWEEN_WORD_CHARS = /([A-Za-z0-9])-(?=[A-Za-z0-9])/g;
const WORD_JOINER = '⁠';

const DIGIT = /[0-9]/;

export function keepIdentifiersWhole(text: string): string {
  return text.replace(HYPHEN_BETWEEN_WORD_CHARS, (match: string, before: string, offset: number, whole: string) => {
    const after = whole.charAt(offset + 2);
    return DIGIT.test(before) || DIGIT.test(after) ? `${before}-${WORD_JOINER}` : match;
  });
}
