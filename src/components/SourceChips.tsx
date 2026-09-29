import type { JSX } from 'react';
import type { ProjectFile, SourceRef } from '../types';
import { sourceChips } from '../source-chips';
import { useT } from '../i18n';

/** "Sources: note-a.md, note-b.md" under a project reply (#552). Each chip is a real button, so it
 *  is reachable and activated from the keyboard, and opens that file in the project's Sources tab. */
export function SourceChips({ sources, files, onOpen }: {
  sources?: SourceRef[];
  files?: Pick<ProjectFile, 'name'>[];
  onOpen?: (file: string) => void;
}): JSX.Element | null {
  const t = useT();
  const chips = sourceChips(sources, files);
  if (!chips.length) return null;
  return (
    <div className="reply-sources" role="group" aria-label={t('chat.sources.label')}>
      <span className="reply-sources-label" aria-hidden="true">{t('chat.sources.label')}</span>
      <ul className="reply-sources-list">
        {chips.map((c) => (
          <li key={c.file}>
            {c.available && onOpen ? (
              <button type="button" className="chip reply-source-chip" title={c.snippet || c.file}
                aria-label={t('chat.sources.open', { name: c.label })} onClick={() => onOpen(c.file)}>
                <span className="reply-source-name">{c.label}</span>
              </button>
            ) : (
              <span className="chip reply-source-chip is-gone" title={t('chat.sources.gone', { name: c.label })}>
                <span className="reply-source-name">{c.label}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
