import { Component } from 'react';
import type { ReactNode } from 'react';

/** Keep settings navigation and Close usable if an individual panel fails. */
export class SettingsPanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert">
      <h2>This panel couldn’t be displayed</h2>
      <p>You can retry or choose another settings category.</p>
      <button className="btn btn-secondary" onClick={() => this.setState({ failed: false })}>Retry panel</button>
    </div>;
    return this.props.children;
  }
}
