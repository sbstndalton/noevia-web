// Errors the Diary's local-folder code throws for a limit (#640). The thrower keeps its English
// sentence as the message (a caller that only reads `.message` still gets a sentence) and attaches
// the limit's stable code and raw numbers as `limit`; the screen words it in the interface language
// with the locale's own byte units. The throwers (diary-workspace.ts, diary-local-recovery.ts) carry
// no imports because their tests load them in isolation, so the shape is a plain property.
import type { MessageKey } from './i18n/core';
import { formatBinaryBytes } from './number-format';

export type DiaryLimit = { code: 'nesting' | 'items' | 'folder' | 'fileTooLarge' | 'recovery'; params: Record<string, number> };
type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

/** What to show for an error caught around the local Diary folder: the limit sentence in the
 *  interface language, or the error's own message. */
export function diaryErrorText(t: Translator, error: unknown, locale: string | undefined): string {
  const limit = (error as { limit?: DiaryLimit } | null)?.limit;
  if (limit && typeof limit.code === 'string' && limit.params) {
    const p = limit.params, bytes = (n: number) => formatBinaryBytes(n, locale);
    switch (limit.code) {
      case 'nesting': return t('diary.limit.nesting', { levels: p.levels });
      case 'items': return t('diary.limit.items');
      case 'folder': return t('diary.limit.folder', { files: p.files, file: bytes(p.fileBytes), total: bytes(p.totalBytes) });
      case 'fileTooLarge': return t('diary.limit.fileTooLarge', { limit: bytes(p.limitBytes) });
      case 'recovery': return t('diary.limit.recovery', { limit: bytes(p.limitBytes) });
    }
  }
  return error instanceof Error ? error.message : String(error);
}
