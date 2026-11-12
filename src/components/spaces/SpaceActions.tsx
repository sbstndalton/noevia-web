import { useState } from 'react';
import type { JSX } from 'react';
import { useT } from '../../i18n';
import '../../i18n/coworkers';
import { deleteSpace, listPages, renameSpace, SpacesError, type Space } from '../../spaces-api';
import { ConfirmDialog } from '../ContextMenu';
import { ShellIcon } from '../ShellIcon';
import { NameDialog } from './NameDialog';

/** Rename and delete for one Space. A delete of a Space that still holds pages asks first and sends
 *  `withPages`; a write answered 409 `stale_revision` reloads the list and says so (nothing is lost:
 *  the person simply tries again on the fresh list). */
export function SpaceActions({ space, revision, reload, onDeleted, size = 'normal' }: {
  space: Space; revision: number; reload: () => void; onDeleted?: () => void; size?: 'normal' | 'icon';
}): JSX.Element {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState<null | { withPages: boolean }>(null);
  const [message, setMessage] = useState('');
  const refused = (e: unknown): string => {
    if (e instanceof SpacesError && e.code === 'stale_revision') { reload(); return t('spaces.staleReloaded'); }
    return t('spaces.actionFailed');
  };
  const askDelete = async () => {
    setMessage('');
    try { setConfirm({ withPages: (await listPages(space.id, { limit: 1 })).pages.length > 0 }); }
    catch (e) { setMessage(refused(e)); }
  };
  const remove = async () => {
    const withPages = confirm?.withPages ?? false;
    setConfirm(null);
    try { await deleteSpace(space.id, revision, withPages); onDeleted?.(); reload(); }
    catch (e) {
      // The Space gained a page since we looked: ask again, now with the pages in the question.
      if (e instanceof SpacesError && e.status === 409 && e.code !== 'stale_revision' && !withPages) { setConfirm({ withPages: true }); return; }
      setMessage(refused(e));
    }
  };
  const cls = size === 'icon' ? 'btn btn-secondary space-icon-btn' : 'btn btn-secondary';
  return (
    <>
      <div className="space-actions">
        <button type="button" className={cls} aria-label={t('spaces.rename') + ': ' + space.name} title={t('spaces.rename')} onClick={() => setRenaming(true)}>
          <ShellIcon name="pencil" size={16} />{size === 'normal' && <span>{t('spaces.rename')}</span>}
        </button>
        <button type="button" className={cls} aria-label={t('spaces.delete') + ': ' + space.name} title={t('spaces.delete')} onClick={() => void askDelete()}>
          <ShellIcon name="trash" size={16} />{size === 'normal' && <span>{t('spaces.delete')}</span>}
        </button>
      </div>
      {message && <p className="space-note is-error" role="alert">{message}</p>}
      {renaming && <NameDialog title={t('spaces.renameTitle')} confirmLabel={t('spaces.saveName')} initial={space.name} onClose={() => setRenaming(false)}
        onSubmit={async (name) => { try { await renameSpace(space.id, name, revision); reload(); } catch (e) { throw new Error(refused(e)); } }} />}
      {confirm && <ConfirmDialog danger title={t('spaces.deleteTitle', { name: space.name })} body={confirm.withPages ? t('spaces.deleteWithPagesBody') : t('spaces.deleteEmptyBody')}
        confirmLabel={t('spaces.deleteConfirm')} onConfirm={() => void remove()} onCancel={() => setConfirm(null)} />}
    </>
  );
}
