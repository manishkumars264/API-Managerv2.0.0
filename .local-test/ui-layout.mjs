import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const dataDir = await fs.mkdtemp(path.join(root, '.local-test', 'layout-'));
const app = await electron.launch({ args: [root], env: { ...process.env, API_MANAGER_PRODUCTION: '1', API_MANAGER_TEST_MODE: '1', API_MANAGER_DATA_DIR: dataDir } });
const page = await app.firstWindow();
try {
  await page.getByRole('textbox', { name: 'Request URL', exact: true }).waitFor();
  await page.waitForTimeout(800);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
  await page.evaluate(async () => {
    const result = await window.apiManager.loadWorkspace(); const workspace = result.workspace;
    const tab = workspace.tabs[0]; tab.editorTab = 'Body'; tab.request.body = { mode: 'raw', raw: '{"sample":true}', language: 'json', fields: [] };
    tab.response = { status: 200, statusText: 'OK', body: '{"message":"first response line","result":"readable JSON","nested":{"success":true},"done":true}', headers: [{ id: crypto.randomUUID(), key: 'Content-Type', value: 'application/json', enabled: true }], duration: 10, size: 100, url: 'http://localhost/test', receivedAt: new Date().toISOString() };
    await window.apiManager.saveWorkspace(workspace);
    localStorage.setItem('api-manager-request-height', '370'); localStorage.setItem('api-manager-console-open', 'true');
  });
  await page.reload(); await page.locator('.response-body .monaco-editor').waitFor();
  await page.waitForTimeout(700);
  for (const [width, height] of [[1000, 650], [1000, 700], [1024, 768], [1420, 900]]) {
    await app.evaluate(({ BrowserWindow }, dimensions) => BrowserWindow.getAllWindows()[0].setSize(...dimensions), [width, height]);
    await page.waitForTimeout(400);
    console.log(JSON.stringify(await page.evaluate(() => {
      const selectors = ['.app-shell', '.workspace-body', '.request-workspace', '.request-editor', '.response-panel', '.response-body', '.response-body section', '.response-body .monaco-editor', '.response-body .view-lines', '.console-panel'];
      return { viewport: [innerWidth, innerHeight], elements: selectors.map(selector => { const element = document.querySelector(selector); const rect = element?.getBoundingClientRect(); return { selector, y: rect?.y, height: rect?.height, cssHeight: element && getComputedStyle(element).height, min: element && getComputedStyle(element).minHeight, content: selector.includes('view-lines') ? element?.innerText : undefined }; }) };
    })));
  }
} finally { await app.close(); }
