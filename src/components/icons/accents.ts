import type { IconNode } from './lucide';

// Two-tone icons (#1623). A decorative icon (information only: a status, a section or empty-state
// symbol, a type marker beside text) keeps the neutral outline and draws ONE inner part in the
// theme accent; a control (anything you can press) draws the same outline in one neutral colour.
//
// Per glyph, the accent part is either
//   stroke  indices into the glyph's LUCIDE nodes that are stroked in the accent, or
//   fill    extra solid shapes painted in the accent UNDER the outline (a filled inner area, such
//           as a folder's tab), so the outline itself is exactly the control glyph.
// A glyph with no sensible inner part is listed in PLAIN_GLYPHS and stays one colour in both tones.
// Every vendored glyph must be in exactly one of the two tables (tests/client/icon-tones.test.cjs).
export type IconAccent = { stroke?: number[]; fill?: IconNode };

export const ICON_ACCENTS: Record<string, IconAccent> = {
  bell: { stroke: [0] },                          // the clapper
  keyboard: { stroke: [0, 1, 2, 3, 4, 5, 6, 7] }, // the keys and the space bar
  brain: { stroke: [0] },                         // the central fold
  database: { stroke: [2] },                      // the middle band
  archive: { stroke: [2] },                       // the handle slot
  'square-pen': { stroke: [1] },                  // the pen
  'file-text': { stroke: [2, 3, 4] },             // the text lines
  pencil: { stroke: [1] },                        // the ferrule line
  'book-open': { stroke: [0] },                   // the spine
  pin: { stroke: [0] },                           // the needle
  clock: { stroke: [1] },                         // the hands
  compass: { stroke: [1] },                       // the needle
  settings: { stroke: [1] },                      // the hub
  // The tab and lid, as a solid fill under the outline (the outline is one path, so the tab is an
  // area). It runs to y=9.5 so it still reads as a coloured tab at 14-16px on a 1x screen.
  folder: { fill: [['path', { d: 'M12.1 6a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v4.5h20V8a2 2 0 0 0-2-2z' }]] },
  'layout-grid': { stroke: [1] },                 // one cell
  'git-branch': { stroke: [1] },                  // the branch tip
  'panel-left': { stroke: [1] },                  // the divider
  sun: { stroke: [0] },                           // the core
  'shield-check': { stroke: [1] },                // the check
  palette: { stroke: [1, 2, 3, 4] },              // the paint dots
  sparkles: { stroke: [1, 2, 3] },                // the small sparkles
  'notebook-pen': { stroke: [5] },                // the pen
  plug: { stroke: [1, 3] },                       // the prongs
  'chart-column': { stroke: [1, 2, 3] },          // the bars
  map: { stroke: [1, 2] },                        // the folds
  users: { stroke: [1, 2] },                      // the second person
  cpu: { stroke: [13] },                          // the die
  'toggle-right': { stroke: [0] },                // the knob
  'cloud-upload': { stroke: [0, 2] },             // the arrow
  'sliders-horizontal': { stroke: [3, 4, 7] },    // the knobs
  'message-square-plus': { stroke: [1, 2] },      // the plus
  library: { stroke: [0] },                       // the leaning book
  trash: { stroke: [0, 1] },                      // the inner lines
  download: { stroke: [0, 2] },                   // the arrow
  upload: { stroke: [0, 1] },                     // the arrow
  globe: { stroke: [1] },                         // the meridian
  'flask-conical': { stroke: [1] },               // the liquid line
  telescope: { stroke: [6] },                     // the pivot
  inbox: { stroke: [0] },                         // the tray
  'list-checks': { stroke: [3, 4] },              // the checks
  blocks: { stroke: [1] },                        // the detached block
  ban: { stroke: [1] },                           // the slash
  'external-link': { stroke: [0, 1] },            // the arrow
  server: { stroke: [2, 3] },                     // the status lights
  'hard-drive': { stroke: [0, 2, 3] },            // the front panel: divider and lights
  // Empty-state symbols (#1623 follow-up): the plain chat, code and search glyphs have no inner part,
  // so EmptyState draws these variants, whose inner part carries the accent.
  'message-square-text': { stroke: [1, 2, 3] },   // the text lines
  'square-code': { stroke: [0, 1] },              // the brackets
  'search-x': { stroke: [0, 1] },                 // the cross in the lens
};

/** Glyphs that are one shape (or only arrows/marks): no inner part, one colour in both tones. */
export const PLAIN_GLYPHS: readonly string[] = [
  'paperclip', 'wrench', 'message-square', 'code', 'plus', 'search', 'puzzle', 'folder-open', 'arrow-left', 'arrow-right',
  'arrow-up', 'arrow-down', 'x', 'user', 'user-round', 'chevron-down', 'chevron-left', 'chevron-right', 'moon', 'ellipsis',
  'activity', 'lock', 'circle', 'check', 'refresh-cw', 'hand',
];
