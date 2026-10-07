# noevia-web

The noevia React client: `src/`, `public/`, `index.html`, the Vite/TypeScript config, build
scripts, client tests (`tests/client/`) and the client QA scripts (`qa/`). `contracts/` is a pinned
copy of [noevia-core](https://github.com/sbstndalton/noevia-core)'s `contracts/`.

Split out of [sbstndalton/noevia](https://github.com/sbstndalton/noevia) `apps/web/` by
`tools/repo-split` (issue #952, ADR 0001). Every file except this README and `.github/` is noevia
history filtered to the client paths; the last commit names the noevia SHA it was cut from
(`Split-Source:`).

This repo is the source of truth for these paths since the cutover (noevia #952, cut at noevia
`f42f65f1`). A release uses the SHA pinned as `NOEVIA_WEB_REF` in noevia's
`release/versions.lock`; bump it there to ship a change made here.

## CI

`.github/workflows/ci.yml` builds a noevia-shaped workspace (noevia `main` for the integration
files, noevia-core and noevia-services `main`, this checkout on top) and runs the client typecheck,
the `src`/`server` boundary check, the client tests, the frontend build, and the web image build.
Releases are assembled in noevia from the SHA pinned in `release/versions.lock`.
