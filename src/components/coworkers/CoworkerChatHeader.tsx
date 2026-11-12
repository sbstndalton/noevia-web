import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { listSpaces, type Space } from '../../spaces-api';
import { readSpecialist, type Specialist } from '../../specialists-api';
import { CoworkerHeader } from './CoworkerHeader';

/** The strip App.tsx draws above a coworker's conversation. It reads the record itself; if the record cannot be
 *  read (deleted elsewhere, or a failed read) the conversation below stays usable and no strip is drawn. */
export function CoworkerChatHeader({ id, onDeleted }: { id: string; onDeleted: () => void }): JSX.Element | null {
  const [record, setRecord] = useState<{ revision: number; specialist: Specialist } | null>(null);
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setRecord(null);
    readSpecialist(id, controller.signal).then(setRecord).catch(() => undefined);
    listSpaces(controller.signal).then((l) => setSpaces(l.spaces)).catch(() => undefined);
    return () => controller.abort();
  }, [id]);
  return record ? <CoworkerHeader record={record} spaces={spaces} onSaved={setRecord} onDeleted={onDeleted} /> : null;
}
