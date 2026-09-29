// #615: the built-in toolsets arrive from the server with English labels and descriptions
// (server/toolboxes.cjs, server/mcp-toolbox-manifest.cjs). The stable box id picks the catalogue
// wording; a third-party MCP box, or a built-in id this build has no wording for, keeps exactly
// what the server sent. Pure and free of React so the tests load it directly.
import type { MessageKey } from './i18n/core';

type Translator = (key: MessageKey) => string;
export interface BoxCopy { id: string; label: string; description: string; source: string }

/** Built-in ids that have a translated description. */
export const TOOLBOX_DESCRIPTION_IDS = [
  'core', 'diary', 'project-docs', 'web-search', 'web-crawl',
  'nextcloud-notes', 'nextcloud-calendar', 'nextcloud-calendar-admin', 'nextcloud-tasks', 'nextcloud-files',
  'nextcloud-file-comments', 'nextcloud-sharing', 'nextcloud-mail', 'nextcloud-mail-send', 'nextcloud-contacts',
  'nextcloud-talk', 'nextcloud-tables', 'nextcloud-deck', 'nextcloud-deck-workflow', 'nextcloud-deck-structure',
  'nextcloud-deck-notes', 'nextcloud-collectives', 'nextcloud-collectives-admin', 'nextcloud-news', 'nextcloud-cookbook',
] as const;
/** Labels that are product names ("Nextcloud Notes") have no label key and stay as they are. */
export const TOOLBOX_LABEL_IDS = [
  'core', 'diary', 'project-docs', 'web-search', 'web-crawl', 'nextcloud-calendar-admin', 'nextcloud-file-comments',
  'nextcloud-mail-send', 'nextcloud-deck-workflow', 'nextcloud-deck-structure', 'nextcloud-deck-notes', 'nextcloud-collectives-admin',
] as const;

export function toolboxCopy(t: Translator, box: BoxCopy): { label: string; description: string } {
  if (box.source !== 'builtin') return { label: box.label, description: box.description };
  return {
    label: (TOOLBOX_LABEL_IDS as readonly string[]).includes(box.id) ? t(`toolbox.label.${box.id}` as MessageKey) : box.label,
    description: (TOOLBOX_DESCRIPTION_IDS as readonly string[]).includes(box.id) ? t(`toolbox.desc.${box.id}` as MessageKey) : box.description,
  };
}
