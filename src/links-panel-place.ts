// Where the chat Links popover's left edge goes (#1468). It is still anchored to its trigger (right
// edge under the button), but never past the viewport's gutter: at phone width the trigger sits
// mid-bar and a right-anchored 320px panel ran off the left edge, cutting "Linked from" off.
// Returns a viewport x, so the caller can subtract its own containing block's offset.

/** The gutter every popover keeps from the screen edges (the same 16px the drawer and dialogs use). */
export const LINKS_PANEL_GUTTER = 16;

export function linksPanelLeft(opts: { anchorRight: number; panelWidth: number; viewportWidth: number; gutter?: number }): number {
  const gutter = opts.gutter ?? LINKS_PANEL_GUTTER;
  // The right-anchored position, pulled back inside the right gutter, then never left of the left gutter
  // (a panel wider than the viewport lines up with the left gutter rather than running off it).
  const rightFit = Math.min(opts.anchorRight - opts.panelWidth, opts.viewportWidth - gutter - opts.panelWidth);
  return Math.max(gutter, rightFit);
}
