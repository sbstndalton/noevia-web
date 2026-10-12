import { apiFetch } from './api';

/** #1471: download one chat as a Markdown file (GET /api/chats/:id/export). The same download the
 *  Settings export uses: the server's Content-Disposition names the file, and a failure throws the
 *  server's own sentence when it has one. */
export async function downloadChatExport(chatId: string): Promise<string> {
  const response = await apiFetch(`/api/chats/${encodeURIComponent(chatId)}/export`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({} as { error?: string }));
    throw Error((body as { error?: string }).error || `Export failed (${response.status})`);
  }
  if (!response.headers.get('content-type')?.startsWith('text/markdown')) throw Error('Export failed: the server sent something other than a chat.');
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || 'noevia-chat.md';
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  return name;
}
