import type { JSX } from 'react';
import type { ToolCallView } from '../types';
import { useRef, useState } from 'react';
import { decideToolApproval } from '../api';
import { ShellIcon } from './ShellIcon';
import { useT } from '../i18n';
import { formatNumber } from '../number-format';
import { around } from '../text-around';
import { showDirectionControls } from '../visible-controls';

/** One drawn symbol per outcome — the list used ✓ and ⃠, which render differently on
 *  every platform and are not part of the icon set. */
const STATE_ICON: Record<string, string> = { done: 'check', declined: 'ban', 'not run': 'ban', running: 'refresh-cw' };

export const TOOL_RESULT_LIMIT = 4000;

/** A write tool waiting on the user. The arguments are shown in full and
 *  unabbreviated: this is the one moment where seeing exactly what the model
 *  proposes to do is the entire point, so truncating them here would defeat
 *  the gate. */
function PendingToolCall({ call }: { call: ToolCallView }): JSX.Element {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const decide = async (decision: 'approve' | 'deny' | 'approve_all') => {
    if (!call.approvalId || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await decideToolApproval(call.approvalId, decision);
    } catch (e) {
      // Most likely the request timed out and the server already denied it.
      setErr(e instanceof Error ? e.message : t('chat.approval.sendFailed'));
    } finally {
      // Clear the disabled state whether the decision succeeded or failed: a dropped
      // stream must not leave every button stuck disabled with no way to retry.
      setBusy(false);
      // The card is about to fold away (success) or stay put with an error (failure).
      // Either way, move focus off the button that just vanished from under the cursor
      // instead of letting it silently fall back to <body>.
      containerRef.current?.focus();
    }
  };
  let pretty = call.args;
  try { pretty = JSON.stringify(JSON.parse(call.args || '{}'), null, 1); } catch { /* show it raw */ }
  // Invisible direction controls would let a name or path display in another order than it acts;
  // they are printed as visible escapes (#648).
  pretty = showDirectionControls(pretty);
  const name = showDirectionControls(call.name);
  // The name is markup (bold), so the sentence is split around it and the words stay in the catalogue.
  const ask = around(t('chat.approval.ask'), 'name');
  return (
    <div className="tool-approval" role="group" tabIndex={-1} ref={containerRef} aria-label={t('chat.approval.group', { name })}>
      <span className="tool-approval-ask">
        {ask[0]}<strong>{name}</strong>{ask[1]}
      </span>
      {/* Full, unabbreviated arguments. Seeing exactly what the model proposes
          IS the gate — no clamp, no scroll-to-hide, no "show more". */}
      {/* A project file edit names the exact stored file it would change (#648), resolved by the
          server from the name above. The model may have passed only a bare name. */}
      {/* A Google Drive write (#659) names the Drive file (name and id), or the new file's name. */}
      {call.target && <span className="tool-approval-ask" data-testid="tool-approval-target">{t(call.targetKind === 'drive' ? 'chat.approval.targetDrive' : call.targetKind === 'drive-new' ? 'chat.approval.targetDriveNew' : 'chat.approval.target')}</span>}
      {call.target && <pre className="tool-approval-args">{showDirectionControls(call.target)}</pre>}
      {/* #658: the same tool, file and arguments as a change already saved in this chat. A flag
          only: all three actions stay, and nothing is declined for the person. */}
      {call.repeatOf && <span className="tool-approval-ask tool-approval-repeat" role="note" data-testid="tool-approval-repeat">{t('chat.approval.repeat')}</span>}
      {pretty && pretty !== '{}' && <pre className="tool-approval-args">{pretty}</pre>}
      <div className="tool-approval-actions">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void decide('approve')}>
          {t('chat.approval.allowOnce')}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void decide('deny')}>
          {t('chat.approval.decline')}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void decide('approve_all')}>
          {t('chat.approval.allowChat')}
        </button>
      </div>
      {err && <span className="modal-err tool-approval-err">{err}</span>}
    </div>
  );
}


// Replies saved before results were kept separately stored "name ✓" with the
// result in `args`; show those without the glyph and treat the text as a result.
function normalise(call: ToolCallView): ToolCallView {
  const legacy = /\s(✓|⃠)$/.exec(call.name || '');
  if (!legacy || call.result !== undefined) return call;
  return { ...call, name: call.name.slice(0, legacy.index), args: '', result: call.args };
}

function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function pretty(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

/** Every tool call for a reply, under its thinking block: one compact,
 *  collapsible list with a line per call. A write waiting for approval is
 *  never folded away — its full arguments are the approval gate. */
export function ToolCalls({ calls }: { calls: ToolCallView[] }): JSX.Element {
  const t = useT();
  const n = (count: number) => formatNumber(count, t.locale, 0);
  const list = calls.map(normalise);
  const pending = list.filter((c) => c.status === 'pending' && c.approvalId);
  const settled = list.filter((c) => !(c.status === 'pending' && c.approvalId));
  const running = settled.filter((c) => !c.status || c.status === 'running').length;
  const denied = settled.filter((c) => c.status === 'denied').length;
  const stopped = settled.filter((c) => c.status === 'stopped').length;
  const summary = [t.plural('chat.toolCalls.count', list.length, { count: n(list.length) }), running ? t('chat.toolCalls.running', { count: n(running) }) : '', denied ? t('chat.toolCalls.declined', { count: n(denied) }) : '', stopped ? t('chat.toolCalls.notRun', { count: n(stopped) }) : '', pending.length ? t('chat.toolCalls.awaiting', { count: n(pending.length) }) : ''].filter(Boolean).join(' · ');
  return (
    <div className="tool-calls-wrap">
      {pending.map((c, i) => <PendingToolCall key={`pending-${c.approvalId ?? i}`} call={c} />)}
      {settled.length > 0 && (
        <details className="tool-calls" open={running > 0}>
          <summary>{summary}</summary>
          <ol>
            {settled.map((c, i) => {
              const state = c.status === 'denied' ? 'declined' : c.status === 'done' ? 'done' : c.status === 'stopped' ? 'not run' : 'running';
              // The result text is what the model was told; the row says what happened in plain words.
              const preview = state === 'declined' ? t('chat.toolCalls.previewDeclined') : state === 'not run' ? t('chat.toolCalls.previewNotRun') : c.result !== undefined ? oneLine(c.result) || t('chat.toolCalls.emptyResult') : c.args ? oneLine(c.args) : '';
              const STATE_LABEL: Record<string, string> = { done: t('chat.toolCalls.state.done'), declined: t('chat.toolCalls.state.declined'), 'not run': t('chat.toolCalls.state.notRun'), running: t('chat.toolCalls.state.running') };
              return (
                <li key={i} className={`tool-call is-${state.replace(' ', '-')}`}>
                  <details>
                    <summary>
                      <span className="tool-call-state" role="img" aria-label={STATE_LABEL[state]}><ShellIcon name={STATE_ICON[state]} size={14}/></span>
                      <span className="tool-call-name">{c.name || t('chat.toolCalls.tool')}</span>
                      {preview && <span className="tool-call-preview">{preview}</span>}
                    </summary>
                    {c.args && <><span className="tool-call-label">{t('chat.toolCalls.arguments')}</span><pre>{pretty(c.args)}</pre></>}
                    {c.result !== undefined && <><span className="tool-call-label">{t('chat.toolCalls.result')}</span><pre>{c.result || t('chat.toolCalls.empty')}</pre></>}
                  </details>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </div>
  );
}
