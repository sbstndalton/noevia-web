import { Fragment } from 'react';
import type { JSX } from 'react';
import { urlParts } from '../url-wrap';

/** An address that wraps at its slashes, dots and hyphens before it breaks inside a word (#1613). */
export function UrlText({ text }: { text: string }): JSX.Element {
  const parts = urlParts(text);
  return <>{parts.map((part, i) => <Fragment key={i}>{part}{i < parts.length - 1 ? <wbr /> : null}</Fragment>)}</>;
}
