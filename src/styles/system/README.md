# noevia design system (#951)

One design system for the web UI, matching the Claude/ChatGPT reference (quiet neutral
surfaces, tight type, small radii, short decelerating motion). It is framework-neutral on
purpose: plain CSS custom properties, plus rules keyed on classes, data-attributes and ARIA
states. Hover and focus colour changes and loops are CSS; springs (dialogs, menus, toasts, messages, chips, switch knob, press, the sidebar tile) live in `src/motion` on Motion's vanilla API, driven by the same classes and attributes. A non-React UI (the
planned Rust/WASM frontend) can load these files unchanged and get the same look by
emitting the same attributes and classes.

| File | Holds |
|---|---|
| `fonts.css` | `@font-face` for the self-hosted variable fonts in `fonts/` (OFL) |
| `themes.css` | the theme families as small token overrides on `[data-family]` |
| `tokens.css` | every colour, type, space, shape and motion token |
| `motion.css` | every `@keyframes`, the `@property` travel parameters, the reduced-motion floor |
| `components.css` | how shared surfaces, controls and Settings look and move |

Load order: `fonts.css`, `tokens.css`, `themes.css`, `motion.css`, then the app's layout sheets, then
`components.css`. (In the React app, `src/main.tsx` imports the older layout sheets between
them and `space-tiers.css` last.)

## Root attributes (set before paint by `public/theme.js`)

| Attribute | Values | Effect |
|---|---|---|
| `data-theme` | `light`, `dark` | the surface ladder; `dark` is the default |
| `data-theme-preference` | `light`, `dark`, `system` | what the person chose |
| `data-palette` | `iris` (blue, default), `warm`, `cool`, `neutral`, `sage` | accent roles only; never surfaces |
| `data-density` | `comfortable`, `compact` | Settings group rhythm |
| `data-motion` | `system`, `reduced` | `reduced` collapses motion like `prefers-reduced-motion` |
| `data-chat-font` | `sans`, `serif`, `mono` | reading font for messages |

| `data-family` | `editorial` (default), `contemporary`, `glass` | theme family: token overrides in `themes.css` |

A saved retired material (`noevia:material`: soft, material, liquid) maps onto Editorial,
Contemporary and Glass before paint.

## Theme families (`themes.css`)

- **Editorial** (default): the Claude reference itself — warm neutral ladder, serif greeting,
  8/12/14px corners, layered surfaces instead of borders. No overrides.
