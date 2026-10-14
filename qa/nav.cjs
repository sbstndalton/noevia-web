// Sidebar navigation that works at every width: below 600px the sidebar is a
// drawer behind "Open navigation", so open it first when that toggle is showing.
async function navClick(page, name) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.getByRole('dialog', { name: 'Navigation' }).waitFor();
  }
  const sidebar = page.locator('.sidebar');
  const entry = sidebar.getByRole('button', { name, exact: true }).and(page.locator('.nav-item'));
  await (await entry.count() ? entry : sidebar.getByRole('button', { name, exact: true })).first().click();
}
// Opens Settings at every width, from the account menu (in the drawer on a phone). #510: the
// chat header's sliders open the chat's own settings (its project, or its model and tools), so
// they are no longer a way into Settings. A view that still shows a "Settings" titled control
// uses it.
async function openSettings(page) {
  await page.locator('[title="Settings"], .account-trigger, .nav-drawer-toggle').filter({ visible: true }).first().waitFor();
  const header = page.getByTitle('Settings', { exact: true }).first();
  if (await header.isVisible()) { await header.click(); return; }
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.getByRole('dialog', { name: 'Navigation' }).waitFor();
  }
  await page.getByRole('button', { name: /Account menu for/ }).filter({ visible: true }).first().click();
  await page.locator('.account-popover').getByRole('menuitem', { name: 'Settings', exact: true }).click();
}
module.exports = { navClick, openSettings };

// #1008: Models & routing has four sections; the eight old tab names map onto them. Opens the
// section and, for a panel inside one, opens that panel (or switches Installed/Discover).
const MODELS_TABS = {
  'Your models': ['Models', null, 'Installed'], Discover: ['Models', null, 'Discover'], Routing: ['Routing'],
  Overview: ['Performance', 'status'], Hardware: ['Performance', 'hardware'], Benchmarks: ['Performance', 'benchmarks'],
  Projects: ['Advanced', 'projects'], Prompts: ['Advanced', 'prompts'],
};
async function openModelsTab(root, old) {
  const [section, panel, list] = MODELS_TABS[old] || [old];
  await root.getByRole('tab', { name: section, exact: true }).click();
  if (list) await root.getByRole('radio', { name: list, exact: true }).click();
  if (panel) {
    const fold = root.locator(`details[data-panel="${panel}"]`);
    if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').first().click();
  }
}
module.exports.openModelsTab = openModelsTab;

// #1025/#1030: there is no standalone Tools button. The tool catalogue opens from the "Browse
// tools" row in the composer's + menu. The row closes the menu itself, so the catalogue is the
// only thing left open afterwards.
async function openToolCatalogue(page) {
  await page.getByRole('button', { name: /^Add files and tools/ }).first().click();
  const row = page.locator('.composer-actions-panel .composer-browse-tools');
  await row.waitFor();
  await row.click();
}
module.exports.openToolCatalogue = openToolCatalogue;

// noevia#1697: one way into Models and routing for the qa scripts. #1503 renamed the Settings
// entry from "Models & routing" to "Models and routing", which left scripts that hard-coded the
// old label timing out. By default this takes the user's path (Settings -> Models and routing ->
// Open model manager); { direct: true } loads the /models route instead. Either way it resolves
// once the model manager page is on screen and returns it.
const MODELS_SECTION = 'Models and routing';
async function openModelsPage(page, origin, { direct = false } = {}) {
  const root = page.locator('.model-manager-page');
  if (direct) {
    await page.goto(`${origin}/models`);
  } else {
    await page.goto(origin);
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: MODELS_SECTION, exact: true }).click();
    await settings.getByRole('button', { name: 'Open model manager', exact: true }).click();
  }
  await root.waitFor();
  return root;
}
module.exports.openModelsPage = openModelsPage;
module.exports.MODELS_SECTION = MODELS_SECTION;
