import type { JSX } from 'react';
import './active-code-tasks.css';
import { useActiveCodeTasks } from './useActiveCodeTasks';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { formatNumber } from '../../number-format';

/** The always-on header widget. Its fetch/poll loop now lives in `useActiveCodeTasks` (#415), so
 *  the Code-mode sidebar's own "TASKS" section can read the same live state without a second,
 *  divergent implementation. Worded in the interface language (#624). */
export function ActiveCodeTasks({ onOpenProject }: { onOpenProject: (id: string) => void }): JSX.Element | null {
  const t = useT();
  const { tasks, total, error, unavailable, retry } = useActiveCodeTasks(true);
  if (unavailable || (!tasks.length && !error)) return null;
  const waiting = tasks.filter((task) => task.status === 'waiting_approval').length;
  const n = (count: number) => formatNumber(count, t.locale, 0);
  /** The action class in words: the catalogue's label, or the raw id with spaces for one it lacks. */
  const action = (id: string) => { const key = `code.action.${id}`; const text = t(key as MessageKey); return text === key ? id.replaceAll('_', ' ') : text; };
  return <aside className="active-code-entry" aria-label={t('code.active.label')}>
    <details>
      <summary>{error ? t('code.active.unavailable') : waiting ? t.plural('code.active.needDecision', waiting, { count: n(waiting) }) : t.plural('code.active.count', tasks.length, { count: n(tasks.length) })}</summary>
      {error && <p role="alert">{t('code.sidebar.statusUnavailable')} <button type="button" onClick={retry}>{t('code.active.retry')}</button></p>}
      {total > tasks.length && <p>{t('code.active.showing', { shown: n(tasks.length), total: n(total) })}</p>}
      {tasks.length > 0 && <ul>{tasks.map((task) => <li key={task.id}>
        <span><strong>{task.projectName}</strong> · {task.status === 'waiting_approval' ? (task.approvalAction ? t('code.task.waitingDecisionFor', { action: action(task.approvalAction) }) : t('code.task.waitingDecision')) : task.stage || (task.status === 'queued' ? t('code.status.queued') : t('code.status.running'))}</span>
        <small>{task.title || t('code.active.untitled')}</small>
        <button type="button" onClick={() => onOpenProject(task.projectId)}>{t('code.active.openProject', { name: task.projectName })}</button>
      </li>)}</ul>}
    </details>
  </aside>;
}
