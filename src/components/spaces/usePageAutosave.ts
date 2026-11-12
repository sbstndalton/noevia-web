// The hook that runs one page's autosave controller.
//
// Adapted from CopilotKit/OpenDots@46eaf96c9e3802adc972ceafd8f20f99bda34e70, src/client/editor/use-page-autosave.ts (MIT, Copyright (c)
// Atai Barkai): the hook shape. The transport (src/spaces-api.ts) and the device draft are ours.
// The upstream notice follows.
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
      persist: (draft, saved) => {
        if (draft) return writePageDraft(spaceId, page.id, { ...draft, savedAt: Date.now() });
        clearPageDraft(spaceId, page.id, undefined, saved);
      },
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
