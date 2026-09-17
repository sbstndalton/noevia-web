// One vocabulary for Auto routing wherever it appears. Mirrors server
// classifyFastOrSmart / heuristicWantsSmart; update both together.
export const ROLE_LABEL: Record<'fast' | 'smart' | 'vision', string> = {
  fast: 'Fast — quick answers',
  smart: 'Smart — harder questions',
  vision: 'Vision — reads images (optional)',
};

export const AUTO_EXPLAINED = [
  'Long messages, code, several numbers, or requests for detail ("step by step", "in detail", word counts) go straight to Smart.',
  'Anything else gets a one-word check by the Fast model, which picks Fast or Smart.',
  'If that check fails or is unclear, Fast answers — Auto never blocks a message.',
  'When a message has images and Vision is set, Vision describes them first and the chosen model answers from the description.',
];

export function roleSummary(roles: { fast?: string; smart?: string; vision?: string } | null | undefined): string {
  if (!roles) return 'not configured';
  return [`Fast: ${roles.fast || 'not set'}`, `Smart: ${roles.smart || 'not set'}`, ...(roles.vision ? [`Vision: ${roles.vision}`] : [])].join(' · ');
}
