import type { JSX, TextareaHTMLAttributes } from 'react';
import { composerKeyAction, useAccountPreferences } from '../user-preferences';
import { sendHintText, useT } from '../i18n';
import { isApple } from './shortcuts/shortcuts';

/** The message box shared by chat, projects and the Diary. Enter sends and Shift+Enter adds a
 *  line, or, with Settings → Keyboard & input set to ⌘/Ctrl+Enter (#230), the reverse; nothing
 *  sends mid-IME composition. The hint is exposed as the field's description and tooltip. */
export function ComposerTextarea({ value, onValue, onSubmit, className = '', ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onKeyDown'> & {
  value: string;
  onValue: (value: string) => void;
  onSubmit: () => void;
}): JSX.Element {
  const { sendKey } = useAccountPreferences();
  const t = useT();
  const hint = sendHintText(t, sendKey, typeof navigator !== 'undefined' && isApple(navigator.platform || navigator.userAgent));
  return (
    <textarea
      title={hint}
      aria-description={hint}
      {...rest}
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
}
