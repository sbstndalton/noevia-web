// The autosave state machine of the Space page editor (sbstndalton/noevia#2446).
//
// Adapted from CopilotKit/OpenDots@46eaf96c9e3802adc972ceafd8f20f99bda34e70, src/client/editor/autosave.ts
// (MIT, Copyright (c) Atai Barkai). The upstream notice follows.
//
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
//
// What changed: numeric `revision` became the content `version` (sha256) of our revision rule; the
// delay is 1.5 s; a failed save or a 409 keeps the draft on this device (injected `persist`); a 409
// offers "keep mine" (save again on the current version) or "take theirs" (reload) instead of only
// "copy it first"; limits are checked before a request; timers, the save call and storage are
// injected so the machine runs under node:test with no DOM.
import { draftProblem, type DraftProblem } from './spaces-limits';

export interface PageDraft { title: string; content: string }
export interface PageBase extends PageDraft { id: string; version: string }
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
/** Why the page is not "saved": a draft the limits refuse, a server refusal, or no answer. */
export type SaveFault = { kind: 'problem'; problem: DraftProblem } | { kind: 'server'; code?: string; message: string } | { kind: 'timeout' } | { kind: 'load-failed' };

export interface SaveState {
  /** False once this device could not keep a copy of the draft (storage full or unavailable): the text then exists only in this tab. */
  keptOnDevice?: boolean;
  base?: PageBase;
  draft?: PageDraft;
  status: SaveStatus;
  fault?: SaveFault;
  /** The server's current version once a 409 told us (or take-theirs loaded it). */
  remoteVersion?: string;
  /** The draft was read back from this device when the page opened. */
  restored?: boolean;
}

export interface LocalDraft { title: string; content: string; baseVersion: string | null }
export interface AutosaveOptions {
  save(id: string, body: { title: string; content: string; version: string }, signal: AbortSignal): Promise<{ version: string }>;
  load(id: string, signal: AbortSignal): Promise<PageBase>;
  /** Called with the draft to keep on this device (false when it could not be kept), or null once nothing is left to keep
   *  (`saved` is then the text just saved, so a stale clear can be told from a current draft). */
  persist?(draft: LocalDraft | null, saved?: PageDraft): boolean | void;
  delayMs?: number;
  timeoutMs?: number;
}

export const AUTOSAVE_DELAY_MS = 1500;
const same = (a: PageDraft, b: PageDraft) => a.title === b.title && a.content === b.content;
const statusOf = (error: unknown): { status?: number; code?: string; version?: string; message: string } => {
  const e = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  return { status: typeof e.status === 'number' ? e.status : undefined, code: typeof e.code === 'string' ? e.code : undefined, version: typeof e.version === 'string' ? e.version : undefined, message: error instanceof Error ? error.message : 'Could not save.' };
};

export class PageAutosave {
  private state: SaveState = { status: 'saved' };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private pending?: Promise<boolean>;
  private generation = 0;
  /** A save may have reached the server without its answer reaching us (timeout, dropped connection). */
  private unknownOutcome = false;
  /** "Keep mine" writes even when the draft equals the old base: the server holds something else. */
  private force = false;
  private readonly delay: number;
  private readonly timeout: number;
  constructor(private readonly options: AutosaveOptions) {
    this.delay = options.delayMs ?? AUTOSAVE_DELAY_MS;
    this.timeout = options.timeoutMs ?? 15000;
  }

