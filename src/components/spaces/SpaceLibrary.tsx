// The library of Spaces: a grid of cards, create, rename, delete. Layout adapted from
// CopilotKit/OpenDots@46eaf96c9e3802adc972ceafd8f20f99bda34e70, src/client/SpaceNav.tsx and
// src/client/SpaceLibrary.tsx (MIT, Copyright (c) Atai Barkai; notice in src/page-autosave.ts).
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { useT } from '../../i18n';
import '../../i18n/coworkers';
import { appLocale } from '../../user-preferences';
import { relativeTime } from '../../spaces-format';
import { createSpace, SpacesError, type SpaceList } from '../../spaces-api';
import { EmptyState } from '../EmptyState';
import { ShellIcon } from '../ShellIcon';
import { NameDialog } from './NameDialog';
import { SpaceActions } from './SpaceActions';

export function SpaceLibrary({ list, state, reload, onOpen }: {
  list: SpaceList | null; state: 'loading' | 'failed' | 'ready'; reload: () => void; onOpen: (spaceId: string) => void;
}): JSX.Element {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const spaces = list?.spaces ?? [];
  const create = async (name: string) => {
    try { const space = await createSpace(name); reload(); onOpen(space.id); }
    catch (e) { throw new Error(e instanceof SpacesError && e.code === 'space_limit' ? t('spaces.spaceLimit') : t('spaces.actionFailed')); }
  };
  return (
    <main className="main spaces-workspace">
      <div className="settings-scroll">
        <div className="settings-title"><h1>{t('spaces.title')}</h1><p>{t('spaces.intro')}</p></div>
        {state === 'ready' && spaces.length > 0 && (
          <div className="space-tools">
            <button ref={newButton} type="button" className="btn btn-primary" onClick={() => setCreating(true)}><ShellIcon name="plus" size={16} /><span>{t('spaces.new')}</span></button>
          </div>
        )}
        {state === 'loading' && (
          <div className="space-grid" role="status" aria-busy="true" aria-label={t('spaces.loading')}>
            {[0, 1, 2].map((i) => <div key={i} className="space-card space-card-skeleton" aria-hidden="true"><span className="skeleton" /><span className="skeleton" /></div>)}
          </div>
        )}
        {state === 'failed' && (
          <EmptyState role="alert" icon="circle-alert" title={t('spaces.loadFailedTitle')} action={<button type="button" className="btn btn-secondary" onClick={reload}>{t('spaces.retry')}</button>}>
            {t('spaces.loadFailedBody')}
          </EmptyState>
        )}
        {state === 'ready' && spaces.length === 0 && (
          <EmptyState icon="folder" title={t('spaces.emptyTitle')} action={<button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><ShellIcon name="plus" size={16} /><span>{t('spaces.new')}</span></button>}>
            {t('spaces.emptyBody')}
          </EmptyState>
        )}
        {state === 'ready' && spaces.length > 0 && (
          <ul className="space-grid" aria-label={t('spaces.listLabel')}>
            {spaces.map((s) => (
              <li key={s.id} className="space-card surface">
                <span className="space-card-icon" aria-hidden="true"><ShellIcon name="folder-open" size={22} tone="decorative" /></span>
                <h2 className="space-card-name">
                  <button type="button" className="space-card-open" aria-label={t('spaces.openSpace', { name: s.name })} onClick={() => onOpen(s.id)}>{s.name}</button>
                </h2>
                <time className="space-card-meta" dateTime={new Date(s.updatedAt < 1e11 ? s.updatedAt * 1000 : s.updatedAt).toISOString()}>{t('spaces.updated', { when: relativeTime(s.updatedAt, appLocale()) })}</time>
                <SpaceActions space={s} revision={list?.revision ?? 0} reload={reload} size="icon" />
              </li>
            ))}
          </ul>
        )}
      </div>
      {creating && <NameDialog title={t('spaces.createTitle')} confirmLabel={t('spaces.create')} initial="" onSubmit={create} onClose={() => setCreating(false)} />}
    </main>
  );
}
