// Chat chrome the app itself writes into a reply (#626): the sender label of an Auto-routed or
// stopped reply. The stored label stays the compact English token (reply telemetry and saved chats
// read it), and this puts the interface language on it when it is drawn. Pure and free of React.
import type { MessageKey } from './i18n/core';
import { toolboxCopy } from './toolbox-copy';

type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

const ROUTES = ['fast', 'smart', 'code'] as const;

/** The compact English label of a not-yet-routed Auto reply (also the composer's model label). */
export const AUTO_PENDING_LABEL = 'Auto (Fast/Smart)';
/** Every language-neutral sender token the app stores or draws: the routed Auto labels, the
 *  pending Auto label and the Stopped token (#626, #643). Each one has a translation. */
export const SENDER_TOKENS: readonly string[] = [...ROUTES.map((r) => `Auto (${r})`), AUTO_PENDING_LABEL, 'Stopped'];

/** "Auto (fast)" -> "Auto (Schnell)"; "Auto (Fast/Smart)" -> "Auto (Schnell/Smart)"; "Stopped" -> "Gestoppt";
 *  any other label (a model name) as it is. */
export function senderLabelText(t: Translator, label: string): string {
  const bare = label.replace(/^Assistant · /, '');
  if (bare === AUTO_PENDING_LABEL) return t('composer.autoFastSmart');
  const auto = /^Auto \((\w+)\)$/.exec(bare);
  if (auto) {
    const route = (ROUTES as readonly string[]).includes(auto[1]) ? t(`chat.route.name.${auto[1]}` as MessageKey) : auto[1];
    return t('chat.route.auto', { route });
  }
  if (bare === 'Stopped') return t('chat.stopped.sender');
  return bare;
}

/** A route role in the interface language ("fast" -> "Schnell"); an id this build does not know stays as it is (#624). */
export function routeRoleName(t: Translator, role: string): string {
  return (ROUTES as readonly string[]).includes(role) ? t(`chat.route.name.${role}` as MessageKey) : role;
}

/** The catalogue's text for a key, or the fallback when the key is not in the catalogue. */
function byKey(t: Translator, key: string, fallback: string): string {
  const text = t(key as MessageKey);
  return text === key ? fallback : text;
}

/** The "Effort: high · provider parameter" line of a reply, in the interface language (#624). */
export function effortLineText(t: Translator, effort: string | undefined, mode: string): string {
  return t('chat.effort.line', {
    effort: byKey(t, `chat.effort.value.${effort ?? ''}`, effort ?? ''),
    basis: mode === 'real' ? t('chat.effort.real') : t('chat.effort.hint'),
  });
}

/** The in-progress line of a reply. The server sends a stable id with its English text; the id is
 *  worded from the catalogue and the English stays as the fallback for an id this build lacks (#624). */
export function statusLineText(t: Translator, id: string | undefined, text: string | undefined): string {
  return id ? byKey(t, `chat.statusId.${id}`, text ?? '') : text ?? '';
}

/** The Stopped placeholder (#634). A reply the user stopped before any text arrived is saved with
 *  the language-neutral sender token `Stopped` and NO body; the body is worded here, when drawn, in
 *  the interface language. Before #634 the translated sentence itself was saved as the body, in
 *  whichever language was active at Stop, so those stored rows are recognised (by their exact text,
 *  in any locale) and worded the same way. Editing a catalogue string means keeping the old one here. */
export const STOPPED_SENDER = 'Stopped';
export const LEGACY_STOPPED_BODIES: readonly string[] = [
  'Stopped before a reply was written.',
  'Gestoppt, bevor eine Antwort geschrieben wurde.',
  'Detenido antes de escribir una respuesta.',
  'Arrêté avant l’écriture d’une réponse.',
  'Interrotto prima che venisse scritta una risposta.',
  'Stoppet før et svar ble skrevet.',
  'Gestopt voordat er een antwoord was geschreven.',
  'Interrompido antes de escrever uma resposta.',
  'Stoppad innan något svar skrevs.',
];

type BodyMessage = { role?: string; senderLabel?: string; content: string; error?: boolean; reasoning?: string };

/** True for an assistant reply that is only the Stopped placeholder (the new empty form, or a stored sentence). */
export function isStoppedPlaceholder(m: BodyMessage): boolean {
  if (m.role !== 'assistant' || m.error || m.reasoning || m.senderLabel?.replace(/^Assistant · /, '') !== STOPPED_SENDER) return false;
  return !m.content || LEGACY_STOPPED_BODIES.includes(m.content.trim());
}

/** The text a message body shows: the placeholder in the interface language, or the message's own text. */
export function messageBodyText(t: Translator, m: BodyMessage): string {
  return isStoppedPlaceholder(m) ? t('chat.stopped.content') : m.content;
}

/** #658: the note on a reply that ended after tool steps had run, saying what was saved. Step
 *  supervision pausing is not a failure, and a reply that failed after saving a change still
 *  saved it; the note says so in the interface language. */
export function pausedNoteText(t: Translator & { plural: (key: string, count: number, params?: Record<string, string | number>) => string },
  pause: { reason: 'supervision' | 'stopped' | 'declined'; applied: number; declined?: string[] }, formatCount: (n: number) => string = String): string {
  const count = formatCount(pause.applied);
  if (pause.reason === 'declined') {
    // #666: the person declined a write, so the reply ended with no model text. Tool names are
    // shown as the card showed them.
    const tools = (pause.declined || []).join(', ');
    // No tool name to show (a malformed event or saved entry): the same facts in general words.
    if (!tools) return pause.applied > 0 ? t.plural('chat.paused.stoppedApplied', pause.applied, { count }) : t('chat.paused.declinedNone');
    return pause.applied > 0 ? t.plural('chat.paused.declinedApplied', pause.applied, { count, tools }) : t('chat.paused.declined', { tools });
  }
  if (pause.reason === 'supervision') {
    return pause.applied > 0 ? t.plural('chat.paused.supervisionApplied', pause.applied, { count }) : t('chat.paused.supervision');
  }
  return t.plural('chat.paused.stoppedApplied', pause.applied, { count });
}

/** The "Using:" list of a reply (#624): each toolbox named by its stable id in the interface
 *  language, joined the way the server joined the English labels. */
export function toolScopeText(t: Translator, boxes: { id: string; label: string; inApp?: boolean }[]): string {
  return boxes.map((b) => toolboxCopy(t, { id: b.id, label: b.label, description: '', source: 'mcp', inApp: b.inApp }).label).join(', ');
}
