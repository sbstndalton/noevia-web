// Registers the English Coworkers and Spaces segment (sbstndalton/noevia#2446). Imported only by
// the Spaces and Coworkers views, so its strings travel in their lazy chunks rather than the
// first-load bundle. Once registered, useT() asks loaders.ts for the interface locale's segment;
// until it arrives (or if it fails) each key falls back to English.
import { registerSegment } from '../core';
import { EN_GB_COWORKERS } from './en-GB';
import { EN_US_COWORKERS } from './en-US';

registerSegment('coworkers', 'en-GB', EN_GB_COWORKERS);
registerSegment('coworkers', 'en-US', EN_US_COWORKERS);
