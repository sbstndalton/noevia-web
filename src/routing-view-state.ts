/** What the Settings → Routing tab should show, decided as a pure function so it has its own
 *  test (#191): "Auto has no models assigned yet" was rendered while `info` was still null — a
 *  round trip through the model manager, not a local read — because `!info?.configured` is true
 *  both for "not configured" and for "not loaded yet". */
export type RoutingViewState = 'loading' | 'error' | 'configured' | 'unconfigured';

export function routingViewState(info: { configured: boolean } | null, error: string): RoutingViewState {
  if (error) return 'error';
  if (info === null) return 'loading';
  return info.configured ? 'configured' : 'unconfigured';
}
