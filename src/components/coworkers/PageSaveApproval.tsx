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
/** Where the draft would go, by the rule the server applies (the Space the call names, else the coworker's default, and it
 *  must be one of the coworker's Spaces). `checking` until both reads have answered; `unverified` when one failed, so the
 *  person is told rather than shown nothing. */
export type Destination =
  | { kind: 'checking' }
  | { kind: 'ok'; name: string }
  | { kind: 'notGranted' }
  | { kind: 'unverified'; spaceId: string | null };

export function destinationOf(draft: PageDraft, coworker: Pick<Specialist, 'spaces' | 'defaultSpace'> | null, spaces: Pick<Space, 'id' | 'name'>[] | null, failed: boolean): Destination {
  const spaceId = draft.spaceId ?? coworker?.defaultSpace ?? null;
  if (failed) return { kind: 'unverified', spaceId };
  if (!coworker || !spaces) return { kind: 'checking' };
  if (!spaceId || !coworker.spaces.includes(spaceId)) return { kind: 'notGranted' };
  const space = spaces.find((x) => x.id === spaceId);
  return space ? { kind: 'ok', name: space.name } : { kind: 'unverified', spaceId };
}

/** The approval card of `space_page_save` in a coworker's conversation (#2446): the title, the Space it would be saved
 *  to and the whole draft, with "Approve & save" and "Decline". It is the card the person decides on, so the draft is
 *  shown in full, like every write's arguments, and "Approve & save" waits until the destination is known (or its
 *  lookup failed and the card says so). No "Allow for this chat": the server does not offer it for this tool. */
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
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setCoworker(null); setSpaces(null); setFailed(false);
    const fail = () => { if (!controller.signal.aborted) setFailed(true); };
    readSpecialist(coworkerId, controller.signal).then((r) => setCoworker(r.specialist)).catch(fail);
    listSpaces(controller.signal).then((l) => setSpaces(l.spaces)).catch(fail);
    return () => controller.abort();
  }, [coworkerId]);
  const where = destinationOf(draft, coworker, spaces, failed);
  return (
    <div className="tool-approval" role="group" tabIndex={-1} ref={containerRef} aria-label={t('pageSave.group')} data-testid="page-save-approval">
      {where.kind === 'ok' && <span className="tool-approval-ask" data-testid="page-save-destination">{t('pageSave.ask', { space: showDirectionControls(where.name) })}</span>}
      {where.kind === 'checking' && <span className="tool-approval-ask" role="status" data-testid="page-save-checking">{t('pageSave.checking')}</span>}
      {where.kind === 'notGranted' && <span className="tool-approval-ask tool-approval-provenance" role="note" data-testid="page-save-not-granted">{t('pageSave.notGranted')}</span>}
      {where.kind === 'unverified' && <span className="tool-approval-ask tool-approval-provenance" role="note" data-testid="page-save-unverified">{t('pageSave.unverified', { space: showDirectionControls(where.spaceId ?? '') })}</span>}
      <span className="tool-approval-ask"><strong>{t('pageSave.titleLabel')}</strong></span>
      <pre className="tool-approval-args" data-testid="page-save-title">{showDirectionControls(draft.title)}</pre>
      <span className="tool-approval-ask"><strong>{t('pageSave.draftLabel')}</strong></span>
      <pre className="tool-approval-args" data-testid="page-save-draft">{showDirectionControls(draft.content)}</pre>
      <div className="tool-approval-actions">
        <button className="btn btn-primary btn-sm" disabled={locked || where.kind === 'checking'} onClick={() => onDecide('approve')}>{t('pageSave.approve')}</button>
        <button className="btn btn-secondary btn-sm" disabled={locked} onClick={() => onDecide('deny')}>{t('pageSave.decline')}</button>
      </div>
      {sent && <span className="tool-approval-sent" role="status" data-testid="tool-approval-sent">{t('chat.approval.sent')}</span>}
      {err && <span className="modal-err tool-approval-err">{err}</span>}
    </div>
  );
}
