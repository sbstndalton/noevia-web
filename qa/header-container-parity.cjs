// #413/#414 regression guard: one page-header pattern (Settings/Customise/Projects) and one list-
// container pattern (Users/Service status/Models summary/Diary & storage), against synthetic APIs
// only (no model, no inference, no live services). Diary keeps its own compact top bar on purpose
// (docs/design-notes/page-headers.md) — checked here for left-edge/type-scale alignment with its
// own content column instead of the page-title pattern.
//
//   QA_DIST=/tmp/dist QA_SCREENSHOTS=/tmp/shots \
//   PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/header-container-parity.cjs
//
// Writes <shots>/header-container-findings.json. Exits non-zero on any finding.
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const fs = require('node:fs'), path = require('node:path');
const { withLocale } = require('./qa-locale.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const out = process.env.QA_SCREENSHOTS || '/tmp/noevia-header-container-shots';
const PORT = 31498;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// The header pattern's own tolerance: Settings is a centred modal, Customise and Projects are
// full-bleed pages — even Settings and Customise (already declared "one pattern" by #417) differ
// by up to 9px at 390px width purely from that container difference. HEADER_TOLERANCE covers the
// worst pre-existing spread between any two of the three, so a real regression (Projects' old
// 76px inset, an 85px+ miss) still fails while the modal/page difference does not.
const HEADER_TOLERANCE = 20;
const DIARY_LEFT_TOLERANCE = 2;
// Orchestrator review on #427: the title, tabs row and card grid must share one left edge and
// content column, and (once Sort/New project wrap onto their own row at phone width) the two
// must share a vertical centre and neither may run into the tab-row divider beneath them.
const COLUMN_TOLERANCE = 1;
const VCENTER_TOLERANCE = 2;

function probeProjectsLayout() {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
  };
  return {
    h1: rect(document.querySelector('.projects-title h1')),
    firstTab: rect(document.querySelector('.seg [role=tab]')),
    firstCard: rect(document.querySelector('.project-card, .projects-grid > *')),
    sort: rect(document.querySelector('.projects-sort')),
    newBtn: rect(document.querySelector('.projects-new')),
    head: rect(document.querySelector('.projects-head')),
  };
}

function probeHeaders(phone) {
  const rect = (el) => el ? el.getBoundingClientRect() : null;
  const settings = document.querySelector('.settings-detail .settings-title h1');
  const customise = document.querySelector('.plugins-head h1, .plugins-page .settings-title h1');
  const projects = document.querySelector('.projects-title h1, .projects-workspace .settings-title h1');
  const found = {};
  for (const [name, el] of [['settings', settings], ['customise', customise], ['projects', projects]]) {
    if (!el) continue;
    const r = rect(el), cs = getComputedStyle(el);
    found[name] = { top: Math.round(r.top), left: Math.round(r.left), fontSize: cs.fontSize };
  }
  return found;
}

function probeDiary() {
  const home = document.querySelector('.diary-home-link');
  const compose = document.querySelector('.diary-compose');
  const chatTitle = document.querySelector('.chat-header .header-title');
  if (!home) return null;
  const homeRect = home.getBoundingClientRect();
  const composeRect = compose ? compose.getBoundingClientRect() : null;
  return {
    left: Math.round(homeRect.left),
    contentLeft: composeRect ? Math.round(composeRect.left) : null,
    fontSize: getComputedStyle(home).fontSize,
    chatFontSize: chatTitle ? getComputedStyle(chatTitle).fontSize : null,
  };
}

// A Settings category can be zoomed by src/fit-to-viewport.ts's shrink-to-fit (a legitimate,
// separately-tested feature — spacing-rhythm.cjs's own "zoom" check), which scales computed
// border widths along with everything else in that category's own subtree. Two containers using
// the identical CSS rule can therefore report slightly different border widths purely from that
// zoom, with no difference in the rule itself — so border width compares by ratio, not equality;
// every other property (style, color, radius, shadow, background) must still match exactly.
function sameContainer(a, b) {
  if (!a || !b) return false;
  for (const key of ['background', 'shadow', 'radius', 'borderStyleColor']) if (a[key] !== b[key]) return false;
  if (!a.borderWidth || !b.borderWidth) return a.borderWidth === b.borderWidth;
  const ratio = a.borderWidth / b.borderWidth;
  return ratio > 0.6 && ratio < 1.67;
}

