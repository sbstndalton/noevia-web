import type { JSX } from 'react';
import { ProjectIcon } from './ProjectIdentity';
import { SidebarLabel } from './SidebarLabel';
import type { Project } from '../types';
import type { ActiveTask } from './code/active-tasks';

/** #415: the Code-mode sidebar's own "CODING PROJECTS" list, once access is confirmed — the same
 *  data CodingWorkspace's own picker (CodeProjectPicker) already renders. Exported for tests: a
 *  pure, hook-free presentational component, the same shape CodeProjectPicker already is. */
export function CodingProjectList({ projects, onOpen }: {
  projects: Pick<Project, 'id' | 'name' | 'icon' | 'color'>[]; onOpen: (id: string) => void;
}): JSX.Element {
  return <ul className="coding-project-list">{projects.map((p) => <li key={p.id}>
    <button className="project-disclosure" aria-label={`Open ${p.name}`} onClick={() => onOpen(p.id)}>
      <ProjectIcon project={p} size={18}/><SidebarLabel text={p.name}/>
    </button>
  </li>)}</ul>;
}

const STATUS_LABEL: Record<ActiveTask['status'], string> = { waiting_approval: 'Needs decision', running: 'Running', queued: 'Queued' };

/** #415: the sidebar's own "TASKS" list, reading the same `/api/code/active` state as the
 *  header's ActiveCodeTasks widget (useActiveCodeTasks). Exported for tests, same reason as
 *  CodingProjectList above. */
export function CodingTaskList({ tasks, onOpen }: { tasks: ActiveTask[]; onOpen: (projectId: string) => void }): JSX.Element {
  return <ul className="coding-task-list">{tasks.map((task) => <li key={task.id}>
    <button className="project-disclosure" aria-label={`Open ${task.projectName}`} onClick={() => onOpen(task.projectId)}>
      <span className={`coding-task-status coding-task-status-${task.status}`}>{STATUS_LABEL[task.status]}</span>
      <SidebarLabel text={task.projectName}/>
    </button>
  </li>)}</ul>;
}
