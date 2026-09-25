// Registers the English Customise segment (issue #293). Imported only by PluginsView, so its
// strings travel in the Customise lazy chunk rather than the first-load bundle. Once registered,
// useT() asks loaders.ts for the interface locale's Customise segment, a fixed map of literal
// build-time imports; until it arrives (or if it fails) each key falls back to English.
import { registerSegment } from '../core';
import { EN_GB_CUSTOMISE } from './en-GB';
import { EN_US_CUSTOMISE } from './en-US';

registerSegment('customise', 'en-GB', EN_GB_CUSTOMISE);
registerSegment('customise', 'en-US', EN_US_CUSTOMISE);

export const CUSTOMISE_SEGMENT = 'customise';
