// Interface-language helpers shared by the model manager panels (#293). The pure rules in
// guided.ts stay in English for their tests; these map their ids to message keys.
import type { MessageKey, Translate } from '../../i18n';
import type { Role } from './guided';

export const ROLE_KEY: Record<Role, MessageKey> = { chat: 'mm.role.chat', vision: 'mm.role.vision', routing: 'mm.role.routing', embedding: 'mm.role.embedding', rerank: 'mm.role.rerank' };

const STUCK_STATUS: Record<string, MessageKey> = { failed: 'mm.status.failed', interrupted: 'mm.status.interrupted', cancelled: 'mm.status.cancelled', running: 'mm.status.running', 'running for over 2 hours': 'mm.status.stale' };
/** A recovery item's status (guided.ts recoveryItems) in the interface language. */
export const stuckStatus = (t: Translate, status: string) => (STUCK_STATUS[status] ? t(STUCK_STATUS[status]) : status);
