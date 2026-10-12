// Why the Settings > Status "Live engine" figures have no value (#1485). The figures are dashes when
// there is nothing to show, and dashes alone read as broken: a plain sentence says whether the poll
// has no reading yet, the engine is not answering, or it is idle (no speed reported).
import type { LiveStats } from './types';
import type { MessageKey } from './i18n/core';

export function liveEngineNote(t: (key: MessageKey) => string, stats: LiveStats | null): string | null {
  if (stats === null) return t('serviceStatus.noReading');
  if (!stats.up) return t('serviceStatus.notResponding');
  return stats.tokensPerSecond == null ? t('serviceStatus.idle') : null;
}
