// #1628 (and #1527): the wide engine-metrics popover opens above the composer, never over it. It used to
// sit `bottom: 100%` of the strip under the composer, which is the composer's whole height, so it covered
// the composer's controls and the send button. This is the pure geometry: the popover's bottom edge sits
// just above the composer block's top edge, and it may be no taller than the room above that edge. It is
// out of flow, so the composer does not move while it is open (#1548).
export const ANCHOR_GAP = 8;
export const ANCHOR_MIN_HEIGHT = 96;

export interface AnchorAbove {
  /** Distance from the strip's bottom edge to the popover's bottom edge (px, CSS `bottom`). */
  bottom: number;
  /** The most the popover may be tall (px, CSS `max-height`), so it scrolls rather than reaching the composer. */
  maxHeight: number;
}

/** Positions for a popover that must end `ANCHOR_GAP` px above `composerTop`, given the strip's bottom edge.
 *  Returns null when either edge is not a real number, so the caller keeps the stylesheet's default. */
export function anchorAboveComposer(stripBottom: number, composerTop: number): AnchorAbove | null {
  if (!Number.isFinite(stripBottom) || !Number.isFinite(composerTop)) return null;
  return {
    bottom: Math.max(0, Math.round(stripBottom - composerTop + ANCHOR_GAP)),
    maxHeight: Math.max(ANCHOR_MIN_HEIGHT, Math.floor(composerTop - ANCHOR_GAP * 2)),
  };
}
