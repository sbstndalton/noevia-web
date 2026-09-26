import { forwardRef, useLayoutEffect, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { composerKeyAction, useAccountPreferences } from '../user-preferences';
import { sendHintText, useT } from '../i18n';
import { isApple } from './shortcuts/shortcuts';

/** Grows `el` to fit its content up to the CSS `max-height` already set for this composer
 *  (chat/project/diary each set their own), then lets it scroll internally beyond that. Read
 *  from the computed style rather than a prop so each surface's own CSS stays the single source
 *  of truth (#434) — `field-sizing: content` alone doesn't cover Safari/Firefox yet. Height is
 *  synced from `value` itself (not just the input handler), so a draft restore, loading a message
 *  for edit, or clearing after send all resize it the same way a keystroke would. */
function syncComposerHeight(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  const max = parseFloat(getComputedStyle(el).maxHeight);
  const capped = Number.isFinite(max) && max > 0;
  const next = capped ? Math.min(el.scrollHeight, max) : el.scrollHeight;
  el.style.height = `${next}px`;
  el.style.overflowY = capped && el.scrollHeight > max ? 'auto' : 'hidden';
}

/** The message box shared by chat, projects and the Diary. Enter sends and Shift+Enter adds a
 *  line, or, with Settings → Keyboard & input set to ⌘/Ctrl+Enter (#230), the reverse; nothing
 *  sends mid-IME composition. The hint is exposed as the field's description and tooltip.
 *  Auto-grows with content up to the surface's own max-height, then scrolls internally (#434).
 *  Forwards its ref to the underlying `<textarea>` so a caller (chat's Send/Stop focus recovery,
 *  #435) can read or move focus without a second, parallel ref. */
export const ComposerTextarea = forwardRef<HTMLTextAreaElement, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onKeyDown'> & {
  value: string;
  onValue: (value: string) => void;
  onSubmit: () => void;
}>(function ComposerTextarea({ value, onValue, onSubmit, className = '', ...rest }, forwardedRef) {
  const { sendKey } = useAccountPreferences();
  const t = useT();
  const hint = sendHintText(t, sendKey, typeof navigator !== 'undefined' && isApple(navigator.platform || navigator.userAgent));
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  // Runs before paint so a programmatic value change (draft restore, edit-message load, the
  // clear right after send) never flashes the old height first; a plain useEffect would.
  useLayoutEffect(() => {
    if (innerRef.current) syncComposerHeight(innerRef.current);
  }, [value]);
  return (
    <textarea
      title={hint}
      aria-description={hint}
      {...rest}
      ref={(el) => {
        innerRef.current = el;
        if (typeof forwardedRef === 'function') forwardedRef(el);
        else if (forwardedRef) forwardedRef.current = el;
      }}
      className={`composer-input${className ? ` ${className}` : ''}`}
      value={value}
      onChange={(e) => onValue(e.target.value)}
      onKeyDown={(e) => {
        if (composerKeyAction({ key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, isComposing: e.nativeEvent.isComposing }, sendKey) === 'send') {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  );
});
