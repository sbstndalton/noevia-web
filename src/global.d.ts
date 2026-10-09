// Injected by vite.config.ts `define` at build time (see scripts/stamp-icons.cjs
// for the matching version.json, both read from STAMP_VERSION/package.json).
declare const __NOEVIA_BUILD__: string;
// Vite sets import.meta.env.DEV (true only under `vite dev`); production bundles fold it to false.
interface ImportMeta { readonly env: { readonly DEV: boolean } }
declare module 'katex/dist/katex.min.css';
