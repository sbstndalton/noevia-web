// #1007: the one routing-mode control. Settings → Models & routing → Routing edits the account's
// mode with it, and the chat model picker (Auto) edits a chat's or project's own mode with the very
// same component, so the two can never offer different choices. Only the "not chosen" row differs:
// in Settings it means "as before", in a chat it means "follow my default".
import { useId } from 'react';
import type { JSX } from 'react';
import type { RoutingModeId } from '../api';
import { useT } from '../i18n';

export const ROUTING_MODES: RoutingModeId[] = ['local', 'cloud', 'hybrid'];
const MODE_KEY = { local: 'rmode.local', cloud: 'rmode.cloud', hybrid: 'rmode.hybrid' } as const;
const HINT_KEY = { local: 'rmode.localHint', cloud: 'rmode.cloudHint', hybrid: 'rmode.hybridHint' } as const;

export function useRoutingModeLabel(): (mode: RoutingModeId) => string {
  const t = useT();
  return (mode) => t(MODE_KEY[mode]);
}

export function RoutingModeChoice({ mode, whenSensitive, allowed, disabled = false, unsetLabel, unsetHint, onMode, onSensitive }: {
  /** '' is the "not chosen" row. */
  mode: RoutingModeId | '';
  whenSensitive: 'ask' | 'local';
  allowed: RoutingModeId[];
  disabled?: boolean;
  unsetLabel: string;
  unsetHint: string;
  onMode: (mode: RoutingModeId | '') => void;
  onSensitive: (value: 'ask' | 'local') => void;
}): JSX.Element {
  const t = useT();
  const name = useId();
  return <div className="route-mode-choice" data-testid="routing-mode-choice">
    <fieldset className="route-mode" disabled={disabled}>
      <legend>{t('rmode.mode')}</legend>
      <label><input type="radio" name={`${name}-mode`} value="" checked={mode === ''} onChange={() => onMode('')} /> {unsetLabel}</label>
      {ROUTING_MODES.map((m) => (
        <label key={m}>
          <input type="radio" name={`${name}-mode`} value={m} checked={mode === m} disabled={!allowed.includes(m)} onChange={() => onMode(m)} /> {t(MODE_KEY[m])}
          {!allowed.includes(m) && <small className="mm-note"> · {t('rmode.notAllowed')}</small>}
        </label>
      ))}
      <p className="mm-note">{mode ? t(HINT_KEY[mode]) : unsetHint}</p>
    </fieldset>
    {mode === 'hybrid' && (
      <fieldset className="route-mode" disabled={disabled}>
        <legend>{t('rmode.whenSensitive')}</legend>
        <label><input type="radio" name={`${name}-sensitive`} value="ask" checked={whenSensitive === 'ask'} onChange={() => onSensitive('ask')} /> {t('rmode.ask')}</label>
        <label><input type="radio" name={`${name}-sensitive`} value="local" checked={whenSensitive === 'local'} onChange={() => onSensitive('local')} /> {t('rmode.alwaysLocal')}</label>
      </fieldset>
    )}
  </div>;
}
