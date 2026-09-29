// #613: the model manager describes why a backend has no readings or no probe answer in short
// English phrases (`stats.error`, `probe_error`). They are the service's own state names, so the
// interface maps each known one to a catalogue id and words it in the interface language; anything
// it does not recognise ("sampler error: …", a Docker exception) is shown as the service sent it.
// Pure and free of React so the tests load it directly.
import type { MessageKey } from '../../i18n/core';

type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

const CONTAINER_STATES = ['exited', 'created', 'paused', 'restarting', 'dead', 'removing'] as const;

const EXACT: Record<string, MessageKey> = {
  'docker unreachable': 'mm.hw.err.dockerUnreachable',
  'container not found': 'mm.hw.err.containerNotFound',
  'warming up…': 'mm.hw.err.warmingUp',
  'warming up...': 'mm.hw.err.warmingUp',
  'port unknown': 'mm.hw.err.portUnknown',
  'connection refused': 'mm.hw.err.connectionRefused',
  'timeout': 'mm.hw.err.timeout',
  'request failed': 'mm.hw.err.requestFailed',
  'invalid response': 'mm.hw.err.invalidResponse',
  'not reachable from the model loader (Docker reports it healthy)': 'mm.hw.err.unreachableHealthy',
};

/** The id of a known state ("container.exited", "http"), or null for an unknown message. */
export function backendErrorId(message: string | null | undefined): string | null {
  if (!message) return null;
  if (Object.hasOwn(EXACT, message)) return EXACT[message].slice('mm.hw.err.'.length);
  const container = /^container is (\w+)$/.exec(message);
  if (container && (CONTAINER_STATES as readonly string[]).includes(container[1])) return `container.${container[1]}`;
  if (/^HTTP \d{3}$/.test(message)) return 'http';
  return null;
}

export function describeBackendError(t: Translator, message: string | null | undefined): string {
  if (!message) return '';
  const id = backendErrorId(message);
  if (id === null) return message;
  if (id === 'http') return t('mm.hw.err.http', { status: message.slice(5) });
  return t(`mm.hw.err.${id}` as MessageKey);
}
