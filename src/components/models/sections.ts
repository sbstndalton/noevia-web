// #1008: Settings → Models & routing has four sections instead of eight tabs. Pure, so the old →
// new map is unit-tested (tests/client/models-sections-1008.test.cjs) without mounting React.
import type { MessageKey } from '../../i18n';

export type Tab = 'models' | 'routing' | 'performance' | 'advanced';
/** The eight tabs before #1008. */
export type LegacyTab = 'overview' | 'yours' | 'discover' | 'routing' | 'projects' | 'hardware' | 'benchmarks' | 'prompts';
/** The panels inside a section that open on demand. */
export type Panel = 'status' | 'budget' | 'benchmarks' | 'hardware' | 'prompts' | 'projects';
export type ModelList = 'installed' | 'discover';
export interface SectionTarget { tab: Tab; panel?: Panel; list?: ModelList }

// Models is what is installed and what can be downloaded; Routing is everything that decides which
// model answers (including the ChatGPT connection); Performance is measuring and fitting; Advanced
// holds what few people change.
export const MODEL_SECTIONS: [Tab, MessageKey][] = [['models', 'mm.section.models'], ['routing', 'mm.section.routing'], ['performance', 'mm.section.performance'], ['advanced', 'mm.section.advanced']];

/** Where each old tab now lives. Every setting the old tabs had is reachable from here. */
export const LEGACY_TABS: Record<LegacyTab, SectionTarget> = {
  overview: { tab: 'performance', panel: 'status' },
  yours: { tab: 'models', list: 'installed' },
  discover: { tab: 'models', list: 'discover' },
  routing: { tab: 'routing' },
  projects: { tab: 'advanced', panel: 'projects' },
  hardware: { tab: 'performance', panel: 'hardware' },
  benchmarks: { tab: 'performance', panel: 'benchmarks' },
  prompts: { tab: 'advanced', panel: 'prompts' },
};

/** The section to open for a saved id: a section id, an old tab id saved before #1008, or Models. */
export function savedSection(saved: string | null | undefined): SectionTarget {
  if (saved && MODEL_SECTIONS.some(([id]) => id === saved)) return { tab: saved as Tab };
  if (saved && Object.prototype.hasOwnProperty.call(LEGACY_TABS, saved)) return LEGACY_TABS[saved as LegacyTab];
  return { tab: 'models' };
}
