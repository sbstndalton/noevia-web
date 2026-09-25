import type { JSX, ReactNode } from 'react';
import type { InstalledModel, Project } from '../types';
import { ShellIcon } from './ShellIcon';
import { useT } from '../i18n';

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { icon: string; onClick: () => void; aria: string };
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="insp-section">
      <div className="insp-head">
        <h3>{title}</h3>
        {action && (
          <button className="insp-action" onClick={action.onClick} aria-label={action.aria} title={action.aria}>
            <ShellIcon name={action.icon} size={15} />
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
  const t = useT();
  const model = project?.model || models.find((m) => m.loaded)?.name || t('inspector.notSelected');

  return (
    <aside id="noevia-inspector" className="noevia-inspector" aria-label={t('inspector.contextAria')}>
      <header className="insp-bar">
        <h2>{project ? project.name : t('inspector.contextTitle')}</h2>
      </header>

      <Section
        title={t('inspector.model')}
        action={{ icon: 'settings', onClick: onConfigureModels, aria: t('inspector.configureAria') }}
      >
        <p className="insp-value">{model}</p>
        <p className="insp-note">
          {t('inspector.routing', { value: project?.routing === 'auto' ? t('inspector.routingAuto') : t('inspector.routingManual') })}
        </p>
      </Section>

      {project ? (
        <>
          <Section
            title={t('inspector.instructions')}
            action={{ icon: 'edit', onClick: () => onEditProject(project.id), aria: t('inspector.editInstructionsAria') }}
          >
            {project.instructions ? (
              <p className="insp-note insp-clamp">{project.instructions}</p>
            ) : (
              <p className="insp-empty">{t('inspector.noInstructions')}</p>
            )}
          </Section>

          <Section
            title={t('inspector.sources')}
            action={{ icon: 'new', onClick: () => onEditProject(project.id), aria: t('inspector.addSourcesAria') }}
          >
            {project.files.length ? (
              <ul className="insp-list">
                {project.files.map((f) => <li key={f.name}>{f.name}</li>)}
              </ul>
            ) : (
              <p className="insp-empty">{t('inspector.noSources')}</p>
            )}
          </Section>

          <Section title={t('inspector.memory')}>
            {project.memories.length ? (
              <ul className="insp-list">
                {project.memories.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            ) : (
              <p className="insp-empty">{t('inspector.noMemory')}</p>
            )}
          </Section>
        </>
      ) : (
        <Section title={t('inspector.project')}>
          <p className="insp-empty">{t('inspector.openProjectHint')}</p>
        </Section>
      )}
    </aside>
  );
}
