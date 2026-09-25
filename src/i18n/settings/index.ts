// Registers the English Settings segment (#286). Imported only by the Settings shell and by
// Customise, so its strings travel in those lazy chunks rather than the first-load bundle. Once
// registered, useT() asks loaders.ts for the interface locale's Settings segment, a fixed map of
// literal build-time imports; until it arrives (or if it fails) each key falls back to English.
import { registerSegment } from '../core';
import { EN_GB_SETTINGS } from './en-GB';
import { EN_US_SETTINGS } from './en-US';

registerSegment('settings', 'en-GB', EN_GB_SETTINGS);
registerSegment('settings', 'en-US', EN_US_SETTINGS);

export const SETTINGS_SEGMENT = 'settings';
