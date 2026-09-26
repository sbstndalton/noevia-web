/** The tools-catalogue panel's focus-out contract, pulled out as plain functions so
 *  tests/tool-catalogue-focus.test.cjs can exercise them without a real DOM. */

/** Whether the panel should close because focus left it. `root` wraps both the trigger and the
 *  panel, so a relatedTarget it contains (the search input, the trigger) keeps the panel open;
 *  anything else — including `null`, when nothing else can take focus — closes it. */
export function shouldClosePanelOnBlur(
  root: { contains(node: Node | null): boolean } | null,
  relatedTarget: Node | null,
): boolean {
  return !(root?.contains(relatedTarget) ?? false);
}

/** A mouse press on a non-focusable row (`<li role="option">`) blurs the currently focused
 *  search input by default — focus has nowhere else to go, so it lands on `<body>` with
 *  `relatedTarget` `null`, and `shouldClosePanelOnBlur` (correctly) reads that as focus leaving,
 *  closing the panel before the row's own click fires (regression found in review of #345).
 *  Preventing the mousedown's default keeps focus on the input, so no blur — and no premature
 *  close — happens at all; the click that follows still runs normally. */
export function keepFocusOnMouseDown(event: { preventDefault(): void }): void {
  event.preventDefault();
}
