// Coworkers: /coworkers (the list) and /coworkers/<id> (one coworker). Like Spaces, the address is the source of truth
// (App.tsx owns it) and this view asks `onNavigate` to move. When the coworker has a conversation (`chatId`), the page
// hands over to the existing chat view (App.tsx renders it under CoworkerHeader); until the server has one, the page
// shows the header and a plain note. Only mounted when the server has the coworker routes (App.tsx's capability gate).
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useT } from '../../i18n';
import '../../i18n/coworkers';
import { listSpaces, SpacesError, type Space } from '../../spaces-api';
import { listSpecialists, readSpecialist, type Specialist, type SpecialistList } from '../../specialists-api';
import { EmptyState } from '../EmptyState';
import { ShellIcon } from '../ShellIcon';
import { CoworkerGlyph } from './Glyph';
import { CoworkerHeader, statusLine } from './CoworkerHeader';
import { CoworkerSettings } from './CoworkerSettings';
import '../spaces/spaces.css';
import './coworkers.css';

export interface CoworkersViewProps {
  id?: string;
  onNavigate: (id?: string) => void;
  /** A coworker with a conversation: App.tsx swaps this page for the chat view on that chat. */
  onOpenConversation: (coworker: Specialist) => void;
}

export function CoworkersView({ id, onNavigate, onOpenConversation }: CoworkersViewProps): JSX.Element {
  return id ? <CoworkerPage key={id} id={id} onNavigate={onNavigate} onOpenConversation={onOpenConversation} /> : <CoworkerList onNavigate={onNavigate} />;
}

function CoworkerList({ onNavigate }: { onNavigate: (id?: string) => void }): JSX.Element {
  const t = useT();
  const [list, setList] = useState<SpecialistList | null>(null);
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [state, setState] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    listSpecialists(controller.signal).then((l) => { setList(l); setState('ready'); }).catch(() => { if (!controller.signal.aborted) setState((s) => (s === 'ready' ? s : 'failed')); });
    listSpaces(controller.signal).then((l) => setSpaces(l.spaces)).catch(() => undefined);
    return () => controller.abort();
  }, [attempt]);
  const items = list?.specialists ?? [];
  const newButton = <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><ShellIcon name="plus" size={16} /><span>{t('coworkers.new')}</span></button>;
  return (
    <main className="main spaces-workspace coworkers-workspace">
      <div className="settings-scroll">
        <div className="settings-title"><h1>{t('coworkers.title')}</h1><p>{t('coworkers.intro')}</p></div>
        {state === 'ready' && items.length > 0 && <div className="space-tools">{newButton}</div>}
        {state === 'loading' && <div className="space-grid" role="status" aria-busy="true" aria-label={t('coworkers.loading')}>{[0, 1, 2].map((i) => <div key={i} className="space-card space-card-skeleton" aria-hidden="true"><span className="skeleton" /><span className="skeleton" /></div>)}</div>}
        {state === 'failed' && <EmptyState role="alert" icon="circle-alert" title={t('coworkers.loadFailedTitle')} action={<button type="button" className="btn btn-secondary" onClick={() => { setState('loading'); setAttempt((n) => n + 1); }}>{t('spaces.retry')}</button>}>{t('coworkers.loadFailedBody')}</EmptyState>}
        {state === 'ready' && items.length === 0 && <EmptyState icon="users" title={t('coworkers.emptyTitle')} action={newButton}>{t('coworkers.emptyBody')}</EmptyState>}
        {state === 'ready' && items.length > 0 && (
          <ul className="space-grid cw-grid" aria-label={t('coworkers.listLabel')}>
            {items.map((c) => (
              <li key={c.id} className="space-card cw-card surface">
                <CoworkerGlyph coworker={c} />
                <h2 className="space-card-name"><button type="button" className="space-card-open" aria-label={t('coworkers.open', { name: c.name })} onClick={() => onNavigate(c.id)}>{c.name}</button></h2>
                <p className="space-card-meta">{statusLine(t, c, spaces)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {creating && <CoworkerSettings mode={{ kind: 'create' }} onClose={() => setCreating(false)} onSaved={(r) => { setAttempt((n) => n + 1); onNavigate(r.specialist.id); }} />}
    </main>
  );
}

function CoworkerPage({ id, onNavigate, onOpenConversation }: { id: string; onNavigate: (id?: string) => void; onOpenConversation: (c: Specialist) => void }): JSX.Element {
  const t = useT();
  const [record, setRecord] = useState<{ revision: number; specialist: Specialist } | null>(null);
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [problem, setProblem] = useState<'missing' | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setProblem(null);
    readSpecialist(id, controller.signal).then(setRecord).catch((e: unknown) => { if (!controller.signal.aborted) setProblem(e instanceof SpacesError && e.status === 404 ? 'missing' : 'failed'); });
    listSpaces(controller.signal).then((l) => setSpaces(l.spaces)).catch(() => undefined);
    return () => controller.abort();
  }, [id, attempt]);
  // A conversation exists: the chat view takes over (the address stays /coworkers/<id>).
  const chat = record?.specialist.chatId && record.specialist.projectId ? record.specialist : null;
  useEffect(() => { if (chat) onOpenConversation(chat); }, [chat, onOpenConversation]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  if (problem === 'missing') return <main className="main spaces-workspace"><div className="settings-scroll"><EmptyState icon="users" title={t('coworkers.notFoundTitle')} action={<button type="button" className="btn btn-primary" onClick={() => onNavigate()}>{t('coworkers.back')}</button>}>{t('coworkers.notFoundBody')}</EmptyState></div></main>;
  if (problem === 'failed') return <main className="main spaces-workspace"><div className="settings-scroll"><EmptyState role="alert" icon="circle-alert" title={t('coworkers.loadFailedTitle')} action={<button type="button" className="btn btn-secondary" onClick={reload}>{t('spaces.retry')}</button>}>{t('coworkers.loadFailedBody')}</EmptyState></div></main>;
  if (!record || chat) return <main className="main spaces-workspace"><div className="settings-scroll"><div className="view-loading" role="status">{t('coworkers.loading')}</div></div></main>;
  return (
    <main className="main spaces-workspace coworkers-workspace">
      <div className="settings-scroll">
        <nav className="space-crumbs" aria-label={t('spaces.breadcrumb')}>
          <button type="button" className="btn btn-secondary space-back" onClick={() => onNavigate()}><ShellIcon name="arrow-left" size={16} /><span>{t('coworkers.back')}</span></button>
        </nav>
        <CoworkerHeader record={record} spaces={spaces} onSaved={setRecord} onDeleted={() => onNavigate()} />
        <EmptyState icon="chat" title={t('coworkers.noConversationTitle')}>{t('coworkers.noConversationBody')}</EmptyState>
      </div>
    </main>
  );
}
