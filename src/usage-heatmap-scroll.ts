// #1538: the Usage activity heat map is a horizontal scroll box whose right-hand end holds the latest
// weeks. It used to open at the left (the oldest months), so Aug to Oct were off-screen. Pure, so the
// tests load it directly; UsageView calls it once the grid is in the page.
export type ScrollBox = { scrollLeft: number; scrollWidth: number; clientWidth: number };

/** Scrolls the box to its right-hand end, where the most recent days are. A box whose content fits
 *  has nothing to scroll and stays at 0. */
export function revealLatestWeeks(box: ScrollBox): void {
  box.scrollLeft = Math.max(0, box.scrollWidth - box.clientWidth);
}
