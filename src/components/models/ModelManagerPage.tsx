import type { JSX } from 'react';
import type { InstalledModel, Project, RouteRule } from '../../types';
import { ShellIcon } from '../ShellIcon';
import { ModelsSettings } from './ModelsSettings';
import { useT } from '../../i18n';
// Registers the English model manager strings (#293); this lazy root is their only importer, so
// they travel in this chunk and every panel below can rely on them being registered.
import '../../i18n/models';

/** The model manager as a page of its own. It outgrew the settings dialog:
 *  catalogues, benchmarks and hardware charts need the full width. */
export function ModelManagerPage({ onBack, ...props }: { onBack: () => void; initialModel?: string; models: InstalledModel[]; routes: RouteRule[]; projects: Project[]; modelsError: string | null }): JSX.Element {
  const t = useT();
  return <div className="main model-manager-page">
    <div className="settings-scroll">
      <div className="model-manager-head">
        <button className="settings-back" onClick={onBack}><ShellIcon name="arrow"/>{t('settings.title')}</button>
      </div>
      <ModelsSettings {...props} />
    </div>
  </div>;
}
