import type { JSX } from 'react';
import type { InstalledModel, Project, RouteRule } from '../../types';
import { ShellIcon } from '../ShellIcon';
import { ModelsSettings } from './ModelsSettings';

/** The model manager as a page of its own. It outgrew the settings dialog:
 *  catalogues, benchmarks and hardware charts need the full width. */
export function ModelManagerPage({ onBack, ...props }: { onBack: () => void; models: InstalledModel[]; routes: RouteRule[]; projects: Project[]; modelsError: string | null }): JSX.Element {
  return <div className="main model-manager-page">
    <div className="settings-scroll">
      <div className="model-manager-head">
        <button className="settings-back" onClick={onBack}><ShellIcon name="arrow"/>Settings</button>
      </div>
      <ModelsSettings {...props} />
    </div>
  </div>;
}
