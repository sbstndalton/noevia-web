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
      text: `${engine(b)}: ${b.probe_error ? describeError(b.probe_error) : b.last_restart_error || b.status}`,
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
 *  cleared when the promise settles first. */
export function within<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}
