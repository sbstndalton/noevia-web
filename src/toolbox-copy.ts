// #615: the built-in toolsets arrive from the server with English labels and descriptions
// (server/toolboxes.cjs, server/mcp-toolbox-manifest.cjs). The stable box id picks the catalogue
// wording, whether the server calls it builtin or mcp; a third-party box, or a built-in id this build has no wording for, keeps exactly
// what the server sent. Pure and free of React so the tests load it directly.
import type { MessageKey } from './i18n/core';

type Translator = (key: MessageKey) => string;
export interface BoxCopy { id: string; label: string; description: string; source: string; inApp?: boolean }

/** Built-in ids that have a translated description. */
export const TOOLBOX_DESCRIPTION_IDS = [
  'core', 'diary', 'project-docs', 'web-search', 'web-crawl',
  'nextcloud-notes', 'nextcloud-calendar', 'nextcloud-calendar-admin', 'nextcloud-tasks', 'nextcloud-files',
  'nextcloud-file-comments', 'nextcloud-sharing', 'nextcloud-mail', 'nextcloud-mail-send', 'nextcloud-contacts',
  'nextcloud-talk', 'nextcloud-tables', 'nextcloud-deck', 'nextcloud-deck-workflow', 'nextcloud-deck-structure',
  'nextcloud-deck-notes', 'nextcloud-collectives', 'nextcloud-collectives-admin', 'nextcloud-news', 'nextcloud-cookbook',
  'offline-wikipedia', 'gdrive', 'code',
] as const;
/** Labels that are product names ("Nextcloud Notes") have no label key and stay as they are. */
export const TOOLBOX_LABEL_IDS = [
  'core', 'diary', 'project-docs', 'web-search', 'web-crawl', 'nextcloud-calendar-admin', 'nextcloud-file-comments',
  'nextcloud-mail-send', 'nextcloud-deck-workflow', 'nextcloud-deck-structure', 'nextcloud-deck-notes', 'nextcloud-collectives-admin',
  'offline-wikipedia', 'code',
] as const;

/** An in-app box (#615): built in, or one the server flags `inApp` — the diary, project documents,
 *  web and Nextcloud toolsets arrive as `source: "mcp"` because an MCP server backs them, but they
 *  ship with noevia and have stable ids. Only a box without either mark (a third party's own) keeps
 *  exactly the name the server sent. */
export const isInAppBox = (box: Pick<BoxCopy, 'source' | 'inApp'>): boolean => box.inApp ?? (box.source === 'builtin' || box.source === 'code');

export function toolboxCopy(t: Translator, box: BoxCopy): { label: string; description: string } {
  if (!isInAppBox(box)) return { label: box.label, description: box.description };
  return {
    label: (TOOLBOX_LABEL_IDS as readonly string[]).includes(box.id) ? t(`toolbox.label.${box.id}` as MessageKey) : box.label,
    description: (TOOLBOX_DESCRIPTION_IDS as readonly string[]).includes(box.id) ? t(`toolbox.desc.${box.id}` as MessageKey) : box.description,
  };
}

/** Reason codes the server sends beside its English `reason` for an unavailable box or tool
 *  (server/toolboxes-permitted.cjs REASONS). A code this build has no wording for keeps the text. */
export const TOOL_REASON_CODES = [
  'connect', 'signIn', 'diaryOff', 'blocked', 'notConnected',
  'codeNeedsCowork', 'codeAdminOnly', 'codeOff', 'codeNeedsProject', 'codeNoRepository',
] as const;
/** The coding harness's own tools, worded by name. */
export const CODE_TOOL_NAMES = ['read_repository', 'edit_file', 'execute_command'] as const;

/** Why a box or tool is unavailable, in the interface language. */
export function toolReasonText(t: Translator, reasonCode: string | null | undefined, reason: string | null): string | null {
  if (reasonCode && (TOOL_REASON_CODES as readonly string[]).includes(reasonCode)) return t(`tools.reason.${reasonCode}` as MessageKey);
  return reason;
}

/** A tool row's description: the coding harness's fixed tools come from the catalogue, every other
 *  tool keeps the server's own wording (MCP servers write theirs). */
export function toolDescriptionText(t: Translator, boxId: string, inApp: boolean, name: string, description: string): string {
  return boxId === 'code' && inApp && (CODE_TOOL_NAMES as readonly string[]).includes(name) ? t(`toolbox.tool.${name}` as MessageKey) : description;
}
