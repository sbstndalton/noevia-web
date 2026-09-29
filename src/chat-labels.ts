// Chat chrome the app itself writes into a reply (#626): the sender label of an Auto-routed or
// stopped reply. The stored label stays the compact English token (reply telemetry and saved chats
// read it), and this puts the interface language on it when it is drawn. Pure and free of React.
import type { MessageKey } from './i18n/core';
import { toolboxCopy } from './toolbox-copy';

type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

const ROUTES = ['fast', 'smart', 'code'] as const;

/** "Auto (fast)" -> "Auto (Schnell)"; "Stopped" -> "Gestoppt"; any other label (a model name) as it is. */
export function senderLabelText(t: Translator, label: string): string {
  const bare = label.replace(/^Assistant · /, '');
  const auto = /^Auto \((\w+)\)$/.exec(bare);
  if (auto) {
    const route = (ROUTES as readonly string[]).includes(auto[1]) ? t(`chat.route.name.${auto[1]}` as MessageKey) : auto[1];
    return t('chat.route.auto', { route });
  }
  if (bare === 'Stopped') return t('chat.stopped.sender');
  return bare;
}

/** The "Using:" list of a reply (#624): each toolbox named by its stable id in the interface
 *  language, joined the way the server joined the English labels. */
export function toolScopeText(t: Translator, boxes: { id: string; label: string; inApp?: boolean }[]): string {
  return boxes.map((b) => toolboxCopy(t, { id: b.id, label: b.label, description: '', source: 'mcp', inApp: b.inApp }).label).join(', ');
}
