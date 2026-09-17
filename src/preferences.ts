// Presentation preferences: chat font, density and motion.
//
// Per-device on purpose. The theme syncs through the profile because people
// expect their palette to follow them; how dense YOU want this screen depends
// on the screen, so it is stored locally and applied before paint by
// public/theme.js — the same reason the theme is restored there.
//
// `noevia:` keys because the cowork-* storage keys are frozen compatibility
// contracts (AGENTS.md) and these are new.

export const PREFERENCES = {
  chatFont: { key: 'noevia:chat-font', attribute: 'data-chat-font', values: ['sans', 'serif', 'mono'] as const },
  density: { key: 'noevia:density', attribute: 'data-density', values: ['comfortable', 'compact'] as const },
  motion: { key: 'noevia:motion', attribute: 'data-motion', values: ['system', 'reduced'] as const },
};

export type PreferenceName = keyof typeof PREFERENCES;
export type PreferenceValue<N extends PreferenceName> = typeof PREFERENCES[N]['values'][number];

export function readPreference<N extends PreferenceName>(name: N): PreferenceValue<N> {
  const spec = PREFERENCES[name];
  const fallback = spec.values[0] as PreferenceValue<N>;
  // The attribute is the truth in the page: theme.js already resolved storage
  // once, and reading it back keeps a blocked-storage session consistent.
  const live = document.documentElement.getAttribute(spec.attribute);
  if ((spec.values as readonly string[]).includes(live || '')) return live as PreferenceValue<N>;
  try {
    const saved = localStorage.getItem(spec.key);
    if ((spec.values as readonly string[]).includes(saved || '')) return saved as PreferenceValue<N>;
  } catch { /* unavailable storage: use the default */ }
  return fallback;
}

export function writePreference<N extends PreferenceName>(name: N, value: PreferenceValue<N>): void {
  const spec = PREFERENCES[name];
  if (!(spec.values as readonly string[]).includes(value)) return;
  document.documentElement.setAttribute(spec.attribute, value);
  try { localStorage.setItem(spec.key, value); } catch { /* applies for this session only */ }
}
