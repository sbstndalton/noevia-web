// #492: render the real signed-out and fresh-setup screens without entering credentials.
// All APIs are synthetic; non-GET requests are rejected and counted as failures.
// QA_DIST=/tmp/build QA_SCREENSHOTS=/tmp/auth-shapes node qa/theme-auth-shapes-492.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const out = process.env.QA_SCREENSHOTS || '/tmp/noevia-theme-auth';
const port = Number(process.env.QA_PORT || 31493);
const checks = [], errors = [], writes = [];
const check = (ok, description, detail) => checks.push({ ok, description, detail });

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(port);
  await fixture.listen();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) for (const family of ['editorial', 'contemporary', 'glass']) {
      const name = `${family}-${theme}-${width}`;
      const action = { editorial: 10, contemporary: 999, glass: 12 }[family];
      const surface = { editorial: 20, contemporary: 28, glass: 24 }[family];
      const input = { editorial: 10, contemporary: 4, glass: 12 }[family];
      const inlineCode = { editorial: 6, contemporary: 4, glass: 8 }[family];
      const page = await browser.newPage(withLocale({ viewport: { width, height: 1000 }, hasTouch: width === 390, isMobile: width === 390 }));
      page.on('pageerror', error => errors.push({ name, error: error.message }));
      await page.route('https://**/*', route => route.abort());
      let configured = true;
      await page.route('**/api/**', route => {
        const request = route.request();
        if (request.method() !== 'GET') {
          writes.push({ name, method: request.method(), url: request.url() });
          return route.fulfill({ status: 405, json: { error: 'Synthetic read-only authentication fixture' } });
        }
        const pathname = new URL(request.url()).pathname;
        if (pathname === '/api/setup/status') return route.fulfill({ json: { configured, publicOrigin: `http://localhost:${port}` } });
        if (pathname === '/api/auth/session') return route.fulfill({ status: 401, json: { error: 'Synthetic signed-out session' } });
        return route.fulfill({ json: {} });
      });
      await page.addInitScript(({ family, theme }) => {
        localStorage.setItem('cowork-theme', theme);
        localStorage.setItem('noevia:theme-family', family);
      }, { family, theme });
      const inspect = async state => {
        const card = page.locator('.auth-card');
        await card.waitFor();
        const shapes = await card.evaluate(element => ({
          card: getComputedStyle(element).borderTopLeftRadius,
          buttons: [...element.querySelectorAll('button')].map(button => ({ text: button.textContent, radius: getComputedStyle(button).borderTopLeftRadius })),
          fields: [...element.querySelectorAll('input:not([type="checkbox"])')].map(field => ({ id: field.id, radius: getComputedStyle(field).borderTopLeftRadius })),
          code: [...element.querySelectorAll('code')].map(code => getComputedStyle(code).borderTopLeftRadius),
          credentialsEmpty: [...element.querySelectorAll('input[type="password"], input[autocomplete="username"], input[autocomplete="name"]')].every(field => field.value === ''),
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        }));
        check(shapes.card === `${surface}px`, `${name} ${state}: card retains surface role`, shapes.card);
        check(shapes.buttons.length > 0 && shapes.buttons.every(button => button.radius === `${action}px`), `${name} ${state}: every primary and secondary action follows button role`, shapes.buttons);
        check(shapes.fields.every(field => field.radius === `${input}px`), `${name} ${state}: fields follow input role`, shapes.fields);
        if (shapes.code.length) check(shapes.code.every(radius => radius === `${inlineCode}px`), `${name} ${state}: inline code follows compact role`, shapes.code);
        check(shapes.credentialsEmpty, `${name} ${state}: no credentials entered`);
        check(!shapes.overflow, `${name} ${state}: no horizontal overflow`);
        await page.screenshot({ path: path.join(out, `${name}-${state}.png`), fullPage: true });
        await page.evaluate(() => document.documentElement.style.setProperty('--radius-button', '17px'));
        const radii = await card.locator('button').evaluateAll(buttons => buttons.map(button => getComputedStyle(button).borderTopLeftRadius));
        check(radii.every(radius => radius === '17px'), `${name} ${state}: changed action token propagates to every button`, radii);
        await page.evaluate(() => document.documentElement.style.removeProperty('--radius-button'));
      };
      await page.goto(`http://localhost:${port}`);
      await page.getByRole('heading', { name: 'Sign in to noevia' }).waitFor();
      await inspect('login');
      configured = false;
      await page.reload();
      await page.getByRole('button', { name: 'Get started', exact: true }).waitFor();
      await inspect('setup-welcome');
      await page.getByRole('button', { name: 'Get started', exact: true }).click();
      await page.getByRole('button', { name: 'Chat only', exact: true }).waitFor();
      await inspect('setup-choice');
      await page.getByRole('button', { name: 'Chat only', exact: true }).click();
      await page.locator('#wiz-code').waitFor();
      await inspect('setup-account');
      await page.close();
    }
    check(errors.length === 0, 'no browser errors', errors);
    check(writes.length === 0, 'no authentication or setup writes attempted', writes);
    const failures = checks.filter(check => !check.ok);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, failures, errors, writes }, null, 2));
    console.log(`${checks.length} checks; ${failures.length} failures; ${errors.length} browser errors; ${writes.length} writes; ${out}`);
    if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
