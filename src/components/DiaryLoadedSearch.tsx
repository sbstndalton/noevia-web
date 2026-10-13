import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { searchLoadedDays, type LoadedDays } from '../diary-loaded-search';
import { useT } from '../i18n';

/** #1453: finds text in the Diary days this session has already loaded. Nothing is requested from the
 *  server and nothing is stored: the query lives in this component and the results only on screen. */
export function DiaryLoadedSearch({ loaded, onOpen }: { loaded: LoadedDays; onOpen: (day: string) => void }): JSX.Element {
  const t = useT();
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchLoadedDays(loaded, query), [loaded, query]);
  const searching = query.trim().length > 0;
  return <section className="diary-loaded-search" role="search" aria-label={t('diary.search.label')}>
    <input type="search" value={query} placeholder={t('diary.search.placeholder')} aria-label={t('diary.search.label')}
      aria-describedby="diary-loaded-search-scope" onChange={(event) => setQuery(event.target.value)} />
    <p id="diary-loaded-search-scope" className="diary-context-note">{t('diary.search.scope')}</p>
    {searching && (hits.length
      ? <ul className="diary-loaded-search-hits" aria-label={t('diary.search.results')}>
          {hits.map((hit) => <li key={hit.day}>
            <button type="button" className="diary-loaded-search-hit" onClick={() => onOpen(hit.day)}>
              <time dateTime={hit.day}>{hit.day}</time>
              <span>{hit.snippet}</span>
            </button>
          </li>)}
        </ul>
      : <p role="status">{t('diary.search.none')}</p>)}
  </section>;
}
