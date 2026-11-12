import { useEffect, useState } from 'react';
import type { JSX, RefObject } from 'react';
import { listSpaces, type Space } from '../../spaces-api';
import { readSpecialist, type Specialist } from '../../specialists-api';
import type { PageDraft } from '../../coworker-conversation';
import { showDirectionControls } from '../../visible-controls';
import { useT } from '../../i18n';
import '../../i18n/coworkers';

/** The approval card of `space_page_save` in a coworker's conversation (#2446): the title, the Space it would be saved
 *  to and the whole draft, with "Approve & save" and "Decline". It is the card the person decides on, so the draft is
 *  shown in full, like every write's arguments. No "Allow for this chat": the server does not offer it for this tool. */
export function PageSaveApproval({ draft, coworkerId, locked, sent, err, onDecide, containerRef }: {
  draft: PageDraft;
  coworkerId: string;
  locked: boolean;
  sent: boolean;
  err: string | null;
  onDecide: (decision: 'approve' | 'deny') => void;
  containerRef: RefObject<HTMLDivElement | null>;
}): JSX.Element {
  const t = useT();
  const [coworker, setCoworker] = useState<Specialist | null>(null);
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    readSpecialist(coworkerId, controller.signal).then((r) => setCoworker(r.specialist)).catch(() => undefined);
    listSpaces(controller.signal).then((l) => setSpaces(l.spaces)).catch(() => undefined);
    return () => controller.abort();
  }, [coworkerId]);
  // The destination is the Space the call names, else the coworker's default: the same rule the server applies.
  const spaceId = draft.spaceId ?? coworker?.defaultSpace ?? null;
  const granted = !!coworker && !!spaceId && coworker.spaces.includes(spaceId);
  const space = spaceId ? spaces?.find((s) => s.id === spaceId) : undefined;
  return (
    <div className="tool-approval" role="group" tabIndex={-1} ref={containerRef} aria-label={t('pageSave.group')} data-testid="page-save-approval">
      {space && granted
        ? <span className="tool-approval-ask" data-testid="page-save-destination">{t('pageSave.ask', { space: showDirectionControls(space.name) })}</span>
        : coworker && <span className="tool-approval-ask tool-approval-provenance" role="note" data-testid="page-save-not-granted">{t('pageSave.notGranted')}</span>}
      <span className="tool-approval-ask"><strong>{t('pageSave.titleLabel')}</strong></span>
      <pre className="tool-approval-args" data-testid="page-save-title">{showDirectionControls(draft.title)}</pre>
      <span className="tool-approval-ask"><strong>{t('pageSave.draftLabel')}</strong></span>
      <pre className="tool-approval-args" data-testid="page-save-draft">{showDirectionControls(draft.content)}</pre>
      <div className="tool-approval-actions">
        <button className="btn btn-primary btn-sm" disabled={locked} onClick={() => onDecide('approve')}>{t('pageSave.approve')}</button>
        <button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => onDecide('deny')}>{t('pageSave.decline')}</button>
      </div>
      {sent && <span className="tool-approval-sent" role="status" data-testid="tool-approval-sent">{t('chat.approval.sent')}</span>}
      {err && <span className="modal-err tool-approval-err">{err}</span>}
    </div>
  );
}