  getSnapshot = (): SaveState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<SaveState>) { this.state = { ...this.state, ...patch }; for (const l of this.listeners) l(); }

  private get changed(): boolean { const { base, draft } = this.state; return !!base && !!draft && !same(base, draft); }
  /** Something would be lost by leaving now: unsaved text, a save in flight, or a failed/conflicted save. */
  get dirty(): boolean { return !!this.pending || this.changed || this.state.status === 'error' || this.state.status === 'conflict'; }

  private keepLocal() {
    const { base, draft } = this.state;
    if (!base || !draft || (same(base, draft) && !this.force)) return;
    const kept = this.options.persist?.({ title: draft.title, content: draft.content, baseVersion: base.version });
    if (kept === false && this.state.keptOnDevice !== false) this.publish({ keptOnDevice: false });
    else if (kept !== false && this.state.keptOnDevice === false) this.publish({ keptOnDevice: true });
  }
  /** Once the editor has left, a late save must not clear a device copy a newer editor of the same page has stored since. */
  private leaving = false;
  private clearLocal(saved?: PageDraft) { this.options.persist?.(null, this.leaving ? saved : undefined); }
  private reset() { this.generation++; clearTimeout(this.timer); this.controller?.abort(); this.pending = undefined; this.unknownOutcome = false; this.force = false; }

  /** Show a page as the server has it, optionally with a draft read back from this device. A draft
   *  based on an older version than the page's is a conflict from the start: nothing is overwritten
   *  until the person chooses. */
  receive(page: PageBase, local?: LocalDraft | null) {
    this.reset();
    const mine = local && !same(local, page) ? local : null;
    if (!mine) { this.clearLocal(); this.publish({ base: page, draft: { title: page.title, content: page.content }, status: 'saved', fault: undefined, remoteVersion: undefined, restored: false }); return; }
    const stale = mine.baseVersion !== page.version;
    this.publish({ base: page, draft: { title: mine.title, content: mine.content }, status: stale ? 'conflict' : 'dirty', fault: undefined, remoteVersion: stale ? page.version : undefined, restored: true });
    if (!stale) this.schedule();
  }

  edit(patch: Partial<PageDraft>) {
    if (!this.state.draft || !this.state.base) return;
    const draft = { ...this.state.draft, ...patch };
    const status = this.state.status;
    if (status === 'conflict') { this.publish({ draft }); this.keepLocal(); return; }
    this.publish({ draft, status: this.pending ? 'saving' : same(this.state.base, draft) ? 'saved' : 'dirty', fault: undefined });
    if (this.state.status === 'saved') { this.clearLocal(); return; }
    if (status === 'error') this.keepLocal();
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.changed && !this.pending && this.state.status !== 'conflict') this.timer = setTimeout(() => { void this.flush(); }, this.delay);
  }

  /** Save now. `retry` also tries again after a failure (the automatic timer never does). */
  async flush(retry = false): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.pending) { await this.pending; return this.changed ? this.flush(retry) : this.state.status === 'saved'; }
    const { base, draft } = this.state;
    if (!base || !draft || this.state.status === 'conflict') return false;
    if (this.state.status === 'error' && !retry) return false;
    if (!this.changed && !this.force) { this.publish({ status: 'saved', fault: undefined }); this.clearLocal(); return true; }
    const problem = draftProblem(draft);
    if (problem) { this.publish({ status: 'error', fault: { kind: 'problem', problem } }); this.keepLocal(); return false; }
    const generation = this.generation;
    if (this.unknownOutcome) {
      // The last save may have landed. Look before writing again, so our own earlier write is not a false conflict.
      const verdict = await this.reconcile(base, draft, generation);
      if (verdict !== 'go') return verdict === 'saved';
    }
    const controller = this.controller = new AbortController();
    this.publish({ status: 'saving', fault: undefined });
    const sent = { ...draft };
    const pending = (async () => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        const result = await Promise.race([
          this.options.save(base.id, { ...sent, version: base.version }, controller.signal),
          new Promise<never>((_, reject) => { deadline = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('timeout')); }, this.timeout); }),
        ]);
        if (generation !== this.generation) return false;
        const current = this.state.draft ?? sent;
        this.force = false; this.unknownOutcome = false;
        this.publish({ base: { id: base.id, version: result.version, ...sent }, status: same(current, sent) ? 'saved' : 'dirty', fault: undefined, remoteVersion: undefined, restored: false });
        if (this.state.status === 'saved') this.clearLocal(sent); else this.keepLocal();
        return true;
      } catch (error) {
        if (generation !== this.generation) return false;
        const e = statusOf(error);
        if (timedOut || e.status === undefined) this.unknownOutcome = true;
        if (e.status === 409) this.publish({ status: 'conflict', fault: { kind: 'server', code: e.code, message: e.message }, remoteVersion: e.version });
        else this.publish({ status: 'error', fault: timedOut ? { kind: 'timeout' } : { kind: 'server', code: e.code, message: e.message } });
        this.keepLocal();
        return false;
      } finally {
        clearTimeout(deadline);
        if (generation === this.generation) { this.pending = undefined; this.publish({}); this.schedule(); }
      }
    })();
    this.pending = pending;
    return pending;
  }

  /** After a save whose outcome is unknown: read the page. 'saved' = it already has our text; 'go' = unchanged, write again;
   *  'conflict'/'error' = stop (state is published). */
  private async reconcile(base: PageBase, draft: PageDraft, generation: number): Promise<'saved' | 'go' | 'conflict' | 'error'> {
    try {
      const now = await this.options.load(base.id, new AbortController().signal);
      if (generation !== this.generation) return 'error';
      if (now.title === draft.title && now.content === draft.content) {
        this.unknownOutcome = false; this.force = false;
        this.publish({ base: now, status: 'saved', fault: undefined, remoteVersion: undefined });
        this.clearLocal(draft);
        return 'saved';
      }
      if (now.version !== base.version) { this.publish({ status: 'conflict', fault: { kind: 'server', code: 'stale_revision', message: 'changed' }, remoteVersion: now.version }); this.keepLocal(); return 'conflict'; }
      this.unknownOutcome = false;
      return 'go';
    } catch {
      if (generation === this.generation) { this.publish({ status: 'error', fault: { kind: 'server', message: 'unreachable' } }); this.keepLocal(); }
      return 'error';
    }
  }

  /** "Keep mine": save the draft again on top of the server's current version. */
  async keepMine(): Promise<boolean> {
    const { base, draft } = this.state;
    if (this.state.status !== 'conflict' || !base || !draft) return false;
    const generation = this.generation;
    let version = this.state.remoteVersion;
    if (!version) {
      try { version = (await this.options.load(base.id, new AbortController().signal)).version; }
      catch { if (generation === this.generation) this.publish({ fault: { kind: 'load-failed' } }); return false; }
      if (generation !== this.generation) return false;
    }
    this.force = true;
    this.publish({ base: { ...base, version }, status: 'dirty', fault: undefined, remoteVersion: undefined });
    return this.flush();
  }

  /** "Take theirs": drop the draft (and its local copy) and show what the server has. */
  async takeTheirs(): Promise<boolean> {
    const { base } = this.state;
    if (this.state.status !== 'conflict' || !base) return false;
    const generation = this.generation;
    try {
      const page = await this.options.load(base.id, new AbortController().signal);
      if (generation !== this.generation) return false;
      this.receive(page);
      return true;
    } catch {
      if (generation === this.generation) this.publish({ fault: { kind: 'load-failed' } });
      return false;
    }
  }

  /** Last chance before the page goes away: keep whatever is unsaved on this device. Only stores; the page may yet come back
   *  (back-forward cache), so the autosave timer is left running. */
  keepForLeaving() { if (this.dirty) this.keepLocal(); }

  /** The page itself is gone (deleted here): nothing is kept, nothing is saved. */
  discard() {
    this.reset();
    const { base } = this.state;
    this.state = { ...this.state, ...(base ? { draft: { title: base.title, content: base.content } } : {}), status: 'saved', fault: undefined };
    this.clearLocal();
    this.listeners.clear();
  }

  /** The editor is going away. Never aborts a save in flight (that would lose it): keeps the draft on
   *  this device, drops the subscribers, and tries one last save of anything still unsaved. */
  leave() {
    this.leaving = true;
    clearTimeout(this.timer);
    this.keepForLeaving();
    this.listeners.clear();
    if (this.state.status === 'dirty' && !this.pending) void this.flush();
  }
}
