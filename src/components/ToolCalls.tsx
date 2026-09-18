import type { JSX } from 'react';
import type { ToolCallView } from '../types';
import { useState } from 'react';
import { decideToolApproval } from '../api';
import { ShellIcon } from './ShellIcon';

/** One drawn symbol per outcome — the list used ✓ and ⃠, which render differently on
 *  every platform and are not part of the icon set. */
const STATE_ICON: Record<string, string> = { done: 'check', declined: 'ban', 'not run': 'ban', running: 'refresh-cw' };

export const TOOL_RESULT_LIMIT = 4000;

/** A write tool waiting on the user. The arguments are shown in full and
 *  unabbreviated: this is the one moment where seeing exactly what the model
 *  proposes to do is the entire point, so truncating them here would defeat
 *  the gate. */
function PendingToolCall({ call }: { call: ToolCallView }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (decision: 'approve' | 'deny' | 'approve_all') => {
    if (!call.approvalId || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await decideToolApproval(call.approvalId, decision);
    } catch (e) {
      // Most likely the request timed out and the server already denied it.
      setErr(e instanceof Error ? e.message : 'Could not send the decision');
      setBusy(false);
    }
  };
  let pretty = call.args;
  try { pretty = JSON.stringify(JSON.parse(call.args || '{}'), null, 1); } catch { /* show it raw */ }
  return (
    <div className="tool-approval" role="group" aria-label={`Approval required for ${call.name}`}>
      <span className="tool-approval-ask">
        Allow <strong>{call.name}</strong> to run? This changes data in your account.
      </span>
      {/* Full, unabbreviated arguments. Seeing exactly what the model proposes
          IS the gate — no clamp, no scroll-to-hide, no "show more". */}
      {pretty && pretty !== '{}' && <pre className="tool-approval-args">{pretty}</pre>}
      <div className="tool-approval-actions">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void decide('approve')}>
          Allow once
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void decide('deny')}>
          Decline
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void decide('approve_all')}>
          Allow for this chat
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
  const list = calls.map(normalise);
  const pending = list.filter((c) => c.status === 'pending' && c.approvalId);
  const settled = list.filter((c) => !(c.status === 'pending' && c.approvalId));
  const running = settled.filter((c) => !c.status || c.status === 'running').length;
  const denied = settled.filter((c) => c.status === 'denied').length;
  const stopped = settled.filter((c) => c.status === 'stopped').length;
  const summary = [`${list.length} tool ${list.length === 1 ? 'call' : 'calls'}`, running ? `${running} running` : '', denied ? `${denied} declined` : '', stopped ? `${stopped} not run` : '', pending.length ? `${pending.length} awaiting approval` : ''].filter(Boolean).join(' · ');
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
              const preview = state === 'declined' ? 'You declined this' : state === 'not run' ? 'Stopped before it ran' : c.result !== undefined ? oneLine(c.result) || '(empty result)' : c.args ? oneLine(c.args) : '';
              return (
                <li key={i} className={`tool-call is-${state.replace(' ', '-')}`}>
                  <details>
                    <summary>
                      <span className="tool-call-state" role="img" aria-label={state}><ShellIcon name={STATE_ICON[state]} size={14}/></span>
                      <span className="tool-call-name">{c.name || 'tool'}</span>
                      {preview && <span className="tool-call-preview">{preview}</span>}
                    </summary>
                    {c.args && <><span className="tool-call-label">Arguments</span><pre>{pretty(c.args)}</pre></>}
                    {c.result !== undefined && <><span className="tool-call-label">Result</span><pre>{c.result || '(empty)'}</pre></>}
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
