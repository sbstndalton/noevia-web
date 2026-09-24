import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { decideDispatch, MODE_LABELS, switchNeedsNewSession, type ChatMode } from '../chat-mode';
import { useFeatureFlags } from './features/useFeatureFlags';
import { fetchCode } from './code/api';
import './composer-mode.css';

export interface CoworkAccess { harnessEnabled: boolean; canUseCode: boolean; repositories: string[] }

/** What this viewer may run as Cowork here: the flag, and the code state the server gives admins. */
export function useCoworkAccess(projectId: string | null): CoworkAccess {
  const flags = useFeatureFlags();
  const [state, setState] = useState<{ projectId: string | null; canUseCode: boolean; repositories: string[] }>({ projectId: null, canUseCode: false, repositories: [] });
  useEffect(() => {
    setState({ projectId, canUseCode: false, repositories: [] });
    if (!flags.codeHarness || !projectId) return;
    let live = true;
    fetchCode(projectId)
      .then(code => { if (live) setState({ projectId, canUseCode: true, repositories: code.repositories.map(r => r.id) }); })
      .catch(() => { if (live) setState({ projectId, canUseCode: false, repositories: [] }); });
    return () => { live = false; };
  }, [flags.codeHarness, projectId]);
  const current = state.projectId === projectId;
  return { harnessEnabled: !!flags.codeHarness, canUseCode: current && state.canUseCode, repositories: current ? state.repositories : [] };
}

const ORDER: ChatMode[] = ['chat', 'cowork'];

/**
 * The per-session Chat / Cowork choice (#236), shown on the empty state and in a conversation,
 * with the harness that will run named before sending. Once the session has messages, choosing
 * the other mode asks to start a new session; the current one keeps its history and harness.
 */
export function ComposerModeBar({ mode, messageCount, projectId, disabled, access, repository, onRepository, onModeChange, children }: {
  mode: ChatMode; messageCount: number; projectId: string | null; disabled: boolean; access: CoworkAccess;
  repository: string | null; onRepository: (id: string) => void;
  onModeChange: (mode: ChatMode, newSession: boolean) => void; children?: ReactNode;
}): JSX.Element {
  const id = useId();
  const [confirm, setConfirm] = useState<ChatMode | null>(null);
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => { setConfirm(null); }, [mode, messageCount === 0]);
  const choose = (next: ChatMode) => {
    if (next === mode) { setConfirm(null); return; }
    if (switchNeedsNewSession(messageCount, mode, next)) setConfirm(next);
    else onModeChange(next, false);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = ORDER[(ORDER.indexOf(mode) + step + ORDER.length) % ORDER.length];
    choose(next);
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus());
  };
  const decision = decideDispatch({ mode, harnessEnabled: access.harnessEnabled, canUseCode: access.canUseCode, projectId, repository });
  return <div className="composer-mode-bar">
    <div className="composer-mode-row">
      <div ref={group} className="composer-mode-toggle" role="radiogroup" aria-label="Session mode" onKeyDown={onKey}>
        {ORDER.map(option => <button key={option} type="button" role="radio" data-mode={option}
          aria-checked={option === mode} aria-describedby={`${id}-${option}`} tabIndex={option === mode ? 0 : -1}
          disabled={disabled} onClick={() => choose(option)}>{MODE_LABELS[option].label}</button>)}
      </div>
      <span className="composer-mode-harness" aria-live="polite">
        {decision.harness === 'cowork'
          ? <>Runs a coding task in{' '}
            {access.repositories.length > 1
              ? <select aria-label="Repository" value={repository ?? ''} disabled={disabled} onChange={e => onRepository(e.target.value)}>
                  {access.repositories.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              : <strong>{repository}</strong>}</>
          : mode === 'cowork' ? decision.notice?.replace(/^Sent as Chat: /, 'Will send as Chat: ') : 'Runs a conversational reply'}
      </span>
      {children}
    </div>
    {ORDER.map(option => <span key={option} id={`${id}-${option}`} hidden>{MODE_LABELS[option].description}</span>)}
    {confirm && <div className="composer-mode-confirm" role="alertdialog" aria-label="Start a new session">
      <span>{MODE_LABELS[confirm].label} runs on a different harness. Start a new {MODE_LABELS[confirm].label} session? This conversation stays as it is.</span>
      <button type="button" className="btn btn-primary" onClick={() => { setConfirm(null); onModeChange(confirm, true); }}>Start new session</button>
      <button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)}>Keep {MODE_LABELS[mode].label}</button>
    </div>}
  </div>;
}
