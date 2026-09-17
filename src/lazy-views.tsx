// Views that are not needed for the first screen load as separate chunks, so
// the chat shell paints before Settings, model management or the Diary have
// downloaded. Once the page is idle every chunk is fetched in the background,
// so opening one later is still instant.
import { lazy } from 'react';
import type { ComponentType } from 'react';

type Loader<P> = () => Promise<ComponentType<P>>;

// A tab left open across a deploy asks for chunk files the new build no longer
// has. Retry once (a dropped connection), then explain instead of blanking.
function lazyView<P extends object>(load: Loader<P>) {
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
  return (
    <div className="save-error" role="alert">
      <span>This part of noevia could not be loaded. noevia may have been updated — reload the page to continue.</span>
      <button onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}

export const Diary = lazyView(() => import('./components/DiaryView').then((m) => m.DiaryView));
export const Settings = lazyView(() => import('./components/SettingsShell').then((m) => m.SettingsShell));
export const Projects = lazyView(() => import('./components/ProjectsView').then((m) => m.ProjectsView));
export const Coding = lazyView(() => import('./components/CodingWorkspace').then((m) => m.CodingWorkspace));

export function prefetchViewsWhenIdle(): () => void {
  const run = () => { for (const view of [Settings, Diary, Projects, Coding]) view.prefetch(); };
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(run, 1500);
  return () => globalThis.clearTimeout(id);
}
export const ModelManager = lazyView(() => import('./components/models/ModelManagerPage').then((m) => m.ModelManagerPage));
