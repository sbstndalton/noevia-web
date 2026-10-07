# Motion layer (#951)

Springs for everything physical, built on [Motion](https://motion.dev) (npm `motion`, MIT)
through its **vanilla** API (`animate` from `"motion"`), never the React components. That
keeps it framework-neutral, so a future Rust/WASM frontend can call the same functions.

## How it is driven

`startMotion()` (called once from `src/main.tsx`) observes the DOM and animates by selector
and state. Nothing in a component has to know about it:

| Trigger | Animation |
|---|---|
| a menu (`.ctx-menu`, `.account-popover`, `.popup`, `.composer-actions-panel`, `.tool-catalogue-panel`, `[role="menu"]`) is added | scale .97 → 1 and a fade from the trigger side; critically damped, about 140ms |
| a dialog (`dialog[open]`, `.aero`, `[data-motion="dialog"]`) is added | scale .98 → 1 and a fade; critically damped, about 220ms |
| a toast (`.save-error`, `[data-motion="toast"]`) is added | rises 12px and fades in; critically damped |
| a single new `.msg[data-role="user"]` at the end of the transcript | scale .92 / y 6px → rest, origin bottom right, light bounce |
| chips (`.reply-source-chip`, `.composer-context-chips > *`, `.frame-chips > *`) are added | scale .8 → 1 and a fade, staggered 50ms + 30ms per sibling (max 8) |
| a single sidebar row is added | height and opacity from 0 |
| `.sidebar` gains or loses `.is-collapsed` | the tile's width springs between the two sizes (about 240ms); main follows |
| `.glass-switch[aria-checked]` changes | the knob springs 16px with a light bounce |
| pointer down on `.btn`, `.modal-btn`, `.send-btn`, `.glass.is-press`, `[data-motion="press"]` | springs to .97, then settles back on release |

A framework only calls `enter(el, kind)` and `exit(el, kind)`. Both return promises, so an
exit can finish before the element is removed. Settings uses them: `SettingsShell` unmounts
the window once `exit()` resolves.

## Rules

- Exits name only targets, never a `from`, so an exit started mid-enter continues from the
  current value with the spring's velocity. Nothing jumps.
- Only `transform` and `opacity` animate, plus `width` on the sidebar tile.
- Hover and focus colour changes stay CSS transitions (60–150ms); loops stay CSS keyframes
  (`styles/system/motion.css`).
- Reduced motion (`prefers-reduced-motion` or `html[data-motion="reduced"]`) means no
  springs: dialogs and toasts get a 100–120ms fade, and everything else changes at once.
- `window.noeviaMotion` exposes `{ enter, exit, growIn, reducedMotion }` for other code and
  for the browser QA (`qa/ui-redo-951.cjs`).
