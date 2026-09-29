import type { SkillPin } from './api-contract';

/** The only shape a persisted pin may take (#571): `skill_<32 hex>@<sha256>`. The server re-checks
 *  the same shape before storing a transcript (chat-sources.cjs). */
export const STORED_PIN = /^skill_[a-f0-9]{32}@[a-f0-9]{64}$/;

/** The persistable form of the pin a message was sent with, or undefined when it has none or is
 *  not exact (a label-only pin cannot be replayed faithfully, so nothing is stored for it). */
export type StoredPin = `skill_${string}@${string}`;
export function storablePin(pin: SkillPin | string | undefined | null): StoredPin | undefined {
  let text = '';
  if (typeof pin === 'string') text = pin;
  else if (pin && typeof pin === 'object' && typeof pin.id === 'string') {
    const digest = /^[a-f0-9]{64}$/.test(pin.version || '') ? pin.version : pin.contentHash;
    if (digest) text = `${pin.id}@${digest}`;
  }
  return STORED_PIN.test(text) ? (text as StoredPin) : undefined;
}
