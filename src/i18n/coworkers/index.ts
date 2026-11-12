// Registers the Coworkers and Spaces segment (sbstndalton/noevia#2446): English and every other locale. Imported only by the Spaces
// and Coworkers views, so the strings travel in their lazy chunks rather than the first-load bundle. Unlike the other segments the
// non-English catalogues are imported here, not loaded on demand through loaders.ts, because noevia-core's i18n test only allows
// dynamic imports for the segments it lists (see loaders.ts). A key a locale lacks still falls back to English one at a time.
import { registerSegment } from '../core';
import { EN_GB_COWORKERS } from './en-GB';
import { EN_US_COWORKERS } from './en-US';
import { DE_DE_COWORKERS } from './de-DE';
import { ES_ES_COWORKERS } from './es-ES';
import { FR_FR_COWORKERS } from './fr-FR';
import { IT_IT_COWORKERS } from './it-IT';
import { NB_NO_COWORKERS } from './nb-NO';
import { NL_NL_COWORKERS } from './nl-NL';
import { PT_BR_COWORKERS } from './pt-BR';
import { SV_SE_COWORKERS } from './sv-SE';

const ALL = {
  'en-GB': EN_GB_COWORKERS, 'en-US': EN_US_COWORKERS, 'de-DE': DE_DE_COWORKERS, 'es-ES': ES_ES_COWORKERS, 'fr-FR': FR_FR_COWORKERS,
  'it-IT': IT_IT_COWORKERS, 'nb-NO': NB_NO_COWORKERS, 'nl-NL': NL_NL_COWORKERS, 'pt-BR': PT_BR_COWORKERS, 'sv-SE': SV_SE_COWORKERS,
};
for (const [locale, catalogue] of Object.entries(ALL)) registerSegment('coworkers', locale, catalogue);
