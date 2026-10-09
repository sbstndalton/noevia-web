import { useEffect, useState } from 'react';

// #1184: LaTeX in chat replies. KaTeX is loaded on first use so it stays out of the main
// bundle; its CSS and fonts are bundled by Vite and served from this origin (CSP: 'self').
// `trust` stays off and `throwOnError` is off, so model output can't produce links/HTML and a
// bad expression degrades to its own source text.
type Katex = typeof import('katex').default;
let katexPromise: Promise<Katex> | null = null;
const loadKatex = (): Promise<Katex> => (katexPromise ??= Promise.all([
  import('katex'),
  import('katex/dist/katex.min.css'),
]).then(([m]) => m.default));

// Bounds on what a model reply can ask the typesetter for (a huge \rule or macro expansion).
const MAX_TEX_CHARS = 5000;

export function MathSpan({ tex, display = false }: { tex: string; display?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const tooLong = tex.length > MAX_TEX_CHARS;
  useEffect(() => {
    let live = true;
    setHtml(null);
    if (tooLong) return () => { live = false; };
    loadKatex().then(k => {
      if (!live) return;
      try { setHtml(k.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, maxSize: 20, maxExpand: 200, output: 'htmlAndMathml' })); }
      catch { /* keep the source text */ }
    }).catch(() => { /* chunk failed to load: keep the source text */ });
    return () => { live = false; };
  }, [tex, display, tooLong]);
  const Tag = 'span'; // a <div> would be invalid inside the <p> that holds inline text
  if (html === null) return <Tag className={display ? 'md-math md-math-display md-math-raw' : 'md-math md-math-raw'}>{display ? `$$${tex}$$` : `$${tex}$`}</Tag>;
  return <Tag className={display ? 'md-math md-math-display' : 'md-math'} data-math="rendered" dangerouslySetInnerHTML={{ __html: html }} />;
}
