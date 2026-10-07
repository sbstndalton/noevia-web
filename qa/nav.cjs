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
