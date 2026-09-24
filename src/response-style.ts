// The response style as the model will see it (#229). Mirrors server/account-instructions.cjs
// phrase for phrase so Settings can preview exactly what is sent; tests/response-style.test.cjs
// fails if the two drift apart.
export type Preset = 'default' | 'concise' | 'detailed';
export type AdvancedKey = 'length' | 'tone' | 'formatting' | 'emoji';
export type Advanced = Record<AdvancedKey, string>;
export type StyleSettings = { style: Preset; advanced: Advanced; language: string; text: string };

export const PRESETS: Record<Preset, string | null> = {
  default: null,
  concise: 'Keep replies short and direct: lead with the answer, skip preamble, and expand only when asked.',
  detailed: 'Be thorough: explain reasoning, cover edge cases and give examples where they help.',
};

export const ADVANCED: Record<AdvancedKey, { label: string; options: [string, string][]; phrases: Record<string, string> }> = {
  length: { label: 'Answer length', options: [['auto', 'Auto'], ['short', 'Short'], ['long', 'Long']], phrases: { short: 'Prefer brief answers, a few sentences where possible.', long: 'Prefer complete, longer answers.' } },
  tone: { label: 'Tone', options: [['auto', 'Auto'], ['casual', 'Casual'], ['formal', 'Formal']], phrases: { casual: 'Use a relaxed, conversational tone.', formal: 'Use a formal, professional tone.' } },
  formatting: { label: 'Headings and lists', options: [['auto', 'Auto'], ['minimal', 'Plain'], ['structured', 'Structured']], phrases: { minimal: 'Write in plain paragraphs; avoid headings and bullet lists unless asked.', structured: 'Organise longer answers with headings and bullet lists.' } },
  emoji: { label: 'Emoji', options: [['auto', 'Auto'], ['none', 'None'], ['some', 'Some']], phrases: { none: 'Do not use emoji.', some: 'An occasional emoji is fine where it fits.' } },
};

export const ADVANCED_DEFAULT: Advanced = { length: 'auto', tone: 'auto', formatting: 'auto', emoji: 'auto' };

export function styleLines(s: Pick<StyleSettings, 'style' | 'advanced' | 'language'>): string[] {
  const language = s.language.trim();
  return [
    PRESETS[s.style],
    ...(Object.keys(ADVANCED) as AdvancedKey[]).map((key) => ADVANCED[key].phrases[s.advanced[key]] ?? null),
    language ? `Reply in ${language} unless the user writes in or asks for another language.` : null,
  ].filter((line): line is string => !!line);
}

/** True when nothing about the style differs from the defaults (the Reset button's state). */
export function isDefaultStyle(s: Pick<StyleSettings, 'style' | 'advanced' | 'language'>): boolean {
  return s.style === 'default' && !s.language.trim() && (Object.keys(ADVANCED) as AdvancedKey[]).every((k) => s.advanced[k] === 'auto');
}

/** Any saved record (including one from before the advanced controls) as a complete one. */
export function normaliseStyle(value: unknown): Omit<StyleSettings, 'text'> {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const a = (v.advanced && typeof v.advanced === 'object' ? v.advanced : {}) as Record<string, unknown>;
  const advanced = { ...ADVANCED_DEFAULT };
  for (const key of Object.keys(ADVANCED) as AdvancedKey[]) if (typeof a[key] === 'string' && ADVANCED[key].options.some(([id]) => id === a[key])) advanced[key] = a[key] as string;
  return { style: v.style === 'concise' || v.style === 'detailed' ? v.style : 'default', advanced, language: typeof v.language === 'string' ? v.language : '' };
}
