// How long a reply thought (#1575). A reply can think in several stretches: one before each tool call, and
// one more before the answer. Each stretch runs from its first thought to the moment the answer or a tool
// call takes over; the reply's figure is the sum, so it matches the thinking the person watched.

export interface ThinkingClock {
  /** A thought arrived. Starts a stretch unless one is already running. */
  start(): void;
  /** The answer or a tool call took over. Closes the running stretch and returns the total so far in ms,
   *  or undefined when no stretch was open (so callers do not write state on every token). */
  stop(): number | undefined;
}

export function createThinkingClock(now: () => number = () => performance.now()): ThinkingClock {
  let since: number | null = null;
  let total = 0;
  return {
    start() { if (since === null) since = now(); },
    stop() {
      if (since === null) return undefined;
      total += now() - since;
      since = null;
      return Math.round(total);
    },
  };
}
