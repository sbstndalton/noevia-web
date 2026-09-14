import type { JSX, ReactNode } from 'react';
import type { InstalledModel, Project } from '../types';

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onClick: () => void; aria: string };
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="insp-section">
      <div className="insp-head">
        <h3>{title}</h3>
        {action && (
          <button className="insp-action" onClick={action.onClick} aria-label={action.aria}>
            {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** Persistent context for project chats; stacks below on narrow screens. */
export function Inspector({
  project,
  models,
  onConfigureModels,
  onEditProject,
}: {
  project: Project | null;
  models: InstalledModel[];
  onConfigureModels: () => void;
  onEditProject: (id: string) => void;
}): JSX.Element {
  const model = project?.model || models.find((m) => m.loaded)?.name || 'Not selected';

  return (
    <aside id="noevia-inspector" className="noevia-inspector" aria-label="Project context">
      <header className="insp-bar">
        <h2>{project ? project.name : 'Context'}</h2>
      </header>

      <Section
        title="Model"
        action={{ label: '⚙', onClick: onConfigureModels, aria: 'Configure models and routing' }}
      >
        <p className="insp-value">{model}</p>
        <p className="insp-note">
          Routing: {project?.routing === 'auto' ? 'Auto · Fast / Smart' : 'Manual'}
        </p>
      </Section>

      {project ? (
        <>
          <Section
            title="Instructions"
            action={{ label: '✎', onClick: () => onEditProject(project.id), aria: 'Edit project instructions' }}
          >
            {project.instructions ? (
              <p className="insp-note insp-clamp">{project.instructions}</p>
            ) : (
              <p className="insp-empty">No standing instructions yet.</p>
            )}
          </Section>

          <Section
            title="Sources"
            action={{ label: '+', onClick: () => onEditProject(project.id), aria: 'Add sources' }}
          >
            {project.files.length ? (
              <ul className="insp-list">
                {project.files.map((f) => <li key={f.name}>{f.name}</li>)}
              </ul>
            ) : (
              <p className="insp-empty">No sources attached.</p>
            )}
          </Section>

          <Section title="Memory">
            {project.memories.length ? (
              <ul className="insp-list">
                {project.memories.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            ) : (
              <p className="insp-empty">Nothing saved yet.</p>
            )}
          </Section>
        </>
      ) : (
        <Section title="Project">
          <p className="insp-empty">Open a project to see its sources and memory.</p>
        </Section>
      )}
    </aside>
  );
}
