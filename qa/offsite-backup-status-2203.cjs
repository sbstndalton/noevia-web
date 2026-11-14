'use strict';
// sbstndalton/noevia#2203: the Settings > Backups page now says when the last backup is incomplete (with the count), when saved
// snapshots cannot be read, when a scheduled run is paused for a quiet window and when backups are backing off, and offers "This is a
// new store" (confirmed, POST /api/admin/offsite-backup/new-store) when the empty-destination refusal is the last problem.
// 375 and 1280 px, light and dark. Offline (diary-fixture.cjs, mocked status). Fails on a build of main (none of it is shown).
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [1280, 900, 'light'], [1280, 900, 'dark']];
const NOW = Date.UTC(2026, 10, 14, 6, 0, 0);
const EMPTY = 'The backup destination is empty, but backups were made to it before. Check that it is mounted and is the right folder or bucket; nothing was written. If it really is a new store, an administrator confirms that with POST /api/admin/offsite-backup/new-store.';
const base = () => ({
  enabled: true, ready: true, reason: null, busy: null, schedule: 'Daily at 02:00 (server time)', retention: '7 daily, 4 weekly, 6 monthly', destination: '/offsite', paths: 3,
  scheduleHour: 2, retentionPolicy: { daily: 7, weekly: 4, monthly: 6 }, destinationFolder: { path: '/offsite', mirror: null },
  lastBackup: { at: NOW - 3600e3, id: 'qa-snap-1', files: 120, uploadedBytes: 5e6 }, lastVerify: null, lastError: null, snapshots: 3, google: null,
});

async function backupsPage(browser, origin, view, status) {
  const page = await themedPage(browser, view);
  const posts = [];
  await page.route('**/api/**', (route) => {
    const req = route.request(), p = new URL(req.url()).pathname, json = (b, code = 200) => route.fulfill({ status: code, json: b });
    if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
    if (p === '/api/admin/offsite-backup/new-store' && req.method() === 'POST') { posts.push(p); status.current = { ...base(), lastBackup: null, snapshots: null }; return json({ newStore: true }); }
    if (p === '/api/admin/offsite-backup') return json(status.current);
    return route.continue();
  });
  await page.goto(`${origin}/settings/backups`);
  await page.getByRole('heading', { name: 'Backups', exact: true }).first().waitFor({ timeout: 15000 });
  return { page, posts };
}

run('offsite-backup-status-2203', Number(process.env.QA_PORT || 32203), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const [width, , theme] = view;
    await check(`${width} px ${theme}: an incomplete last backup, unreadable snapshots, a quiet-window wait and backoff are each said`, async () => {
      const status = { current: { ...base(), lastBackup: { at: NOW - 3600e3, id: 'qa-snap-1', files: 120, uploadedBytes: 5e6, incomplete: true, skipped: 3 }, unreadableSnapshots: 2, waitingForQuietWindow: true, backupRetry: { at: NOW, failures: 2, attempts: 2 } } };
      const { page } = await backupsPage(browser, origin, view, status);
      try {
        await page.getByText('The last backup is incomplete: 3 files could not be copied and were left out.').waitFor({ timeout: 5000 });
        await page.getByText('2 saved snapshots could not be read. Old backup data is not cleaned up until they can be.').waitFor({ timeout: 5000 });
        await page.getByText('A scheduled backup is paused while the host runs its own backups.').waitFor({ timeout: 5000 });
        await page.getByText('Backups are backing off after 2 failed attempts.').waitFor({ timeout: 5000 });
        assert.equal(await page.getByRole('button', { name: 'This is a new store' }).count(), 0, 'no new-store offer without the empty-destination refusal');
        await shot(page, `offsite-backup-status-2203-notes-${width}-${theme}`);
      } finally { await page.close(); }
    });
    await check(`${width} px ${theme}: an empty destination that had backups offers a confirmed "new store" and clears once answered`, async () => {
      const status = { current: { ...base(), lastError: { at: NOW, during: 'backup', message: EMPTY, failures: 1 } } };
      const { page, posts } = await backupsPage(browser, origin, view, status);
      try {
        await page.getByText('The destination is empty, but backups were made to it before.').waitFor({ timeout: 5000 });
        await page.getByRole('button', { name: 'This is a new store' }).click();
        await shot(page, `offsite-backup-status-2203-confirm-${width}-${theme}`);
        assert.equal(posts.length, 0, 'asking is not confirming');
        await page.getByRole('button', { name: 'Cancel' }).click();
        await page.getByRole('button', { name: 'This is a new store' }).waitFor();
        await page.getByRole('button', { name: 'This is a new store' }).click();
        await page.getByRole('button', { name: 'Yes, start a new store' }).click();
        await page.getByText('The destination is empty, but backups were made to it before.').waitFor({ state: 'detached', timeout: 5000 });
        assert.equal(posts.length, 1, 'one POST to /api/admin/offsite-backup/new-store');
      } finally { await page.close(); }
    });
  }
});
