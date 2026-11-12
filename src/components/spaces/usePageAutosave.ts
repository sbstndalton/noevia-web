// Adapted from CopilotKit/OpenDots@46eaf96c9e3802adc972ceafd8f20f99bda34e70, src/client/editor/use-page-autosave.ts
// (MIT, Copyright (c) Atai Barkai; the full notice is in src/page-autosave.ts). The hook shape is
// upstream's; the transport is ours (src/spaces-api.ts) and the draft is kept on this device.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PageAutosave, type PageBase, type SaveState } from '../../page-autosave';
import { clearPageDraft, readPageDraft, writePageDraft } from '../../page-drafts';
import { readPage, writePage } from '../../spaces-api';

/** One controller per open page. Leaving never aborts a save in flight: whatever is unsaved is
 *  kept on this device first, and a last save is attempted. */
export function usePageAutosave(spaceId: string, page: PageBase) {
  const [controller] = useState(() => {
    const instance = new PageAutosave({
      save: (id, body, signal) => writePage(spaceId, id, body, signal),
      load: (id, signal) => readPage(spaceId, id, signal),
      persist: (draft) => { if (draft) writePageDraft(spaceId, page.id, { ...draft, savedAt: Date.now() }); else clearPageDraft(spaceId, page.id); },
    });
    instance.receive(page, readPageDraft(spaceId, page.id));
    return instance;
  });
  const state: SaveState = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const live = useRef(controller);
  live.current = controller;
  useEffect(() => {
    const c = controller;
    const onHide = () => c.keepForLeaving();
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); c.leave(); };
  }, [controller]);
  return { controller, state };
}
