// One Space's pages: grid or list, search, new page. Library layout and toolbar adapted from
// CopilotKit/OpenDots@46eaf96c9e3802adc972ceafd8f20f99bda34e70, src/client/SpaceLibrary.tsx
// (MIT, Copyright (c) Atai Barkai; notice in src/page-autosave.ts). Search is the server's
// (title and content, case-folded, at most 200 characters) rather than a client-side filter.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useT } from '../../i18n';
import '../../i18n/coworkers';
import { appLocale } from '../../user-preferences';
import { formatBytes } from '../../number-format';
import { PAGE_LIST_LIMIT, PAGE_SEARCH_MAX, searchQuery } from '../../spaces-limits';
import { pageName, relativeTime } from '../../spaces-format';
import { createPage, listPages, SpacesError, type PageRow, type Space } from '../../spaces-api';
import { EmptyState } from '../EmptyState';
import { ShellIcon } from '../ShellIcon';
import { SpaceActions } from './SpaceActions';

const LAYOUT_KEY = 'noevia:spaces-layout';
const readLayout = (): 'grid' | 'list' => { try { return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } };
const SEARCH_DELAY_MS = 300;

export function SpacePages({ space, revision, reloadSpaces, onBack, onOpenPage, onDeleted }: {
  space: Space; revision: number; reloadSpaces: () => void;
  onBack: () => void; onOpenPage: (pageId: string, fresh: boolean) => void; onDeleted: () => void;
}): JSX.Element {
  const t = useT();
  const [layout, setLayout] = useState<'grid' | 'list'>(readLayout);
  const [raw, setRaw] = useState('');
  const [typed, setTyped] = useState('');
  const [rows, setRows] = useState<PageRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState<'load' | 'search' | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const search = searchQuery(typed);
  const q = search.kind === 'ok' ? search.q : '';

  useEffect(() => { heading.current?.focus(); }, [space.id]);
  // The box is debounced; the request below follows the debounced text.
  useEffect(() => { const id = setTimeout(() => setTyped(raw), SEARCH_DELAY_MS); return () => clearTimeout(id); }, [raw]);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // Over the limit: nothing is sent (the server would answer 400 and the screen would read it as "no match").
    if (search.kind === 'too-long') { setFailed(null); return; }
    const controller = new AbortController();
    setFailed(null);
    listPages(space.id, { q: q || undefined, limit: PAGE_LIST_LIMIT, signal: controller.signal })
      .then((r) => { setRows(r.pages); setTruncated(r.truncated); })
      .catch(() => { if (!controller.signal.aborted) setFailed(q ? 'search' : 'load'); });
    return () => controller.abort();
  }, [space.id, q, search.kind, attempt]);

  const setLayoutAndKeep = (next: 'grid' | 'list') => { setLayout(next); try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* the choice just does not persist */ } };
  const newPage = useCallback(async () => {
    setCreating(true); setCreateError('');
    try { const page = await createPage(space.id, t('spaces.untitled')); onOpenPage(page.id, true); }
    catch (e) { setCreateError(e instanceof SpacesError && e.code === 'page_limit' ? t('spaces.pageLimit') : t('spaces.actionFailed')); setCreating(false); }
  }, [space.id, onOpenPage, t]);

  const searching = search.kind !== 'none';
  const loading = rows === null && failed === null && search.kind !== 'too-long';
  const shown = search.kind === 'too-long' ? [] : rows ?? [];
  const when = (ts: number) => relativeTime(ts, appLocale());

  return (
    <main className="main spaces-workspace">
      <div className="settings-scroll">
        <nav className="space-crumbs" aria-label={t('spaces.breadcrumb')}>
          <button type="button" className="btn btn-secondary space-back" onClick={onBack}><ShellIcon name="arrow-left" size={16} /><span>{t('spaces.backToSpaces')}</span></button>
        </nav>
        <div className="settings-title space-title-row">
          <h1 ref={heading} tabIndex={-1}>{space.name}</h1>
          <SpaceActions space={space} revision={revision} reload={reloadSpaces} onDeleted={onDeleted} />
        </div>
        <div className="space-tools">
          <label className="space-search">
            <ShellIcon name="search" size={16} tone="decorative" />
            <input ref={searchBox} type="search" aria-label={t('spaces.searchLabel')} placeholder={t('spaces.searchPlaceholder')} value={raw}
              aria-invalid={search.kind === 'too-long'} aria-describedby={search.kind === 'too-long' ? 'space-search-limit' : undefined}
              onChange={(e) => setRaw(e.target.value)} />
          </label>
          <div className="seg space-layout" role="group" aria-label={t('spaces.layoutLabel')}>
            <button type="button" className={layout === 'grid' ? 'is-selected' : ''} aria-pressed={layout === 'grid'} aria-label={t('spaces.viewGrid')} title={t('spaces.viewGrid')} onClick={() => setLayoutAndKeep('grid')}><ShellIcon name="grid" size={16} /></button>
            <button type="button" className={layout === 'list' ? 'is-selected' : ''} aria-pressed={layout === 'list'} aria-label={t('spaces.viewList')} title={t('spaces.viewList')} onClick={() => setLayoutAndKeep('list')}><ShellIcon name="list" size={16} /></button>
          </div>
          <button type="button" className="btn btn-primary" disabled={creating} onClick={() => void newPage()}><ShellIcon name="plus" size={16} /><span>{t('spaces.newPage')}</span></button>
        </div>
        {search.kind === 'too-long' && <p id="space-search-limit" className="space-note is-error" role="alert">{t('spaces.searchTooLong', { max: PAGE_SEARCH_MAX })}</p>}
        {createError && <p className="space-note is-error" role="alert">{createError}</p>}
        {failed === 'search' && <p className="space-note is-error" role="alert">{t('spaces.searchFailed')}</p>}
        {truncated && searching && search.kind === 'ok' && <p className="space-note" role="status">{t('spaces.searchTruncated')}</p>}

        {failed === 'load' && rows === null ? (
          <EmptyState role="alert" icon="circle-alert" title={t('spaces.loadFailedTitle')} action={<button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>{t('spaces.retry')}</button>}>{t('spaces.loadFailedBody')}</EmptyState>
        ) : loading ? (
          <div className={`space-pages ${layout}`} role="status" aria-busy="true" aria-label={t('spaces.loading')}>
            {[0, 1, 2].map((i) => <div key={i} className="space-card space-card-skeleton" aria-hidden="true"><span className="skeleton" /><span className="skeleton" /></div>)}
          </div>
        ) : search.kind === 'too-long' ? null : shown.length === 0 ? (
          searching
            ? <EmptyState compact icon="search" title={t('spaces.noMatchTitle')} action={<button type="button" className="btn btn-secondary" onClick={() => { setRaw(''); setTyped(''); searchBox.current?.focus(); }}>{t('spaces.clearSearch')}</button>}>{t('spaces.noMatchBody', { query: q })}</EmptyState>
            : <EmptyState icon="file" title={t('spaces.emptyPagesTitle')} action={<button type="button" className="btn btn-primary" disabled={creating} onClick={() => void newPage()}><ShellIcon name="plus" size={16} /><span>{t('spaces.newPage')}</span></button>}>{t('spaces.emptyPagesBody')}</EmptyState>
        ) : (
          <>
            <div className="space-section-label"><h2>{searching ? t('spaces.matchingHeading') : t('spaces.pagesHeading')}</h2><span>{t.plural('spaces.pageCount', shown.length)}</span></div>
            <ul className={`space-pages ${layout}`}>
              {shown.map((p) => (
                <li key={p.id} className="space-card space-page-card surface">
                  <span className="space-card-icon" aria-hidden="true"><ShellIcon name="file" size={20} tone="decorative" /></span>
                  <h3 className="space-card-name"><button type="button" className="space-card-open" onClick={() => onOpenPage(p.id, false)}>{pageName(p.title, t('spaces.untitled'))}</button></h3>
                  <p className="space-card-meta">
                    <span>{t('spaces.edited', { when: when(p.updatedAt) })}</span>
                    <span>{formatBytes(p.bytes, appLocale())}</span>
                    {p.savedBy !== 'you' && <span className="space-chip">{t('spaces.byCoworker')}</span>}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
