import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { decideDispatch, MODE_LABELS, switchNeedsNewSession, type ChatMode } from '../chat-mode';
import { useFeatureFlags } from './features/useFeatureFlags';
import { fetchCode } from './code/api';
import './composer-mode.css';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { ShellIcon } from './ShellIcon';

const MODE_DESCRIPTIONS: Record<ChatMode, MessageKey> = { chat: 'mode.chatDesc', cowork: 'mode.coworkDesc' };

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

export type ModeSwitch = ReturnType<typeof useModeSwitch>;

/** The state one Chat / Cowork control needs, shared by the full bar (tiers 0 and 1) and the
 *  phone composer (#527), which puts the toggle inside the composer and the caption above it. */
export function useModeSwitch({ mode, messageCount, projectId, access, repository, onModeChange }: {
  mode: ChatMode; messageCount: number; projectId: string | null; access: CoworkAccess; repository: string | null;
  onModeChange: (mode: ChatMode, newSession: boolean) => void;
}) {
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
  // #510: a phone drops the plain "Runs a conversational reply" line but keeps the Cowork
  // repository choice and the "will send as chat" warning.
  const caption: 'cowork' | 'fallback' | 'chat' = decision.harness === 'cowork' ? 'cowork' : mode === 'cowork' && decision.reason ? 'fallback' : 'chat';
  return { id, mode, confirm, setConfirm, group, choose, onKey, decision, caption, access, repository, onModeChange };
}

/** The Chat / Cowork radio group. `compact` (#527, phone composer) names only the chosen mode;
 *  the other keeps its name for assistive technology and shows a symbol. */
export function ModeToggle({ state, disabled, compact = false }: { state: ModeSwitch; disabled: boolean; compact?: boolean }): JSX.Element {
  const t = useT();
  const { id, mode, group, choose, onKey } = state;
  return <div ref={group} className={`composer-mode-toggle${compact ? ' is-compact' : ''}`} data-mode={mode} role="radiogroup" aria-label={t('mode.session')} onKeyDown={onKey}>
    {ORDER.map(option => <button key={option} type="button" role="radio" data-mode={option}
      aria-checked={option === mode} aria-describedby={`${id}-${option}`} tabIndex={option === mode ? 0 : -1}
      disabled={disabled} onClick={() => choose(option)}>
      {compact && <ShellIcon name={option === 'chat' ? 'chat' : 'code'} size={15}/>}
      {compact ? <span className="composer-mode-name">{MODE_LABELS[option].label}</span> : MODE_LABELS[option].label}
    </button>)}
  </div>;
}

/** What the chosen mode will run, with the Cowork repository choice. */
export function ModeCaption({ state, disabled, onRepository }: { state: ModeSwitch; disabled: boolean; onRepository: (id: string) => void }): JSX.Element {
  const t = useT();
  const { decision, caption, access, repository, mode } = state;
  return <span className="composer-mode-harness" aria-live="polite" data-caption={caption}>
    {decision.harness === 'cowork'
      ? <>{t('mode.runsCoding')}{' '}
        {access.repositories.length > 1
          ? <select aria-label={t('mode.repository')} value={repository ?? ''} disabled={disabled} onChange={e => onRepository(e.target.value)}>
              {access.repositories.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          : <strong>{repository}</strong>}</>
      : mode === 'cowork' && decision.reason ? t('mode.willSendAsChat', { reason: t(`mode.reason.${decision.reason}`) }) : t('mode.runsChat')}
  </span>;
}

/** The option descriptions and, when switching would fork the session, the confirmation. */
export function ModeConfirm({ state }: { state: ModeSwitch }): JSX.Element {
  const t = useT();
  const { id, confirm, setConfirm, mode, onModeChange } = state;
  return <>
    {ORDER.map(option => <span key={option} id={`${id}-${option}`} hidden>{t(MODE_DESCRIPTIONS[option])}</span>)}
    {confirm && <div className="composer-mode-confirm" role="alertdialog" aria-label={t('mode.newSession')}>
      <span>{t('mode.confirm', { mode: MODE_LABELS[confirm].label })}</span>
      <button type="button" className="btn btn-primary" onClick={() => { setConfirm(null); onModeChange(confirm, true); }}>{t('mode.startNew')}</button>
      <button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)}>{t('mode.keep', { mode: MODE_LABELS[mode].label })}</button>
    </div>}
  </>;
}

/**
 * The per-session Chat / Cowork choice (#236), shown on the empty state and in a conversation,
 * with the harness that will run named before sending. Once the session has messages, choosing
 * the other mode asks to start a new session; the current one keeps its history and harness.
 * On a phone (#527) ChatView composes the same parts itself; see `useModeSwitch`.
 */
export function ComposerModeBar({ mode, messageCount, projectId, disabled, access, repository, onRepository, onModeChange, children }: {
  mode: ChatMode; messageCount: number; projectId: string | null; disabled: boolean; access: CoworkAccess;
  repository: string | null; onRepository: (id: string) => void;
  onModeChange: (mode: ChatMode, newSession: boolean) => void; children?: ReactNode;
}): JSX.Element {
  const state = useModeSwitch({ mode, messageCount, projectId, access, repository, onModeChange });
  return <div className="composer-mode-bar">
    <div className="composer-mode-row">
      <ModeToggle state={state} disabled={disabled}/>
      <ModeCaption state={state} disabled={disabled} onRepository={onRepository}/>
      {children}
    </div>
    <ModeConfirm state={state}/>
  </div>;
}
