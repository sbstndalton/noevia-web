// Registers the English model manager segment (#293). Imported only by ModelManagerPage, the
// lazy root of the model manager chunk, so its strings travel in that chunk rather than the
// first-load bundle; every panel below the page relies on it having registered them. Once
// registered, useT() asks loaders.ts for the interface locale's model manager segment, a fixed
// map of literal build-time imports; until it arrives (or if it fails) each key falls back to
// English.
import { registerSegment } from '../core';
import { EN_GB_MODELS } from './en-GB';
import { EN_US_MODELS } from './en-US';

registerSegment('models', 'en-GB', EN_GB_MODELS);
registerSegment('models', 'en-US', EN_US_MODELS);

export const MODELS_SEGMENT = 'models';
