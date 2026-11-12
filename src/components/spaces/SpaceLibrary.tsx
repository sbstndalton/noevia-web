// The library of Spaces: a grid of cards, create, rename, delete.
//
// Adapted from CopilotKit/OpenDots@46eaf96c9e3802adc972ceafd8f20f99bda34e70, src/client/SpaceNav.tsx and src/client/SpaceLibrary.tsx
// (MIT, Copyright (c) Atai Barkai): the card grid, the empty and error states and the page header
// pattern. The data, i18n, design tokens and accessibility are ours. The upstream notice follows.
//   The MIT License
//   Copyright (c) Atai Barkai
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
//   associated documentation files (the "Software"), to deal in the Software without restriction,
//   including without limitation the rights to use, copy, modify, merge, publish, distribute,
//   sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions: The above copyright notice and this
//   permission notice shall be included in all copies or substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
//   NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
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
                  <button type="button" className="space-card-open" aria-label={t('spaces.openSpace', { name: s.name })} title={s.name} onClick={() => onOpen(s.id)}>{s.name}</button>
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
