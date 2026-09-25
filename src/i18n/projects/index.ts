// Registers the English Projects segment (issue #285/#289). Imported only by
// ProjectsView, so its strings travel in that lazy chunk rather than the first-load
// bundle. Once registered, useT() asks loaders.ts for the interface locale's Projects
// segment, a fixed map of literal build-time imports; until it arrives (or if it fails) each key
// falls back to English.
import { registerSegment } from '../core';
import { EN_GB_PROJECTS } from './en-GB';
import { EN_US_PROJECTS } from './en-US';

registerSegment('projects', 'en-GB', EN_GB_PROJECTS);
registerSegment('projects', 'en-US', EN_US_PROJECTS);

export const PROJECTS_SEGMENT = 'projects';
