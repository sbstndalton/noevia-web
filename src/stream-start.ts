/** The start time of the reply being streamed (#644). It is taken fresh on the render where `streaming`
 *  turns on and kept while it stays on, so the elapsed counter does not restart as tokens arrive. Taking
 *  it in an effect instead ran after the first streaming render had painted, which drew the time since
 *  the view mounted ("1 min") for one frame before it reset to 0 s. Pure so the rule can be tested. */
export function nextStreamStart(wasStreaming: boolean, streaming: boolean, start: number, now: number): number {
  return streaming && !wasStreaming ? now : start;
}
