import type { JSX, TextareaHTMLAttributes } from 'react';

/** The message box shared by chat, projects and the Diary: Enter sends,
 *  Shift+Enter adds a line, and nothing sends mid-IME composition. */
export function ComposerTextarea({ value, onValue, onSubmit, className = '', ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onKeyDown'> & {
  value: string;
  onValue: (value: string) => void;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <textarea
      {...rest}
      className={`composer-input${className ? ` ${className}` : ''}`}
      value={value}
      onChange={(e) => onValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  );
}
