import type { JSX } from 'react';
import type { UsageDay } from '../types';
import { useT } from '../i18n';
import { appLocale } from '../user-preferences';

export interface TouchMonth {
  key: string;
  /** Short month and year as the interface reads them, e.g. "Oct 2026". */
  label: string;
  days: UsageDay[];
}

/** #1467: on a touch screen the 10 px activity cells are too small to tap, so a month opens its
 *  days as a list of full-size rows (at least 44 px). The compact grid stays as it is above. The
 *  open month is owned by the caller, so the list survives a re-render of the Usage page. */
export function UsageTouchMonths({ months, openKey, onOpen, activeDay, onPick }: {
  months: TouchMonth[];
  openKey: string | null;
  onOpen: (key: string | null) => void;
  activeDay: string | null;
  onPick: (day: string) => void;
}): JSX.Element {
  const t = useT();
  const open = months.find(month => month.key === openKey) ?? null;
  return <div className="usage-touch">
    <div className="usage-touch-months" role="group" aria-label={t('usage.touchMonths')}>
      {months.map(month => {
        const expanded = open?.key === month.key;
        return <button key={month.key} type="button" className="usage-touch-month" aria-expanded={expanded}
          aria-controls={expanded ? 'usage-touch-days' : undefined} onClick={() => onOpen(expanded ? null : month.key)}>
          {month.label}
        </button>;
      })}
    </div>
    {open && <ul id="usage-touch-days" className="usage-touch-days" aria-label={t('usage.monthDays', { month: open.label })}>
      {open.days.map(day => <li key={day.day}>
        <button type="button" className="usage-touch-day" aria-pressed={activeDay === day.day} onClick={() => onPick(day.day)}>
          <span className="usage-touch-date">{day.day}</span>
          <span>{t.plural('usage.responses', day.replies, { count: day.replies.toLocaleString(appLocale()) })}</span>
          <span className="usage-touch-tokens">{t('usage.inputTokens', { count: day.input.toLocaleString(appLocale()) })} · {t('usage.outputTokens', { count: day.output.toLocaleString(appLocale()) })}</span>
        </button>
      </li>)}
    </ul>}
  </div>;
}
