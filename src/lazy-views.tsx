// Views that are not needed for the first screen load as separate chunks, so
// the chat shell paints before Settings, model management or the Diary have
// downloaded. Once the page is idle every chunk is fetched in the background,
// so opening one later is still instant.
import { lazy } from 'react';
import type { ComponentType } from 'react';
import { useT } from './i18n';
import type { MessageKey } from './i18n';

type Loader<P> = () => Promise<ComponentType<P>>;

// A tab left open across a deploy asks for chunk files the new build no longer
// has. Retry once (a dropped connection), then explain instead of blanking.
export function lazyView<P extends object>(load: Loader<P>) {
  let pending: Promise<ComponentType<P>> | null = null;
  const fetchOnce = () => {
    pending ??= load().catch(() => load()).catch((error) => { pending = null; throw error; });
    return pending;
  };
  const View = lazy(() => fetchOnce().then(
    (component) => ({ default: component }),
    () => ({ default: UpdatedNotice as ComponentType<P> }),
  ));
  return { View, prefetch: () => { void fetchOnce().catch(() => undefined); } };
}

function UpdatedNotice() {
  const t = useT();
  return (
    <div className="save-error" role="alert">
      <span>{t('viewLoading.updatedText')}</span>
      <button onClick={() => window.location.reload()}>{t('viewLoading.reload')}</button>
    </div>
  );
}

export const Diary = lazyView(() => import('./components/DiaryView').then((m) => m.DiaryView));
export const Settings = lazyView(() => import('./components/SettingsShell').then((m) => m.SettingsShell));
export const Projects = lazyView(() => import('./components/ProjectsView').then((m) => m.ProjectsView));
// Customise (skills, connectors, plugins) carries the connector catalogue and the Settings strings.
export const Customise = lazyView(() => import('./components/plugins/PluginsView').then((m) => m.PluginsView));
export const Coding = lazyView(() => import('./components/CodingWorkspace').then((m) => m.CodingWorkspace));

export function prefetchViewsWhenIdle(): () => void {
  const run = () => { for (const view of [Settings, Customise, Diary, Projects, Coding]) view.prefetch(); };
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(run, 1500);
  return () => globalThis.clearTimeout(id);
}
export const ModelManager = lazyView(() => import('./components/models/ModelManagerPage').then((m) => m.ModelManagerPage));

// A lowercase id translates through viewLoading.<id>; anything else (e.g. the model manager's
// own name, owned by a different chunk) renders as given rather than failing to resolve.
const VIEW_NAME_KEY: Record<string, MessageKey> = {
  customise: 'viewLoading.customise',
  settings: 'viewLoading.settings',
  diary: 'viewLoading.diary',
  projects: 'viewLoading.projects',
  coding: 'viewLoading.coding',
};

/** Only the active destination announces; the Diary can preload while hidden. */
export function ViewLoading({ name, active = true, settings = false }: { name: string; active?: boolean; settings?: boolean }) {
  const tt = useT();
  if (!active) return null;
  const key = VIEW_NAME_KEY[name];
  const label = key ? tt(key) : name;
  return <div className={`view-loading${settings ? ' settings-stage' : ''}`} role="status">{tt('viewLoading.text', { name: label })}</div>;
}
