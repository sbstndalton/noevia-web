// #1545: the Recover panel's "Model loader" status, one line per engine. The model manager names each
// engine with its container name (an internal service name), so a person sees "Engine 1" or "Engine 2"
// instead; the loaded model's name is shown whole. Pure and free of React so the tests load it directly.
import type { MessageKey, Params } from '../../i18n/core';

type Translator = (key: MessageKey, params?: Params) => string;

export type LoaderBackend = {
  name: string;
  status: string;
  loaded_model: string | null;
  probe_error: string | null;
  last_restart_error: string | null;
};

const CONTAINER_STATES = ['exited', 'created', 'paused', 'restarting', 'dead', 'removing'];

/** #1545 review: what is wrong with one engine, in the interface language. The service's raw text
 *  (a Docker exception naming an internal container, an English status word) never reaches the row;
 *  `describeError` hands back a message it does not recognise unchanged, so an unchanged (or empty)
 *  answer counts as unknown here. */
function problem(t: Translator, b: LoaderBackend & { found?: boolean }, describeError: (probeError: string) => string): string {
  if (b.probe_error) { const known = describeError(b.probe_error); if (known && known !== b.probe_error) return known; }
  if (b.last_restart_error) return t('mm.recover.restartFailed');
  if (b.found === false) return t('mm.hw.err.containerNotFound');
  if (CONTAINER_STATES.includes(b.status)) return t(`mm.hw.err.container.${b.status}` as MessageKey);
  if (b.status !== 'running') return t('mm.recover.notRunning');
  return t('mm.recover.engineProblem');
}

/** The lines for a non-empty list of engines. `unhealthy` is the subset that needs attention (the
 *  caller decides what that is); when any do, only those are listed, as the panel always has. */
export function loaderLines(
  t: Translator,
  backends: LoaderBackend[],
  unhealthy: LoaderBackend[],
  describeError: (probeError: string) => string,
): { key: string; text: string; model?: string }[] {
  const engine = (b: LoaderBackend) => t('mm.recover.engineIndex', { index: backends.indexOf(b) + 1 });
  if (unhealthy.length) {
    return unhealthy.map((b) => ({
      key: b.name,
      text: `${engine(b)}: ${problem(t, b, describeError)}`,
    }));
  }
  return backends.map((b) => ({
    key: b.name,
    ...(b.loaded_model ? { model: b.loaded_model } : {}),
    text: b.loaded_model
      ? t('mm.recover.runningWith', { engine: engine(b), model: b.loaded_model })
      : t('mm.recover.running', { engine: engine(b) }),
  }));
}

/** How long the Recover panel waits for one of its reads before it shows that read as unavailable
 *  (#1545: a model-manager read that never answered left the panel on "Checking…" for good). */
export const RECOVER_READ_TIMEOUT_MS = 12_000;

/** `promise`, or `fallback` once `ms` pass without an answer (or when it rejects). The timer is
 *  cleared when the promise settles first; `onTimeout` runs when the wait gives up, so the caller can
 *  abort the request instead of leaving it hanging. */
export function within<T, F>(promise: Promise<T>, ms: number, fallback: F, onTimeout?: () => void): Promise<T | F> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { onTimeout?.(); resolve(fallback); }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

/** #1545 review: one Recover check at a time. `start()` aborts the previous run's requests and returns
 *  the new run's signal, `abort()` (for its own timeout, after which it still writes its fallbacks)
 *  and an `isCurrent()` test; a run that was superseded (or stopped) must not write over a newer one. */
export function recoverRuns(): { start: () => { signal: AbortSignal; abort: () => void; isCurrent: () => boolean }; stop: () => void } {
  let run = 0;
  let controller: AbortController | null = null;
  return {
    start() {
      controller?.abort();
      const mine = ++run;
      const own = new AbortController();
      controller = own;
      return { signal: own.signal, abort: () => own.abort(), isCurrent: () => mine === run };
    },
    stop() { controller?.abort(); controller = null; run++; },
  };
}