async function run(browser, cfg, report) {
  const { width, height, theme, family, phone = false } = cfg;
  const tag = `${family}-${theme}-${width}`;
  const page = await browser.newPage(withLocale({
    viewport: { width, height }, reducedMotion: 'reduce', deviceScaleFactor: 1,
    ...(phone ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}),
  }));
  page.setDefaultTimeout(8000);
  await page.addInitScript(({ theme, family }) => {
    localStorage.setItem('cowork-theme', theme);
    localStorage.setItem('cowork-palette-light', 'warm'); localStorage.setItem('cowork-palette-dark', 'iris');
    localStorage.setItem('noevia:theme-family', family); localStorage.setItem('noevia:density', 'comfortable');
    localStorage.removeItem('noevia:last-view');
  }, { theme, family });
  const user = { id: 'synthetic-header-qa', username: 'headerqa', displayName: 'Synthetic Header QA', role: 'admin', diaryEnabled: true, onboarded: true };
  await page.route(/\/api\/(auth\/session|profile)$/, (r) => r.fulfill({ json: { user, passkeys: [] } }));
  const project = { id: 'p1', name: 'Synthetic research', updatedAt: 1000, files: [], assets: [], memories: [], instructions: '', goal: 'Collect synthetic notes', sourceFolders: [], toolboxes: ['core'], chats: [] };
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project], freeChats: [] } }));
  const visit = async (route, ready) => { await page.goto(`http://localhost:${PORT}${route}`); await page.locator(ready).first().waitFor({ timeout: 8000 }); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(350); };

  await visit('/settings/appearance', '.settings-detail-scroll');
  const settingsHeader = await page.evaluate(probeHeaders, phone);
  // The reference grouped surface — Appearance's own .set-rows, which Contemporary and Glass
  // already retune (Contemporary drops the border/shadow entirely, families.css/theme-
  // contemporary.css). Status/Users/Models/Diary are compared against this, not a hardcoded
  // "must have a shadow" rule, so the check holds across every family.
  const reference = await page.evaluate(() => {
    const el = document.querySelector('.settings-stage .set-rows');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { background: cs.backgroundColor, borderWidth: parseFloat(cs.borderTopWidth) || 0, borderStyleColor: `${cs.borderTopStyle} ${cs.borderTopColor}`, shadow: cs.boxShadow, radius: cs.borderTopLeftRadius };
  });
  await visit('/customise/skills', '.plugins-page');
  Object.assign(settingsHeader, await page.evaluate(probeHeaders, phone));
  await visit('/projects', '.projects-title, .projects-grid');
  Object.assign(settingsHeader, await page.evaluate(probeHeaders, phone));
  const layout = await page.evaluate(probeProjectsLayout);
  await page.screenshot({ path: path.join(out, `${tag}-header-projects.png`) });

  const present = ['settings', 'customise', 'projects'].filter((k) => settingsHeader[k]);
  const findings = [];
  if (present.length < 3) findings.push({ kind: 'missing-header', tag, present });
  const fontSizes = new Set(present.map((k) => settingsHeader[k].fontSize));
  if (fontSizes.size > 1) findings.push({ kind: 'font-size-mismatch', tag, values: Object.fromEntries(present.map((k) => [k, settingsHeader[k].fontSize])) });
  const tops = present.map((k) => settingsHeader[k].top);
  if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > HEADER_TOLERANCE) {
    findings.push({ kind: 'top-offset-mismatch', tag, values: Object.fromEntries(present.map((k) => [k, settingsHeader[k].top])), tolerance: HEADER_TOLERANCE });
  }

  // The title, the first tab and the first project card must share one left edge/content column
  // (they previously drifted apart when .projects-head/.projects-grid centred within a wider
  // .settings-scroll instead of sitting flush with .projects-title).
  if (!layout.h1 || !layout.firstTab || !layout.firstCard) {
    findings.push({ kind: 'projects-column-missing', tag, layout });
  } else {
    const lefts = { h1: layout.h1.left, firstTab: layout.firstTab.left, firstCard: layout.firstCard.left };
    if (Math.max(...Object.values(lefts)) - Math.min(...Object.values(lefts)) > COLUMN_TOLERANCE) {
      findings.push({ kind: 'projects-column-mismatch', tag, lefts, tolerance: COLUMN_TOLERANCE });
    }
  }
  // Once Sort and New project wrap onto their own row at phone width, they must read as one row:
  // matching vertical centres, and neither may overlap the tab-row divider beneath them.
  if (phone) {
    if (!layout.sort || !layout.newBtn || !layout.head) {
      findings.push({ kind: 'projects-sort-new-missing', tag, layout });
    } else {
      const center = (r) => (r.top + r.bottom) / 2;
      const dCenter = Math.abs(center(layout.sort) - center(layout.newBtn));
      if (dCenter > VCENTER_TOLERANCE) {
        findings.push({ kind: 'projects-sort-new-vcenter-mismatch', tag, sort: layout.sort, newBtn: layout.newBtn, delta: dCenter, tolerance: VCENTER_TOLERANCE });
      }
      const dividerY = layout.head.bottom;
      if (layout.sort.bottom > dividerY + 0.5 || layout.newBtn.bottom > dividerY + 0.5) {
        findings.push({ kind: 'projects-sort-new-overlaps-divider', tag, sort: layout.sort, newBtn: layout.newBtn, dividerY });
      }
    }
  }

  await visit('/diary', '.chat-header');
  await page.waitForTimeout(600);
  const diary = await page.evaluate(probeDiary);
  if (!diary) findings.push({ kind: 'missing-diary-header', tag });
  else {
    if (diary.chatFontSize && diary.fontSize !== diary.chatFontSize) findings.push({ kind: 'diary-type-scale-mismatch', tag, diary: diary.fontSize, chat: diary.chatFontSize });
    // The phone nav-drawer toggle forces a fixed inset that legitimately differs from the
    // content column's own smaller gutter (docs/design-notes/page-headers.md) — checked only
    // at non-phone widths, where nothing floats over the header.
    if (!phone && diary.contentLeft != null && Math.abs(diary.left - diary.contentLeft) > DIARY_LEFT_TOLERANCE) {
      findings.push({ kind: 'diary-left-edge-mismatch', tag, header: diary.left, content: diary.contentLeft, tolerance: DIARY_LEFT_TOLERANCE });
    }
  }

  // Container parity (#414): Users, Service status, Models summary and the Diary toggle draw one
  // grouped surface; the fixture returns no real users (a synthetic 401/empty), so the row count
  // being 0 there is expected — the container-level check still runs on the surrounding .set-rows.
  await visit('/settings/status', '.settings-detail-scroll');
  const containers = await page.evaluate(([cSel, rSel]) => {
    const container = document.querySelector(cSel);
    if (!container) return null;
    const ccs = getComputedStyle(container);
    const rows = [...container.querySelectorAll(rSel)];
    // A hairline divider between rows (border-top on every row but the first) is the grouped
    // pattern working as intended; an individual card sets its OWN radius and fill on every row
    // regardless of position, which the divider never does — that combination, not "has a
    // border-top", is what actually distinguishes "still a card".
    const ownCard = (r) => {
      const rcs = getComputedStyle(r);
      return (parseFloat(rcs.borderTopLeftRadius) || 0) > 0 || (rcs.backgroundColor !== ccs.backgroundColor && rcs.backgroundColor !== 'rgba(0, 0, 0, 0)');
    };
    return {
      background: ccs.backgroundColor, borderWidth: parseFloat(ccs.borderTopWidth) || 0, borderStyleColor: `${ccs.borderTopStyle} ${ccs.borderTopColor}`, shadow: ccs.boxShadow, radius: ccs.borderTopLeftRadius,
      rowCount: rows.length,
      rowsWithOwnBorder: rows.filter(ownCard).length,
    };
  }, ['.settings-detail .set-rows', '.model-row']);
  if (!containers) findings.push({ kind: 'container-missing', tag, surface: 'status' });
  else {
    if (!sameContainer(containers, reference)) findings.push({ kind: 'container-not-grouped', tag, surface: 'status', containers, reference });
    if (containers.rowsWithOwnBorder > 0) findings.push({ kind: 'row-still-a-card', tag, surface: 'status', containers });
  }

  await visit('/settings/users', '.settings-users');
  const usersContainers = await page.evaluate(() => {
    const el = document.querySelector('.settings-users .set-rows');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { background: cs.backgroundColor, borderWidth: parseFloat(cs.borderTopWidth) || 0, borderStyleColor: `${cs.borderTopStyle} ${cs.borderTopColor}`, shadow: cs.boxShadow, radius: cs.borderTopLeftRadius };
  });
  if (!usersContainers) findings.push({ kind: 'container-missing', tag, surface: 'users' });
  else if (!sameContainer(usersContainers, reference)) findings.push({ kind: 'container-not-grouped', tag, surface: 'users', containers: usersContainers, reference });

  report.push({ tag, family, theme, width, header: settingsHeader, diary, status: containers, users: usersContainers, findings });
  await page.close();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const report = [];
  const plan = [
    { width: 1440, height: 900, theme: 'light', family: 'editorial' },
    { width: 1440, height: 900, theme: 'dark', family: 'editorial' },
    { width: 390, height: 844, theme: 'light', family: 'editorial', phone: true },
    { width: 390, height: 844, theme: 'dark', family: 'editorial', phone: true },
    { width: 1440, height: 900, theme: 'light', family: 'contemporary' },
    { width: 1440, height: 900, theme: 'dark', family: 'contemporary' },
    { width: 390, height: 844, theme: 'light', family: 'contemporary', phone: true },
  ];
  try {
    for (const cfg of plan) await run(browser, cfg, report);
  } finally { await browser.close(); await fixture.close?.(); }
  fs.writeFileSync(path.join(out, 'header-container-findings.json'), JSON.stringify(report, null, 1));
  const allFindings = report.flatMap((r) => r.findings);
  console.log(`header-container-parity: ${report.length} configs in ${out}; findings=${allFindings.length}`);
  for (const f of allFindings) console.log('  -', JSON.stringify(f));
  if (allFindings.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
