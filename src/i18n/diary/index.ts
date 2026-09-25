// Registers the English Diary segment (issue #285/#289). Imported only by
// DiaryView, so its strings travel in that lazy chunk rather than the first-load
// bundle. Once registered, useT() asks loaders.ts for the interface locale's Diary
// segment, a fixed map of literal build-time imports; until it arrives (or if it fails) each key
// falls back to English.
import { registerSegment } from '../core';
import { EN_GB_DIARY } from './en-GB';
import { EN_US_DIARY } from './en-US';

registerSegment('diary', 'en-GB', EN_GB_DIARY);
registerSegment('diary', 'en-US', EN_US_DIARY);

export const DIARY_SEGMENT = 'diary';
