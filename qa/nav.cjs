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
module.exports = { navClick };
