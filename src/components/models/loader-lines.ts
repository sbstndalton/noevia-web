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
): { key: string; text: string }[] {
  const engine = (b: LoaderBackend) => t('mm.recover.engineIndex', { index: backends.indexOf(b) + 1 });
  if (unhealthy.length) {
    return unhealthy.map((b) => ({
      key: b.name,
      text: `${engine(b)}: ${b.probe_error ? describeError(b.probe_error) : b.last_restart_error || b.status}`,
    }));
  }
  return backends.map((b) => ({
    key: b.name,
    text: b.loaded_model
      ? t('mm.recover.runningWith', { engine: engine(b), model: b.loaded_model })
      : t('mm.recover.running', { engine: engine(b) }),
  }));
}
