// Interface-language helpers shared by the model manager panels (#293). The pure rules in
// guided.ts stay in English for their tests; these map their ids to message keys.
import type { MessageKey, Translate } from '../../i18n';
import type { Role } from './guided';

export const ROLE_KEY: Record<Role, MessageKey> = { chat: 'mm.role.chat', vision: 'mm.role.vision', routing: 'mm.role.routing', embedding: 'mm.role.embedding', rerank: 'mm.role.rerank' };

const STUCK_STATUS: Record<string, MessageKey> = { failed: 'mm.status.failed', interrupted: 'mm.status.interrupted', cancelled: 'mm.status.cancelled', running: 'mm.status.running', 'running for over 2 hours': 'mm.status.stale' };
/** A recovery item's status (guided.ts recoveryItems) in the interface language. */
export const stuckStatus = (t: Translate, status: string) => (STUCK_STATUS[status] ? t(STUCK_STATUS[status]) : status);

const BENCH_STATUS: Record<string, MessageKey> = {
  idle: 'mm.bench.status.idle', starting: 'mm.bench.status.starting', running: 'mm.bench.status.running', cancelling: 'mm.bench.status.cancelling',
  done: 'mm.bench.status.done', cancelled: 'mm.bench.status.cancelled', error: 'mm.bench.status.error',
};
/** A benchmark job's or run's status word from the service, in the interface language (#597). An
 *  unknown status is shown as the service sent it. */
export const benchStatus = (t: Translate, status: string) => (BENCH_STATUS[status] ? t(BENCH_STATUS[status]) : status);

const SPEC_KEY: Record<string, MessageKey> = {
  off: 'mm.spec.off', mtp: 'mm.spec.mtp', 'mtp-deep': 'mm.spec.mtp-deep', 'mtp-shallow': 'mm.spec.mtp-shallow', ngram: 'mm.spec.ngram',
};
/** The drafting choice a tune settled on. The tune records its stable `spec` id next to the English
 *  label, so the id is translated and the label stays the fallback for an id this build does not
 *  know (#598). */
export const specLabel = (t: Translate, spec: string | undefined, label: string | undefined) => (spec && SPEC_KEY[spec] ? t(SPEC_KEY[spec]) : label || '');

const PROBE: Record<string, MessageKey> = { arithmetic: 'mm.autotune.probe.arithmetic', extraction: 'mm.autotune.probe.extraction', reasoning: 'mm.autotune.probe.reasoning' };
/** An auto-tune quality probe's stable id (#328) in the interface language; an unknown id stays as sent. */
export const probeName = (t: Translate, id: string) => (PROBE[id] ? t(PROBE[id]) : id);
