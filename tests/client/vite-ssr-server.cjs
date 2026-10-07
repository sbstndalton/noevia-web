'use strict';
// #1033: the client tests load real src/ modules through Vite's SSR pipeline. A stock
// `createServer({ server: { middlewareMode: true } })` also starts everything a browser dev
// session needs, none of which these tests use:
//   - the HMR WebSocket on fixed port 24678, which every test file running in parallel fights over
//     ("WebSocket server error: Port 24678 is already in use" in every image build log);
//   - a chokidar watcher over the whole checkout;
//   - the client dependency scan: an esbuild context crawling index.html and the qa fixtures and
//     writing the shared node_modules/.vite cache. A test finishes in milliseconds, so close()
//     tears that scan down mid-flight ("The server is being restarted or closed. Request is
//     outdated" from vite:dep-scan, dozens of times per build). Twice the image build then sat at
//     idle CPU in tests/client/profile-features-request-dedup.test.cjs, a file that starts and
//     closes seven servers back to back, until it was cancelled 20+ minutes later.
// Every client test creates its server here instead, with all three switched off, so there is no
// port, no watcher and no background scan left to race a close().
//
// A watchdog backs this up: if a test file that started a Vite server is still running after
// CLIENT_TEST_FILE_TIMEOUT_MS (default 5 minutes, about 60x the slowest file), it prints what is
// keeping the process alive and exits non-zero, so a future hang fails the build with a reason
// instead of stalling it. The timer is unref'd: a file that finishes normally never waits on it.

const DEFAULT_FILE_TIMEOUT_MS = 5 * 60 * 1000;
let watchdog = null;

function armWatchdog(env = process.env) {
  if (watchdog) return watchdog;
  const configured = Number(env.CLIENT_TEST_FILE_TIMEOUT_MS);
  const ms = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_FILE_TIMEOUT_MS;
  watchdog = setTimeout(() => {
    const file = process.argv[1] || 'a client test file';
    let resources = '';
    try { resources = process.getActiveResourcesInfo().join(', '); } catch { /* older Node */ }
    process.stderr.write(`[#1033] ${file} is still running after ${ms} ms; failing instead of hanging. Active resources: ${resources || 'unknown'}\n`);
    process.exit(1);
  }, ms);
  watchdog.unref();
  return watchdog;
}

/** The options every client test server gets on top of the test's own (these always win). */
function hermeticOptions(config = {}) {
  return {
    ...config,
    server: { ...(config.server || {}), middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { ...(config.optimizeDeps || {}), noDiscovery: true, include: [] },
  };
}

/** Drop-in for `(await import('vite')).createServer` in tests/client. */
async function createServer(config = {}) {
  armWatchdog();
  const vite = await import('vite');
  return vite.createServer(hermeticOptions(config));
}

module.exports = { createServer, hermeticOptions, armWatchdog, DEFAULT_FILE_TIMEOUT_MS };
