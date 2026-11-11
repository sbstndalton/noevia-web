// noevia#2136: what the Models page says when the server refuses to load, unload or delete a model. The server's own
// sentence is English; a refusal it labels with a known `code` reads in the interface language instead.
import type { MessageKey } from './i18n';

/** The refusal codes the local model's queue (the inference gate) and the model-in-use check send, and the words for each. */
const REFUSALS: Record<string, MessageKey> = {
  model_in_use: 'mm.library.inUseRetry',
  inference_queue_timeout: 'mm.library.gateRefused',
  inference_queue_full: 'mm.library.gateRefused',
  gate_busy: 'mm.library.gateRefused',
  engine_switch_stuck: 'chat.failure.engineSwitchStuck',
  engine_unavailable: 'chat.failure.engineUnavailable',
  engine_busy: 'chat.failure.engineBusy',
};

type Say = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The sentence for a refusal with a known code, or null (the caller shows the server's text for any other). */
export function refusalText(err: unknown, say: Say, model: string): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(REFUSALS, code)) return null;
  return say(REFUSALS[code], { model });
}
