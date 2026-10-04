'use strict';
const { _electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');

(async () => {
  const profile = await fs.mkdtemp(path.resolve('.local-test/portable-profile-'));
  const requests = [], server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url === '/soap') {
      res.setHeader('content-type', 'application/soap+xml; charset=utf-8');
      res.end('<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><Result>Portable SOAP accepted</Result></soap:Body></soap:Envelope>');
    } else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ portable: true, message: 'Portable JSON accepted' })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let app, launched;
  try {
    const env = { ...process.env, API_MANAGER_DATA_DIR: profile, API_MANAGER_TEST_MODE: '1', API_MANAGER_PRODUCTION: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: path.resolve('release/API Manager 1.0.0.exe'), args: [], env, timeout: 30000 });
    launched = app.process();
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).waitFor({ timeout: 15000 });
    const identity = await app.evaluate(({ app }) => ({ version: app.getVersion(), executable: process.execPath, packaged: app.isPackaged, userData: app.getPath('userData') }));
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${base}/json`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.response-body .view-lines')).toContainText('Portable JSON accepted', { timeout: 15000 });
    await page.getByRole('button', { name: 'Search response body', exact: true }).click();
    const find = page.locator('.response-body .find-widget');
    await find.getByRole('textbox', { name: 'Find', exact: true }).fill('Portable JSON accepted');
    await expect(find.locator('.matchesCount')).toHaveText('1 of 1');
    await expect(page.locator('.response-body .currentFindMatch')).not.toHaveCount(0);
    await find.getByRole('textbox', { name: 'Find', exact: true }).press('Escape');
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const help = page.getByRole('dialog', { name: 'About and Help', exact: true });
    await expect(help).toContainText('Manish Kumar Singh');
    await help.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('combobox', { name: 'Request protocol' }).selectOption('SOAP');
    await page.getByRole('combobox', { name: 'SOAP version' }).selectOption('1.2');
    await page.getByRole('textbox', { name: 'SOAP action' }).fill('urn:PortableEcho');
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${base}/soap`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(async () => { try { const state = JSON.parse(await fs.readFile(path.join(profile, 'workspace.json'), 'utf8')); return state.history[0]?.response?.body ?? ''; } catch { return ''; } }, { timeout: 15000 }).toContain('Portable SOAP accepted');
    await expect(page.getByText('All changes saved locally', { exact: true })).toBeVisible({ timeout: 15000 });
    const workspace = JSON.parse(await fs.readFile(path.join(profile, 'workspace.json'), 'utf8'));
    if (workspace.history.length !== 2 || workspace.history.some(entry => entry.response?.status !== 200)) throw new Error('Expected two persisted successful runs.');
    if (requests[1].method !== 'POST' || !requests[1].headers['content-type'].includes('application/soap+xml') || !requests[1].headers['content-type'].includes('urn:PortableEcho')) throw new Error('SOAP transport metadata mismatch.');
    const result = { passed: true, identity, profile, requests: requests.map(({ method, url, headers, body }) => ({ method, url, contentType: headers['content-type'], bodyBytes: Buffer.byteLength(body) })), savedRuns: workspace.history.length };
    await page.screenshot({ path: path.resolve('.local-test/portable-help-smoke.png'), fullPage: true });
    await fs.writeFile(path.resolve('.local-test/portable-help-smoke-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => launched.exitCode, { timeout: 15000 }).toBe(0);
  } catch (error) {
    console.error(error.stack || String(error)); process.exitCode = 1;
  } finally {
    if (app && launched?.exitCode === null) {
      await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (launched.exitCode === null) launched.kill();
    }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})();

