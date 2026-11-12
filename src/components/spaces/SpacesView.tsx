// Spaces: /spaces (the library), /spaces/<id> (one Space's pages), /spaces/<id>/<pageId> (a page).
// The address is the source of truth (App.tsx owns it); this view reads the ids it is given and
// asks `onNavigate` to move. Only mounted when the server has the Spaces routes for this account
// (App.tsx's capability gate).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useT } from '../../i18n';
import '../../i18n/coworkers';
import { listSpaces, readPage, SpacesError, type Page, type SpaceList } from '../../spaces-api';
import { EmptyState } from '../EmptyState';
import { PageEditor } from './PageEditor';
import { SpaceLibrary } from './SpaceLibrary';
import { SpacePages } from './SpacePages';

export interface SpacesViewProps {
  spaceId?: string;
  pageId?: string;
  onNavigate: (spaceId?: string, pageId?: string) => void;
}

export function SpacesView({ spaceId, pageId, onNavigate }: SpacesViewProps): JSX.Element {
  const t = useT();
  const [list, setList] = useState<SpaceList | null>(null);
  const [state, setState] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [attempt, setAttempt] = useState(0);
  // A re-read in flight, and one that failed: an id the list does not know yet (a Space just created) waits for the first
  // and says so on the second, instead of claiming the Space is not available.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const fresh = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setRefreshing(true); setRefreshFailed(false);
    listSpaces(controller.signal)
      .then((l) => { setList(l); setState('ready'); setRefreshing(false); })
      .catch(() => { if (!controller.signal.aborted) { setState((s) => (s === 'ready' ? s : 'failed')); setRefreshFailed(true); setRefreshing(false); } });
    return () => controller.abort();
  }, [attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const space = spaceId ? list?.spaces.find((s) => s.id === spaceId) : undefined;

  if (!spaceId) return <SpaceLibrary list={list} state={state} reload={reload} onOpen={(id) => onNavigate(id)} />;
  if (state === 'loading' || (!space && refreshing)) return <main className="main spaces-workspace"><div className="settings-scroll"><div className="view-loading" role="status">{t('spaces.loading')}</div></div></main>;
  if ((state === 'failed' && !list) || (!space && refreshFailed)) {
    return <main className="main spaces-workspace"><div className="settings-scroll"><EmptyState role="alert" icon="circle-alert" title={t('spaces.loadFailedTitle')} action={<button type="button" className="btn btn-secondary" onClick={() => { setState((s) => (s === 'failed' ? 'loading' : s)); reload(); }}>{t('spaces.retry')}</button>}>{t('spaces.loadFailedBody')}</EmptyState></div></main>;
  }
  if (!space) {
    return <main className="main spaces-workspace"><div className="settings-scroll"><EmptyState icon="folder" title={t('spaces.notFoundTitle')} action={<button type="button" className="btn btn-primary" onClick={() => onNavigate()}>{t('spaces.backToSpaces')}</button>}>{t('spaces.notFoundBody')}</EmptyState></div></main>;
  }
  if (!pageId) {
    return <SpacePages key={space.id} space={space} revision={list?.revision ?? 0} reloadSpaces={reload} onBack={() => onNavigate()}
      onOpenPage={(id, isNew) => { fresh.current = isNew ? id : null; onNavigate(space.id, id); }} onDeleted={() => onNavigate()} />;
  }
  return <PageLoader key={pageId} spaceId={space.id} spaceName={space.name} pageId={pageId} fresh={fresh.current === pageId} onBack={() => onNavigate(space.id)} onMoved={(id) => onNavigate(space.id, id)} />;
}

function PageLoader({ spaceId, spaceName, pageId, fresh, onBack, onMoved }: { spaceId: string; spaceName: string; pageId: string; fresh: boolean; onBack: () => void; onMoved: (pageId: string) => void }): JSX.Element {
  const t = useT();
  const [page, setPage] = useState<Page | null>(null);
  const [problem, setProblem] = useState<'missing' | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setProblem(null);
    readPage(spaceId, pageId, controller.signal).then(setPage).catch((e: unknown) => {
      if (!controller.signal.aborted) setProblem(e instanceof SpacesError && e.status === 404 ? 'missing' : 'failed');
    });
    return () => controller.abort();
  }, [spaceId, pageId, attempt]);
  if (page) return <PageEditor spaceId={spaceId} spaceName={spaceName} page={page} fresh={fresh} onBack={onBack} onDeleted={onBack} onMoved={onMoved} />;
  if (problem === 'missing') return <main className="main spaces-workspace"><div className="settings-scroll"><EmptyState icon="file" title={t('spaces.pageNotFoundTitle')} action={<button type="button" className="btn btn-primary" onClick={onBack}>{spaceName}</button>}>{t('spaces.pageNotFoundBody')}</EmptyState></div></main>;
  if (problem === 'failed') return <main className="main spaces-workspace"><div className="settings-scroll"><EmptyState role="alert" icon="circle-alert" title={t('spaces.loadFailedTitle')} action={<button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>{t('spaces.retry')}</button>}>{t('spaces.loadFailedBody')}</EmptyState></div></main>;
  return <main className="main spaces-workspace"><div className="settings-scroll"><div className="view-loading" role="status">{t('spaces.loading')}</div></div></main>;
}
