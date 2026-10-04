const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const profile = await fs.mkdtemp(path.resolve('.local-test/ui-visual-'));
  const app = await electron.launch({ args: [process.cwd()], env: { ...process.env, API_MANAGER_PRODUCTION: '1', API_MANAGER_TEST_MODE: '1', API_MANAGER_DATA_DIR: profile } });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).waitFor();
    await page.evaluate(async () => {
      const { workspace } = await window.apiManager.loadWorkspace();
      const seed = workspace.tabs[0];
      workspace.tabs = Array.from({ length: 7 }, (_, index) => ({ ...structuredClone(seed), id: crypto.randomUUID(), request: { ...structuredClone(seed.request), id: crypto.randomUUID(), name: ['Get customers', 'Create customer', 'Update order', 'Product details', 'SOAP customer', 'Local health', 'Search products'][index] } }));
      workspace.activeTabId = workspace.tabs[0].id;
      const active = workspace.tabs[0]; active.request.url = 'https://api.example.com/customers';
      active.response = { status: 200, statusText: 'OK', duration: 42, size: 180, url: active.request.url, receivedAt: new Date().toISOString(), headers: [{ id: crypto.randomUUID(), key: 'Content-Type', value: 'application/json', enabled: true }], body: JSON.stringify({ customers: [{ id: 1, name: 'Asha', status: 'active' }, { id: 2, name: 'Ravi', status: 'active' }], total: 2 }) };
      await window.apiManager.saveWorkspace(workspace);
    });
    await page.reload(); await expect(page.locator('.response-body .view-lines')).toContainText('Asha');
    await expect(page.locator('.response-body .editor-loading')).toHaveCount(0);
    for (const theme of ['dark', 'light']) {
      await page.locator('.sidebar-rail').getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('combobox', { name: 'Application theme' }).selectOption(theme);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      let frame;
      await expect.poll(async () => {
        frame = await app.evaluate(async ({ BrowserWindow }) => { const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); return { png: image.toPNG().toString('base64'), corner: image.toBitmap()[0] }; });
        return theme === 'light' ? frame.corner > 190 : frame.corner < 90;
      }, { timeout: 10000 }).toBe(true);
      await fs.writeFile(path.resolve(`.local-test/ui-${theme}-20261003.png`), Buffer.from(frame.png, 'base64'));
    }
    console.log('Isolated desktop UI images captured in both themes.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
