# noevia-web

The noevia React client: `src/`, `public/`, `index.html`, the Vite/TypeScript config, build
scripts, client tests (`tests/client/`) and the client QA scripts (`qa/`). `contracts/` is a pinned
copy of [noevia-core](https://github.com/sbstndalton/noevia-core)'s `contracts/`.

Split out of [sbstndalton/noevia](https://github.com/sbstndalton/noevia) `apps/web/` by
`tools/repo-split` (issue #952, ADR 0001). Every file except this README and `.github/` is noevia
history filtered to the client paths; the last commit names the noevia SHA it was cut from
(`Split-Source:`).

**Until the cutover in `docs/repo-split-cutover.md` (in noevia) is done, noevia is still the source
of truth.** This repo is re-extracted at the cut SHA and force-replaced, so do not commit here yet;
make changes in noevia `apps/web/`.

## CI

`.github/workflows/ci.yml` builds a noevia-shaped workspace (noevia `main` for the integration
files, noevia-core and noevia-services `main`, this checkout on top) and runs the client typecheck,
the `src`/`server` boundary check, the client tests, the frontend build, and the web image build.
Releases are assembled in noevia from the SHA pinned in `release/versions.lock`.
