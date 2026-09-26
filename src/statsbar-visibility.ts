// #365: the bottom inference status bar belongs to chats only. It used to render on every view
// (Customise, Settings, Archived, Models & routing, Diary) because the gate only asked "is this
// chat empty with no telemetry yet", never "is this a chat at all" — which is also why it overlapped
// Diary's calendar header, the last child of the same shared `.app-stack.pane` column.
//
// Pure and framework-free so it is unit-testable without mounting App.tsx (which needs a live
// SSE stream, workspace fetches and a browser DOM to render at all).
export function shouldShowStatsBar(viewKind: string, messageCount: number, hasTelemetry: boolean): boolean {
  if (viewKind !== 'chat') return false;
  // A blank chat shows no row of unavailable metrics; they return with the first reply (#239).
  if (messageCount === 0 && !hasTelemetry) return false;
  return true;
}
