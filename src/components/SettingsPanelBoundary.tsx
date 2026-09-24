import { Component } from 'react';
import type { ReactNode } from 'react';
import { t } from '../i18n';

/** Keep settings navigation and Close usable if an individual panel fails. */
export class SettingsPanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert">
      <h2>{t('error.panel.title')}</h2>
      <p>{t('error.panel.body')}</p>
      <button className="btn btn-secondary" onClick={() => this.setState({ failed: false })}>{t('error.panel.retry')}</button>
    </div>;
    return this.props.children;
  }
}
