/**
 * Whether an approval decision clicked in the UI still targets the approval actually live on
 * the server. `liveApprovalId` is read at click time (from a ref updated on every poll), not
 * at the render that drew the button — a poll can land between the two and move the task on to
 * a different approval (or resolve it) while the stale card is still on screen mid-click.
 *
 * Sending a decision for an id that has moved on either double-decides the same approval (if a
 * click somehow fires twice) or answers the wrong one, so the caller must skip and refresh
 * instead of forwarding it to decideTask().
 */
export function isDecisionStale(liveApprovalId: string | undefined | null, clickedApprovalId: string): boolean {
  return liveApprovalId !== clickedApprovalId;
}