- **Contemporary**: the ChatGPT reference — cool true-grey surfaces (#212121 / white), sans
  greeting, pill buttons, 28px composer, 20px dialogs.
- **Glass**: frosted translucent sidebar, composer, menus and Settings window over a soft
  field of the accent colour; slightly rounder corners; opaque under Reduce transparency.

## Tokens

- Surfaces (dark, the Claude ladder): `--md-surface` #151515 page, `--md-surface-container-low`
  #1a1a19 raised/dialog, `--md-surface-container` #20201f composer/card, `-high` / `-highest`
  hover steps. Light: page #faf9f5 (bg-100), chrome #f5f4ed (bg-200), white cards.
- Text: `--text-primary`, `--text-secondary`, `--text-tertiary` (dark #f0efec / #c3c2b7 / #898781;
  light #141413 / #3d3d3a / #73726c).
- Fills: `--fill-hover` (white 7.5% / black 4.5%), `--fill-active` (white 15% / black 8%);
  hairlines `--hairline`, `--hairline-strong`; `--ring-inset` (1px white 10%).
- Semantic: `--bg-app`, `--bg-chrome`, `--bg-surface`, `--bg-dialog`, `--surface-raised`,
  `--surface-overlay`, `--border-subtle`, `--border-strong`, `--accent-text`, `--focus`,
  `--selected`, `--scrim` (black 50%), `--brand` (logo/spark only), status roles.
- Shadows: `--shadow-pop` (dialogs), `--shadow-popover` (menus).
- Type: `--font-ui` Inter Variable, `--font-display` Source Serif 4 (greeting/display only),
  `--font-mono`; sizes `--text-*` (body 14/20, section labels 13/16, page titles 22/28,
  section headings 15/20); `--weight-title` 580.
- Shape: `--radius-row` / `--radius-button` / `--radius-control` 8px, `--radius-overlay` 10px,
  `--radius-dialog` 12px, `--radius-composer` 14px, `--radius-pill`; `--row-height` 32px.
- Motion: `--dur-instant` 60ms (hover), `--dur-snap` 120ms (switch knob), `--dur-basic` 150ms
  (content dim / fade), `--dur-base` 200ms (dialogs), `--dur-panel` 240ms (sidebar collapse),
  `--dur-spring` 450ms (press squish, sent message), `--dur-pulse` 2s (thinking),
  `--delay-skeleton` 500ms, `--stagger-base` 50ms + `--stagger-step` 30ms (chips);
  curves `--ease-out-quart`, `--ease-out-expo`, `--ease-out-std`, `--ease-snap`,
  `--ease-in-out`, `--ease-overshoot` (small physical controls only), `--spring-press`.
  The older four-purpose contract (`--motion-immediate|quick|considered|async`) maps onto these.

## Tiles

From 520px up, the sidebar and the main area are separate rounded tiles floating on
`--bg-backdrop`, with one `--tile-gutter` (8px) between them and at the window edges. Each tile:
- has a radius of `--radius-tile`: 12px in Editorial, 16px in Contemporary, 20px in Glass;
- clips its content to its corners;
- draws a crisp 1px `--tile-ring` above its content (via `::after`), plus a tight
  `--tile-shadow`.

The surfaces follow the ladder: backdrop, then the sidebar tile (`--bg-chrome`), then the main
tile (`--bg-app`, the top surface). Phones are full-bleed. Collapsing the sidebar springs the
tile's width (see `src/motion`).

## Class and attribute contract

| Hook | Look and motion |
|---|---|
| `.sidebar .nav-item`, `.proj-row`, `.chat-row` | 32px rows, radius 8, padding 0 8px; hover `--fill-hover` in 60ms easeOutQuart; `[aria-current="page"]` / `.is-active` → `--fill-active` |
| `.sidebar.is-collapsed` | history and projects fade and slide 16px; the tile's width springs (src/motion) |
| `.btn`, `.btn-primary`, `.btn-ghost`, `.modal-btn` | 32px, radius 8, quiet fill / accent fill / ghost; pointer press springs to .97 (src/motion) |
| `.glass-switch[aria-checked]` > `.knob` | 36×20 track; the knob springs 16px with a light bounce (src/motion) |
| `.glass-seg` > `button[aria-checked]` + `.glass-thumb` | quiet segmented track, raised thumb |
| `.composer-mode-toggle[data-mode]` | Chat/Cowork thumb slides on the considered token |
| `.composer-inner` | radius 14, padding 8, focus ring fades in 200ms |
| `.ctx-menu`, `.account-popover`, `.popup`, `[role="menu"]` | opens instantly; items highlight with `--fill-hover` |
| `dialog[open]`, `.aero` | spring in from scale .98 with a fade (src/motion); `::backdrop` `--scrim` |
| `.settings-scrim` + `.settings-stage` (`.is-closing`) | Settings window: 1024×800 max, nav 192px on `--bg-chrome`, content `--bg-dialog`, radius `--radius-dialog`, ring + pop shadow; springs in and out (src/motion), unmounting only after the exit; full-screen sheet ≤ 700px |
| `.view-loading` | skeleton/placeholder fades in only after `--delay-skeleton` |
| `.app-main[aria-busy="true"]` | content dims to .6 over 150ms |
| a newly sent `.msg[data-role="user"]` | springs from scale .92 / y 6px, origin bottom right (src/motion) |
| `.reply-source-chip`, `.composer-context-chips > *` | springs in, staggered 50ms + 30ms per sibling, max 8 (src/motion) |
| `.thinking`, `.live-thinking`, `.typing` | opacity .6 ↔ 1 over 2s |
| `.save-error` | inverse-surface toast |

Reduced motion (`prefers-reduced-motion: reduce` or `data-motion="reduced"`) removes every
transition and runs every animation in 1ms (`motion.css`).

Browser proof: `apps/web/qa/ui-redo-951.cjs`.
