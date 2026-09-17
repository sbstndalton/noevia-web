import { ShellIcon } from './ShellIcon';

/** The one close ("×") control for dialogs, popups and panels. Every such
 *  surface should render this instead of its own button + glyph, so hover,
 *  sizing and hit target stay identical everywhere. */
export function CloseButton({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="shell-icon-button" onClick={onClick} title={label} aria-label={label}>
      <ShellIcon name="close" />
    </button>
  );
}
