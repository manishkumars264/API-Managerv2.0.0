import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { initialWorkspace, newRequest, newTab, row } from '../../src/lib/model';
import type { Workspace } from '../../src/types';

let server: Server;
let baseUrl: string;
let networkRuns = 0;
let releaseRace: (() => void) | undefined;
const appRoot = path.resolve('.');
const processes = new WeakMap<ElectronApplication, ChildProcess>();
async function launch(dataDir: string) {
  const executablePath = process.env.API_MANAGER_EXECUTABLE;
  const app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: [appRoot] }), env: { ...process.env, API_MANAGER_PRODUCTION: '1', API_MANAGER_TEST_MODE: '1', API_MANAGER_DATA_DIR: dataDir }, timeout: 30000 });
  processes.set(app, app.process());
  const page = await app.firstWindow();
  // Test mode keeps the native window hidden. Keep renderer timers and editor
  // layout active so autosave checks do not depend on background throttling.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await page.getByRole('textbox', { name: 'Request URL', exact: true }).waitFor();
  return { app, page };
}
async function directory() { await fs.mkdir(path.join(appRoot, '.local-test'), { recursive: true }); return fs.mkdtemp(path.join(appRoot, '.local-test', 'e2e-')); }
async function readWorkspace(dataDir: string): Promise<Workspace> { return JSON.parse(await fs.readFile(path.join(dataDir, 'workspace.json'), 'utf8')); }
async function importText(page: Page, content: string) {
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('textbox', { name: 'Import cURL or JSON' }).fill(content);
  await page.getByRole('button', { name: 'Import text', exact: true }).click();
}
async function closeNormally(app: ElectronApplication) {
  const process = processes.get(app)!;
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await expect.poll(() => process.exitCode, { timeout: 15000 }).toBe(0);
}
async function saveDialog(app: ElectronApplication, file: string) {
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, file);
}
async function cleanup(app: ElectronApplication) {
  const process = processes.get(app); if (!process || process.exitCode !== null) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([app.close().catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]);
  if (timer) clearTimeout(timer);
  if (process.exitCode === null) process.kill();
}

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    networkRuns++;
    let body = ''; for await (const chunk of request) body += chunk;
    if (request.url?.startsWith('/race')) { await new Promise<void>(resolve => { releaseRace = resolve; response.once('close', resolve); }); if (response.destroyed) return; }
    if (request.url?.startsWith('/slow')) { await new Promise<void>(resolve => { const timer = setTimeout(resolve, request.url?.includes('long') ? 15000 : 1000); response.once('close', () => { clearTimeout(timer); resolve(); }); }); if (response.destroyed) return; }
    if (request.url?.startsWith('/html')) { response.setHeader('Content-Type', 'text/html'); response.end('<h1>Safe preview</h1><script>window.parent.compromised=true</script><img src="https://invalid.example/track">'); return; }
    if (request.url?.startsWith('/soap')) { response.setHeader('Content-Type', 'application/soap+xml'); response.end('<Envelope><Body><Result>SOAP accepted</Result></Body></Envelope>'); return; }
    if (request.url?.startsWith('/search')) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ items: ['match-token first', 'match-token second', 'match-token third'], other: 'unrelated' })); return; }
    if (request.url?.startsWith('/token')) { if (request.url.includes('delay')) await new Promise(resolve => setTimeout(resolve, 750)); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ access_token: 'acquired-ui-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-ui-token' })); return; }
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Echo', 'API Manager'); response.setHeader('Set-Cookie', 'local=only; Path=/; HttpOnly');
    response.end(JSON.stringify({ method: request.method, path: request.url, body: body ? JSON.parse(body) : null, authorization: request.headers.authorization ?? null, correlation: request.headers['x-run-guid'] ?? null, contentType: request.headers['content-type'] ?? null, message: 'Hello from API Manager', success: true }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

test('changes accent colours in both themes without altering requests and restores the selection', async () => {
  test.setTimeout(180000);
  const dataDir = await directory(); let { app, page } = await launch(dataDir);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.accent)).toBe('blue');
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/echo?appearance=unchanged`);
    const colours = ['blue', 'red', 'orange', 'green', 'purple'];
    let completedRuns = 0;
    for (const theme of ['dark', 'light']) {
      const seen = new Set<string>();
      for (const colour of colours) {
        await page.locator('.sidebar-rail').getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByRole('combobox', { name: 'Application theme' }).selectOption(theme);
        const radio = page.getByRole('radio', { name: new RegExp(`^${colour}$`, 'i') });
        await radio.locator('..').click(); await expect(radio).toBeChecked();
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.accent)).toBe(colour);
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        const appearance = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement), button = getComputedStyle(document.querySelector('.send-button')!);
          return { background: root.getPropertyValue('--bg').trim(), accent: root.getPropertyValue('--accent-button').trim(), send: button.backgroundColor, foreground: button.color };
        });
        expect(appearance.background).toBe(theme === 'dark' ? '#1b1b1b' : '#f7f7f7');
        expect(appearance.foreground).toBe('rgb(255, 255, 255)');
        expect(seen.has(appearance.accent)).toBe(false); seen.add(appearance.accent);
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        completedRuns++;
        await expect.poll(async () => { try { return (await readWorkspace(dataDir)).history.length; } catch { return 0; } }).toBe(completedRuns);
        await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
        await expect.poll(async () => { try { return (await readWorkspace(dataDir)).history[0]?.response?.body; } catch { return ''; } }).toContain('appearance=unchanged');
        await expect(page.getByRole('textbox', { name: 'Request URL', exact: true })).toHaveValue(`${baseUrl}/echo?appearance=unchanged`);
        await expect(page.locator('.response-body .view-lines')).toContainText('Hello from API Manager');
      }
    }
    await closeNormally(app); ({ app, page } = await launch(dataDir));
    await expect.poll(() => page.evaluate(() => ({ accent: document.documentElement.dataset.accent, theme: document.documentElement.dataset.theme }))).toEqual({ accent: 'purple', theme: 'light' });
    await expect(page.getByRole('textbox', { name: 'Request URL', exact: true })).toHaveValue(`${baseUrl}/echo?appearance=unchanged`);
    expect(errors).toEqual([]);
  } finally { await cleanup(app); }
});

test('resizes console by pointer and keyboard and preserves the preferred height across reopening', async () => {
  const dataDir = await directory(); let { app, page } = await launch(dataDir);
  try {
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setSize(1280, 1050); });
    expect(await page.locator('.sidebar-rail > button').allTextContents()).toEqual(['Collections', 'Environments', 'Console', 'History', 'Settings']);
    await expect(page.locator('.status-bar').getByRole('button', { name: 'Console', exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/echo`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    await page.getByRole('button', { name: 'Console', exact: true }).click();
    const divider = page.getByRole('separator', { name: 'Resize console' });
    const height = async () => (await page.locator('.console-panel').boundingBox())!.height;
    const initial = await height();
    let bounds = (await divider.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 100, { steps: 5 }); await page.mouse.up();
    await expect.poll(height).toBeGreaterThan(initial + 50);
    const expanded = await height();
    bounds = (await divider.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 60, { steps: 5 }); await page.mouse.up();
    await expect.poll(height).toBeLessThan(expanded - 30);
    const smaller = await height();
    await divider.focus(); await page.keyboard.press('ArrowUp');
    await expect.poll(height).toBeGreaterThan(smaller + 10);
    const preferred = await height();
    await expect.poll(async () => (await page.locator('.response-body').boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(90);
    await page.getByRole('button', { name: 'Close console', exact: true }).click();
    await page.getByRole('button', { name: 'Console', exact: true }).click();
    await expect.poll(height).toBe(preferred);
    await closeNormally(app); ({ app, page } = await launch(dataDir));
    await expect(page.getByRole('region', { name: 'API console' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('api-manager-console-height'))).toBe(String(preferred));
    // A restored native window may be constrained by the display work area.
    // Verify the saved preference independently, then restore the tested size.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1050));
    await expect.poll(height).toBe(preferred);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 650));
    await expect.poll(height).toBeLessThan(preferred);
    await expect.poll(async () => (await page.locator('.response-body').boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(90);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1050));
    await expect.poll(height).toBe(preferred);
    await page.getByRole('separator', { name: 'Resize console' }).focus(); await page.keyboard.press('Home');
    await expect.poll(height).toBe(90);
    await page.keyboard.press('End');
    await expect.poll(height).toBeGreaterThan(preferred);
    await page.getByRole('button', { name: 'Close console', exact: true }).click();
    await expect(page.getByRole('region', { name: 'API console' })).toHaveCount(0);
  } finally { await cleanup(app); }
});

test('previews and copies all request code languages without sending or modifying the request', async () => {
  test.setTimeout(120000);
  const dataDir = await directory(), workspace = initialWorkspace();
  const request = workspace.tabs[0].request;
  Object.assign(request, { name: 'Generated example', collectionId: 'code-collection', url: '{{base_url}}/echo?repeat=old', method: 'POST', params: [row('repeat', 'one'), row('repeat', 'two')], headers: [row('X-Custom', '{{header_value}}'), { ...row('Disabled', 'excluded'), enabled: false }], auth: { type: 'inherit' }, body: { mode: 'raw', language: 'json', raw: '{"message":"{{body_value}}"}', fields: [] } });
  workspace.collections = [{ id: 'code-collection', name: 'Code collection', description: '', requests: [structuredClone(request)], folders: [], variables: [], auth: { type: 'bearer', token: '{{token}}' } }];
  workspace.globals = [row('base_url', baseUrl), row('header_value', 'generated-header'), row('body_value', 'generated-body'), row('token', 'generated-token')];
  await fs.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
  const { app, page } = await launch(dataDir);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const before = networkRuns;
    await page.getByRole('button', { name: 'Request actions' }).click();
    await page.getByRole('button', { name: 'Copy as cURL', exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Bearer generated-token');
    await page.getByRole('button', { name: 'Request actions' }).click();
    await page.getByRole('button', { name: 'Generate code…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate code' });
    await expect(dialog).toBeVisible();
    const language = page.getByRole('combobox', { name: 'Code language' });
    expect(await language.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['curl', 'python', 'java', 'javascript', 'c', 'cpp']);
    for (const value of ['curl', 'python', 'java', 'javascript', 'c', 'cpp']) {
      await language.selectOption(value);
      const code = await page.getByRole('textbox', { name: 'Generated request code' }).inputValue();
      expect(code).toContain(baseUrl); expect(code).toContain('generated-header'); expect(code).toContain('generated-body'); expect(code).toContain('Bearer generated-token');
      expect(code).not.toContain('excluded'); expect(code).not.toContain('{{');
      await page.getByRole('button', { name: 'Copy code', exact: true }).click();
      await expect.poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe(code.replace(/\r\n/g, '\n'));
    }
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toHaveCount(0); expect(networkRuns).toBe(before);
    await expect(page.getByRole('textbox', { name: 'Request URL', exact: true })).toHaveValue(request.url);
    await expect.poll(async () => (await readWorkspace(dataDir)).history.length).toBe(0);
    expect((await readWorkspace(dataDir)).tabs[0].request).toEqual(request);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    await expect.poll(async () => { try { return JSON.parse((await readWorkspace(dataDir)).history[0].response!.body); } catch { return null; } }).toMatchObject({ authorization: 'Bearer generated-token', body: { message: 'generated-body' }, path: '/echo?repeat=one&repeat=two' });
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('button', { name: 'Request actions' }).click();
    await page.getByRole('button', { name: 'Generate code…', exact: true }).click();
    await page.getByRole('combobox', { name: 'Code language' }).selectOption('python');
    await expect(page.getByRole('dialog', { name: 'Generate code' }).getByRole('alert')).toContainText('complete HTTP or HTTPS URL');
    await expect(page.getByRole('button', { name: 'Copy code', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/echo`);
    await page.getByRole('button', { name: 'Request actions' }).click();
    await page.getByRole('button', { name: 'Generate code…', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Code language' })).toHaveValue('python');
    await expect(page.getByRole('dialog', { name: 'Generate code' }).getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy code', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await cleanup(app); }
});

test('imports collections and environments, sends JSON, copies, zooms and downloads responses', async () => {
  const dataDir = await directory(); const { app, page } = await launch(dataDir);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    expect(await page.evaluate(() => ({ require: typeof (window as unknown as { require?: unknown }).require, bridge: typeof window.apiManager?.sendRequest }))).toEqual({ require: 'undefined', bridge: 'function' });
    await importText(page, JSON.stringify({ info: { name: 'Example API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] }, item: [{ name: 'Users', item: [{ name: 'Create user', request: { method: 'POST', url: '{{base_url}}/echo', body: { mode: 'raw', raw: '{"name":"API Manager"}', options: { raw: { language: 'json' } } } } }] }] }));
    await importText(page, JSON.stringify({ name: 'Local', _postman_variable_scope: 'environment', values: [{ key: 'base_url', value: baseUrl, enabled: true }, { key: 'token', value: 'local-demo-token', enabled: true }] }));
    await page.getByRole('combobox', { name: 'Active environment' }).selectOption({ label: 'Local' });
    await page.locator('.request-row .tree-main').filter({ hasText: 'Create user' }).click();
    await page.locator('.request-editor .editor-tabs').getByRole('button', { name: 'Body', exact: true }).click();
    await page.locator('.request-editor .monaco-editor').waitFor();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    await expect.poll(async () => { try { const ws = await readWorkspace(dataDir); return ws.tabs.find(t => t.id === ws.activeTabId)?.response?.body; } catch { return ''; } }).toContain('local-demo-token');
    await page.getByRole('button', { name: 'Zoom in response', exact: true }).click();
    await expect(page.getByTitle('Reset response zoom')).toHaveText('114%');
    await page.getByRole('button', { name: 'Zoom out response', exact: true }).click();
    await expect(page.getByTitle('Reset response zoom')).toHaveText('100%');
    await page.getByRole('button', { name: 'Copy response options' }).click();
    await page.getByRole('button', { name: 'Copy body', exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Hello from API Manager');
    await page.getByRole('button', { name: 'Copy response options' }).click();
    await page.getByRole('button', { name: 'Copy body with headers', exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('HTTP 200 OK');
    const bodyFile = path.join(dataDir, 'response.json'); await saveDialog(app, bodyFile);
    await page.getByRole('button', { name: 'Save response options' }).click();
    await page.getByRole('button', { name: 'Save body (.json)', exact: true }).click();
    await expect.poll(async () => { try { return JSON.parse(await fs.readFile(bodyFile, 'utf8')).success; } catch { return false; } }).toBe(true);
    const headersFile = path.join(dataDir, 'response-headers.json'); await saveDialog(app, headersFile);
    await page.getByRole('button', { name: 'Save response options' }).click();
    await page.getByRole('button', { name: 'Save body with headers (.json)', exact: true }).click();
    await expect.poll(async () => { try { const value = JSON.parse(await fs.readFile(headersFile, 'utf8')); return value.status === 200 && value.headers.some((h: { key: string }) => h.key.toLowerCase() === 'x-echo') && value.body.success; } catch { return false; } }).toBe(true);
    await page.locator('.response-tabs').getByRole('button', { name: 'Cookies', exact: true }).click();
    await expect(page.locator('.cookie-table')).toContainText('local');
    await page.locator('.response-tabs').getByRole('button', { name: 'Body', exact: true }).click();
    await page.getByRole('button', { name: 'Dismiss notification' }).evaluateAll(buttons => buttons.forEach(button => (button as HTMLButtonElement).click()));
    const resizer = await page.locator('.panel-resizer').boundingBox();
    if (resizer) { await page.mouse.move(resizer.x + resizer.width / 2, resizer.y + resizer.height / 2); await page.mouse.down(); await page.mouse.move(resizer.x + resizer.width / 2, resizer.y - 110); await page.mouse.up(); }
    await expect(page.locator('.response-body .view-lines')).toContainText('method');
    await fs.mkdir(path.join(appRoot, 'docs'), { recursive: true });
    await page.screenshot({ path: path.join(appRoot, 'docs', 'screenshot.png') });
    expect(errors).toEqual([]);
  } finally { await cleanup(app); }
});

test('restores drafts, active tabs, editor mode, zoom, theme and overflowing tabs after close', async () => {
  const dataDir = await directory(); let { app, page } = await launch(dataDir);
  try {
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(13);
    await expect(page.locator('.workspace-toolbar .request-tabs')).toHaveCount(1);
    await expect(page.locator('.main-panel .request-tabs')).toHaveCount(0);
    await expect.poll(() => page.locator('.request-tabs').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/echo?a=1&a=2`);
    await expect(page.locator('.request-editor').getByRole('textbox', { name: 'Key', exact: true })).toHaveCount(2);
    await page.locator('.request-editor').getByRole('button', { name: 'Disable row' }).first().click();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    await expect.poll(async () => { try { return JSON.parse((await readWorkspace(dataDir)).history[0].response!.body).path; } catch { return ''; } }).toBe('/echo?a=2');
    await page.getByRole('button', { name: 'Zoom in response' }).click();
    await page.locator('.response-controls').getByRole('button', { name: 'Raw', exact: true }).click();
    await page.locator('.sidebar-rail').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Application theme' }).selectOption('light');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('.request-editor .editor-tabs').getByRole('button', { name: 'Description', exact: true }).click();
    await page.getByRole('textbox', { name: 'Request description' }).fill('An unsaved draft restored immediately after closing.');
    await closeNormally(app);
    const stored = await readWorkspace(dataDir); expect(stored.tabs).toHaveLength(13);
    const tab = stored.tabs.find(t => t.id === stored.activeTabId)!;
    expect(tab.request.description).toBe('An unsaved draft restored immediately after closing.');
    expect(tab.responseZoom).toBe(16); expect(tab.responseTab).toBe('Body:Raw'); expect(stored.settings.theme).toBe('light');
    ({ app, page } = await launch(dataDir));
    await expect(page.getByRole('textbox', { name: 'Request description' })).toHaveValue(tab.request.description);
    await expect(page.getByTitle('Reset response zoom')).toHaveText('114%');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('tab')).toHaveCount(13);
  } finally { await cleanup(app); }
});

test('scrolls overflowing tabs without overlap and supports Ctrl-wheel and middle-click closing', async () => {
  const dataDir = await directory(), workspace = initialWorkspace();
  const beforeNetwork = networkRuns;
  workspace.tabs = Array.from({ length: 13 }, (_, index) => newTab({ ...newRequest(`Overflow request ${String(index + 1).padStart(2, '0')}`), url: `${baseUrl}/echo?tab=${index + 1}` }));
  workspace.tabs[1].dirty = true;
  workspace.activeTabId = workspace.tabs[0].id;
  await fs.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
  const { app, page } = await launch(dataDir);
  const tabs = page.locator('.request-tabs');
  const namedTab = (number: number) => tabs.getByRole('tab').filter({ hasText: `Overflow request ${String(number).padStart(2, '0')}` });
  const left = page.getByRole('button', { name: 'Scroll request tabs left', exact: true });
  const right = page.getByRole('button', { name: 'Scroll request tabs right', exact: true });
  const selectedTabIsVisible = async () => {
    await expect.poll(async () => {
      const viewport = await tabs.boundingBox();
      const active = await tabs.locator('.request-tab:has([role="tab"][aria-selected="true"])').boundingBox();
      return !!viewport && !!active && active.x >= viewport.x - 1 && active.x + active.width <= viewport.x + viewport.width + 1;
    }).toBe(true);
  };
  const ctrlWheel = async (delta: number) => {
    await tabs.hover();
    await page.keyboard.down('Control');
    try { await page.mouse.wheel(0, delta); } finally { await page.keyboard.up('Control'); }
  };
  try {
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setSize(1000, 650); });
    await expect(tabs.getByRole('tab')).toHaveCount(13);
    await expect(page.locator('.workspace-toolbar .request-tabs')).toHaveCount(1);
    await expect(page.locator('.main-panel .request-tabs')).toHaveCount(0);
    await expect.poll(() => tabs.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await expect(left).toBeVisible(); await expect(right).toBeVisible();
    const viewport = (await tabs.boundingBox())!, leftBox = (await left.boundingBox())!, rightBox = (await right.boundingBox())!;
    expect(leftBox.x + leftBox.width).toBeLessThanOrEqual(viewport.x + 1);
    expect(rightBox.x).toBeGreaterThanOrEqual(viewport.x + viewport.width - 1);
    const newTabBox = (await page.getByRole('button', { name: 'New request tab', exact: true }).boundingBox())!;
    const environmentBox = (await page.getByRole('combobox', { name: 'Active environment', exact: true }).boundingBox())!;
    expect(newTabBox.x).toBeGreaterThanOrEqual(rightBox.x + rightBox.width - 1);
    expect(newTabBox.x + newTabBox.width).toBeLessThanOrEqual(environmentBox.x + 1);
    expect(environmentBox.x + environmentBox.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    const initialScroll = await tabs.evaluate(node => node.scrollLeft);
    await right.click();
    await expect.poll(() => tabs.evaluate(node => node.scrollLeft)).toBeGreaterThan(initialScroll + 5);
    await expect(namedTab(1)).toHaveAttribute('aria-selected', 'true');
    await left.click();
    await expect.poll(() => tabs.evaluate(node => node.scrollLeft)).toBeLessThanOrEqual(initialScroll + 1);
    const initialScale = await page.evaluate(() => window.devicePixelRatio);
    await ctrlWheel(120);
    await expect(namedTab(2)).toHaveAttribute('aria-selected', 'true');
    await selectedTabIsVisible();
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(initialScale);
    await namedTab(2).click({ button: 'middle' });
    const confirmation = page.getByRole('dialog', { name: 'Close this request?', exact: true });
    await expect(confirmation).toBeVisible();
    await expect(tabs.getByRole('tab')).toHaveCount(13);
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(namedTab(2)).toHaveAttribute('aria-selected', 'true');
    await namedTab(2).click({ button: 'middle' });
    await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(namedTab(2)).toHaveCount(0);
    await expect(tabs.getByRole('tab')).toHaveCount(12);
    await namedTab(3).click({ button: 'middle' });
    await expect(namedTab(3)).toHaveCount(0);
    await expect(confirmation).toHaveCount(0);
    await expect(tabs.getByRole('tab')).toHaveCount(11);
    await expect(namedTab(1)).toHaveAttribute('aria-selected', 'true');
    await ctrlWheel(-120);
    await expect(namedTab(1)).toHaveAttribute('aria-selected', 'true');
    await namedTab(1).focus();
    await namedTab(1).press('End');
    await expect(namedTab(13)).toHaveAttribute('aria-selected', 'true');
    await selectedTabIsVisible();
    await ctrlWheel(120);
    await expect(namedTab(13)).toHaveAttribute('aria-selected', 'true');
    await ctrlWheel(-120);
    await expect(namedTab(12)).toHaveAttribute('aria-selected', 'true');
    await selectedTabIsVisible();
    await page.getByRole('button', { name: 'New request tab', exact: true }).click();
    await expect(tabs.getByRole('tab')).toHaveCount(12);
    await selectedTabIsVisible();
    await expect(page.locator('.url-bar').getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    expect(networkRuns).toBe(beforeNetwork);
  } finally { await cleanup(app); }
});

test('persists independent request and response wrapping while resolving variables without inline announcements', async () => {
  const dataDir = await directory(), workspace = initialWorkspace();
  workspace.globals = [row('base_url', baseUrl)];
  workspace.environments = [{ id: 'wrap-local', name: 'Local wrap environment', variables: [row('query', 'resolved'), row('payload', 'resolved body value'), row('token', 'resolved-token'), row('header', 'resolved-header')] }];
  workspace.activeEnvironmentId = 'wrap-local';
  const originalBody = JSON.stringify({ value: '{{payload}}', long: 'long-content-'.repeat(100) });
  Object.assign(workspace.tabs[0].request, { name: 'Wrap and variables', method: 'POST', url: '{{base_url}}/echo?from={{query}}', auth: { type: 'bearer', token: '{{token}}' }, headers: [row('X-Run-Guid', '{{header}}')], body: { mode: 'raw', language: 'json', raw: originalBody, fields: [] } });
  await fs.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
  let { app, page } = await launch(dataDir);
  try {
    await page.evaluate(() => {
      localStorage.removeItem('api-manager-request-wrap');
      localStorage.removeItem('api-manager-response-wrap');
      localStorage.setItem('api-manager-wrap', 'false');
    });
    await page.reload();
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).waitFor();
    await expect(page.locator('.request-editor .section-caption')).not.toContainText('{{variable}}');
    await page.locator('.sidebar-rail').getByRole('button', { name: 'Environments', exact: true }).click();
    await expect(page.locator('.environment-intro')).not.toContainText('{{variable}}');
    await page.locator('.sidebar-rail').getByRole('button', { name: 'Collections', exact: true }).click();
    await page.locator('.request-editor .editor-tabs').getByRole('button', { name: 'Body', exact: true }).click();
    const requestWrap = page.getByRole('button', { name: 'Toggle request word wrap', exact: true });
    const responseWrap = page.getByRole('button', { name: 'Toggle response word wrap', exact: true });
    await expect(requestWrap).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.request-editor .view-lines .view-line')).toHaveCount(1);
    await page.locator('.url-bar').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    await expect(responseWrap).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.response-controls').getByRole('button', { name: 'Raw', exact: true }).click();
    await expect(page.locator('.response-body .view-lines .view-line')).toHaveCount(1);
    await expect.poll(async () => { try { return JSON.parse((await readWorkspace(dataDir)).history[0].response!.body); } catch { return {}; } }).toMatchObject({ path: '/echo?from=resolved', body: { value: 'resolved body value' }, authorization: 'Bearer resolved-token', correlation: 'resolved-header' });
    await requestWrap.click();
    await expect(requestWrap).toHaveAttribute('aria-pressed', 'true');
    await expect(responseWrap).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.locator('.request-editor .view-lines .view-line').count()).toBeGreaterThan(1);
    await expect(page.locator('.response-body .view-lines .view-line')).toHaveCount(1);
    await responseWrap.click();
    await expect(responseWrap).toHaveAttribute('aria-pressed', 'true');
    await expect(requestWrap).toHaveAttribute('aria-pressed', 'true');
    await requestWrap.click();
    await expect(requestWrap).toHaveAttribute('aria-pressed', 'false');
    await expect(responseWrap).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.request-editor .view-lines .view-line')).toHaveCount(1);
    await expect.poll(() => page.locator('.response-body .view-lines .view-line').count()).toBeGreaterThan(1);
    expect((await readWorkspace(dataDir)).tabs[0].request.body.raw).toBe(originalBody);
    await closeNormally(app);
    ({ app, page } = await launch(dataDir));
    await expect(page.getByRole('button', { name: 'Toggle request word wrap', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'Toggle response word wrap', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.request-editor .view-lines .view-line')).toHaveCount(1);
    await expect.poll(() => page.locator('.response-body .view-lines .view-line').count()).toBeGreaterThan(1);
    expect((await readWorkspace(dataDir)).tabs[0].request.body.raw).toBe(originalBody);
  } finally { await cleanup(app); }
});

test('restores workspace backups with confirmation and supports native JSON import/export', async () => {
  const dataDir = await directory(); const { app, page } = await launch(dataDir);
  try {
    const backup = initialWorkspace(); backup.tabs[0].request.name = 'Restored workspace'; backup.tabs[0].request.url = `${baseUrl}/echo`;
    await importText(page, JSON.stringify(backup));
    await expect(page.getByRole('dialog', { name: 'Restore this workspace?' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('tab')).toContainText('Restored workspace');
    const envFile = path.join(dataDir, 'environment.json'); await fs.writeFile(envFile, JSON.stringify({ name: 'Imported from file', values: [{ key: 'base', value: baseUrl, enabled: true }] }));
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, envFile);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('button', { name: /Choose files to import/ }).click();
    await expect(page.getByRole('combobox', { name: 'Active environment' })).toContainText('Imported from file');
    const exportFile = path.join(dataDir, 'backup.json'); await saveDialog(app, exportFile);
    await page.getByRole('button', { name: 'Workspace actions' }).click();
    await page.getByRole('button', { name: 'Export workspace backup', exact: true }).click();
    await expect.poll(async () => { try { return JSON.parse(await fs.readFile(exportFile, 'utf8')).tabs[0].request.name; } catch { return ''; } }).toBe('Restored workspace');
  } finally { await cleanup(app); }
});

test('shows import and request errors, cancels requests, and isolates HTML preview', async () => {
  const dataDir = await directory(); const { app, page } = await launch(dataDir);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await importText(page, 'curl --execute-untrusted https://example.com');
    await expect(page.locator('.notice-stack')).toContainText('Unsupported cURL option');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill('{{undefined}}/echo');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.notice-stack')).toContainText('Unresolved variable');
    await page.getByRole('button', { name: 'Copy request as cURL', exact: true }).click();
    await expect(page.locator('.notice-stack')).toContainText('Unresolved variable');
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/slow?long`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.locator('.url-bar').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.url-bar').getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/html`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.frameLocator('iframe[title="Safe HTML response preview"]').getByRole('heading', { name: 'Safe preview' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { compromised?: boolean }).compromised)).toBeUndefined();
    expect(errors).toEqual([]);
  } finally { await cleanup(app); }
});

test('runs inherited scripts and dynamic globals, restores history responses and replays within the 200-run cap', async () => {
  const dataDir = await directory();
  const workspace = initialWorkspace();
  workspace.globals = [row('base_url', baseUrl)];
  workspace.activeEnvironmentId = 'local';
  workspace.environments = [{ id: 'local', name: 'Local script environment', variables: [] }];
  const request = workspace.tabs[0].request;
  Object.assign(request, { name: 'Scripted API', method: 'POST', url: '{{base_url}}/echo', collectionId: 'collection', auth: { type: 'bearer', token: '{{script_token}}' }, headers: [row('X-Run-Guid', '{{$guid}}')], body: { mode: 'raw', language: 'json', raw: '{"id":"{{$guid}}","email":"{{$randomExampleEmail}}","big":9007199254740993123}', fields: [] }, scripts: { preRequest: "pm.environment.set('script_token', 'from-script'); pm.globals.set('run_guid', pm.variables.replaceIn('{{$guid}}')); console.log('pre-request ready');", postResponse: "pm.test('Body GUID matches header and pre script', () => { const json = pm.response.json(); pm.expect(json.body.id).to.equal(json.correlation); pm.expect(json.body.id).to.equal(pm.globals.get('run_guid')); pm.expect(json.authorization).to.equal('Bearer from-script'); }); pm.environment.set('last_response', 'received'); console.log('post-response ready');" } });
  workspace.collections = [{ id: 'collection', name: 'Script collection', description: '', requests: [structuredClone(request)], folders: [], variables: [], auth: { type: 'none' }, scripts: { preRequest: "console.log('collection first');", postResponse: "pm.test('Collection status', () => pm.response.to.have.status(200));" } }];
  workspace.history = Array.from({ length: 200 }, (_, index) => ({ id: `old-${index}`, request: { ...newRequest(`Saved run ${index}`), url: `${baseUrl}/echo?old=${index}` }, timestamp: new Date(Date.now() - index * 1000).toISOString(), response: { status: 200, statusText: 'OK', headers: [], body: JSON.stringify({ saved: index }), duration: 1, size: 20, url: `${baseUrl}/echo?old=${index}`, receivedAt: new Date().toISOString() } }));
  await fs.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
  let { app, page } = await launch(dataDir); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.locator('.request-editor .editor-tabs').getByRole('button', { name: 'Pre-request', exact: true }).click();
    await expect(page.locator('.request-editor .monaco-editor')).toBeVisible();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(async () => { try { return (await readWorkspace(dataDir)).history[0]?.scriptResults?.tests.length; } catch { return 0; } }).toBe(2);
    const completed = await readWorkspace(dataDir);
    expect(completed.history).toHaveLength(200); expect(completed.history.some(entry => entry.id === 'old-199')).toBe(false);
    expect(completed.history[0].scriptResults?.tests.every(result => result.passed)).toBe(true);
    expect(completed.environments[0].variables.find(value => value.key === 'last_response')?.value).toBe('received');
    expect(completed.tabs[0].request.body.raw).toContain('9007199254740993123');
    await page.locator('.response-tabs').getByRole('button', { name: /^Test results/ }).click();
    await expect(page.locator('.response-panel')).toContainText('Body GUID matches header');
    await page.getByRole('button', { name: 'Console', exact: true }).click();
    await expect(page.getByRole('region', { name: 'API console' })).toContainText('pre-request ready');
    await page.getByRole('textbox', { name: 'Filter console' }).fill('post-response ready');
    await expect(page.locator('.console-entry')).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear console', exact: true }).click();
    await expect(page.locator('.console-entry')).toHaveCount(0);
    expect((await readWorkspace(dataDir)).history).toHaveLength(200);
    await page.getByRole('button', { name: 'Close console', exact: true }).click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    const beforeInspect = networkRuns;
    await page.locator('.history-row').filter({ hasText: 'old=0' }).first().click();
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    await expect(page.locator('.response-body .view-lines')).toContainText('saved');
    expect(networkRuns).toBe(beforeInspect);
    await expect(page.locator('.history-replay-banner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run again', exact: true })).toHaveCount(0);
    await page.locator('.url-bar').getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => networkRuns).toBe(beforeInspect + 1);
    await expect.poll(async () => { try { return (await readWorkspace(dataDir)).history[0].response?.body; } catch { return ''; } }).toContain('Hello from API Manager');
    await page.getByRole('button', { name: 'Run again Saved run 1', exact: true }).click();
    await expect.poll(() => networkRuns).toBe(beforeInspect + 2);
    await expect(page.getByRole('textbox', { name: 'Request URL', exact: true })).toHaveValue(`${baseUrl}/echo?old=1`);
    await expect.poll(async () => { try { return JSON.parse((await readWorkspace(dataDir)).history[0].response!.body).path; } catch { return ''; } }).toBe('/echo?old=1');
    await closeNormally(app);
    ({ app, page } = await launch(dataDir));
    await page.locator('.response-controls').getByRole('button', { name: 'Raw', exact: true }).click();
    await expect(page.locator('.response-body .view-lines')).toContainText('Hello from API Manager');
    expect((await readWorkspace(dataDir)).history).toHaveLength(200);
    expect(errors).toEqual([]);
  } finally { await cleanup(app); }
});

test('configures SOAP, beautifies without rounding JSON, wraps editors and uses advanced authorization forms', async () => {
  const dataDir = await directory(); const workspace = initialWorkspace();
  Object.assign(workspace.tabs[0].request, { method: 'POST', url: `${baseUrl}/echo`, body: { mode: 'raw', language: 'json', raw: '{"big":9007199254740993123,"text":"wrap me"}', fields: [] } });
  await fs.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
  const { app, page } = await launch(dataDir); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.locator('.request-editor .editor-tabs').getByRole('button', { name: 'Body', exact: true }).click();
    await page.locator('.request-editor').getByRole('button', { name: 'Beautify request body', exact: true }).click();
    await expect.poll(async () => { try { return (await readWorkspace(dataDir)).tabs[0].request.body.raw; } catch { return ''; } }).toContain('\n');
    expect((await readWorkspace(dataDir)).tabs[0].request.body.raw).toContain('9007199254740993123');
    await page.getByRole('button', { name: 'Toggle request word wrap' }).click();
    await page.getByRole('button', { name: 'Toggle request word wrap' }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('combobox', { name: 'Request protocol' }).selectOption('SOAP');
    await page.getByRole('combobox', { name: 'SOAP version' }).selectOption('1.2');
    await page.getByRole('textbox', { name: 'SOAP action' }).fill('urn:Echo');
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/soap`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    await expect(page.locator('.response-body .view-lines')).toContainText('SOAP accepted');
    await page.getByRole('button', { name: 'Toggle response word wrap' }).click();
    await page.getByRole('button', { name: 'Toggle response word wrap' }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/echo`);
    await page.locator('.request-editor .editor-tabs').getByRole('button', { name: 'Authorization', exact: true }).click();
    const auth = page.getByRole('combobox', { name: 'Authorization type', exact: true });
    expect(await auth.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['inherit', 'none', 'bearer', 'basic', 'apikey', 'digest', 'oauth1', 'oauth2', 'hawk', 'awsv4', 'ntlm', 'edgegrid', 'jwt', 'asap']);
    for (const type of ['digest', 'oauth1', 'hawk', 'awsv4', 'ntlm', 'edgegrid', 'jwt', 'asap']) { await auth.selectOption(type); await expect(page.locator('.auth-values input, .auth-values textarea').first()).toBeVisible(); }
    await auth.selectOption('oauth2');
    await page.getByRole('textbox', { name: 'Token URL', exact: true }).fill(`${baseUrl}/token`);
    await page.getByRole('textbox', { name: 'Client ID', exact: true }).fill('local-client');
    await page.getByLabel('Client secret', { exact: true }).fill('local-secret');
    await page.getByRole('button', { name: 'Get token', exact: true }).click();
    await expect(page.getByLabel('Access token', { exact: true })).toHaveValue('acquired-ui-token');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(async () => { try { return JSON.parse((await readWorkspace(dataDir)).history[0].response!.body).authorization; } catch { return ''; } }).toBe('Bearer acquired-ui-token');
    expect(errors).toEqual([]);
  } finally { await cleanup(app); }
});

test('keeps OAuth acquisition in its original tab and records an immutable cancelled console run', async () => {
  const dataDir = await directory(), workspace = initialWorkspace();
  workspace.tabs[0].editorTab = 'Authorization';
  workspace.tabs[0].request.auth = { type: 'oauth2', fields: { tokenUrl: `${baseUrl}/token?delay`, clientId: 'client', clientSecret: 'secret', grantType: 'client_credentials' } };
  await fs.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
  const { app, page } = await launch(dataDir);
  try {
    await page.getByRole('button', { name: 'Get token', exact: true }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect.poll(async () => { try { return (await readWorkspace(dataDir)).tabs[0].request.auth.fields?.accessToken; } catch { return ''; } }).toBe('acquired-ui-token');
    await expect.poll(async () => (await readWorkspace(dataDir)).tabs.length).toBe(2);
    expect((await readWorkspace(dataDir)).tabs[1].request.auth.type).toBe('none');
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/slow?long`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'Console', exact: true }).click();
    await expect(page.locator('.console-run-status')).toContainText('Sending');
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/edited-after-send`);
    await expect(page.locator('.console-run-url')).toContainText('/slow');
    await page.locator('.url-bar').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(async () => { try { return (await readWorkspace(dataDir)).history[0]?.error; } catch { return ''; } }).toBe('Request cancelled.');
    expect((await readWorkspace(dataDir)).history[0].request.url).toBe(`${baseUrl}/slow?long`);
    await expect(page.locator('.console-list')).toContainText('Request cancelled.');
  } finally { await cleanup(app); }
});

test('a Cancel pointer action cannot resend after the response completes', async () => {
  const dataDir = await directory(), { app, page } = await launch(dataDir);
  try {
    const before = networkRuns;
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/race`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => typeof releaseRace).toBe('function');
    const cancel = page.locator('.url-bar').getByRole('button', { name: 'Cancel', exact: true });
    const bounds = await cancel.boundingBox(); expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    releaseRace!();
    await expect(page.locator('.url-bar').getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    await page.mouse.up();
    await expect.poll(async () => (await readWorkspace(dataDir)).history.length).toBe(1);
    expect(networkRuns).toBe(before + 1);
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
  } finally { releaseRace?.(); releaseRace = undefined; await cleanup(app); }
});

test('keeps response and console usable at the minimum window size and restores the layout', async () => {
  const dataDir = await directory(); let { app, page } = await launch(dataDir);
  const usableResponse = async () => {
    await expect.poll(async () => (await page.locator('.response-body').boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(90);
    const viewport = await page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth }));
    const body = (await page.locator('.response-body').boundingBox())!;
    const status = (await page.locator('.status-bar').boundingBox())!;
    const response = (await page.locator('.response-panel').boundingBox())!;
    const footer = (await page.locator('.response-footer').boundingBox())!;
    expect(body.y + body.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(status.y + status.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(footer.y + footer.height).toBeLessThanOrEqual(response.y + response.height + 1);
  };
  try {
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setSize(1000, 650); });
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/echo`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    await usableResponse();
    await expect(page.locator('.response-body .view-lines')).toContainText('method');
    await page.getByRole('button', { name: 'Console', exact: true }).click();
    await expect(page.getByRole('region', { name: 'API console' })).toBeVisible();
    await usableResponse();
    const consolePanel = (await page.locator('.console-panel').boundingBox())!;
    expect(consolePanel.height).toBeGreaterThanOrEqual(90);
    await page.getByRole('button', { name: 'Close console', exact: true }).click();
    await usableResponse();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 950));
    await usableResponse();
    await expect.poll(async () => (await page.locator('.request-editor').boundingBox())?.height ?? 0).toBe(300);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 650));
    await usableResponse();
    await closeNormally(app);
    ({ app, page } = await launch(dataDir));
    await usableResponse();
    await expect(page.locator('.response-body .view-lines')).toContainText('method');
  } finally { await cleanup(app); }
});

test('opens About and Help with shortcuts, release history, and a prepared bug report draft', async () => {
  const dataDir = await directory(), { app, page } = await launch(dataDir);
  try {
    await expect(page.locator('.header-actions').getByRole('button')).toHaveCount(1);
    await expect(page.locator('.header-actions').getByRole('button', { name: 'Application settings' })).toHaveCount(0);
    await page.locator('.sidebar-rail').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const tabs = await page.locator('.request-tabs').getByRole('tab').count();
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'About and Help', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Manish Kumar Singh');
    await expect(dialog).toContainText('manishkumars264@gmail.com');
    await expect(dialog).toContainText('v1.0.0');
    await expect(dialog).toContainText('Keyboard shortcuts');
    await expect(dialog).toContainText('Send the current request');
    await expect(dialog).toContainText('Go to the next search match');
    await page.keyboard.press('Control+n');
    await expect(page.locator('.request-tabs').getByRole('tab')).toHaveCount(tabs);
    await dialog.getByRole('tab', { name: 'Release notes', exact: true }).click();
    const notes = dialog.getByRole('tabpanel', { name: 'Release notes', exact: true });
    for (const feature of ['SOAP', 'Authorization', 'Response tools', 'Import, export', 'History, Console', 'Pre-request']) await expect(notes).toContainText(feature);
    await dialog.getByRole('tab', { name: 'Version history', exact: true }).click();
    await expect(dialog.getByRole('tabpanel', { name: 'Version history', exact: true })).toContainText('Initial release');
    await dialog.getByRole('tab', { name: 'About', exact: true }).click();
    for (const size of [[1000, 650], [1024, 768], [1420, 820], [1420, 900]]) {
      await app.evaluate(({ BrowserWindow }, [width, height]) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setSize(width, height); }, size);
      await expect.poll(async () => {
        const content = await dialog.locator('.modal-content').boundingBox();
        const report = await dialog.getByRole('button', { name: 'Report bugs', exact: true }).boundingBox();
        const done = await dialog.getByRole('button', { name: 'Done', exact: true }).boundingBox();
        return !!content && !!report && !!done && report.y + report.height <= content.y + content.height + 1 && done.y + done.height <= content.y + content.height + 1;
      }).toBe(true);
    }
    await app.evaluate(({ shell }) => { shell.openExternal = async url => { Reflect.set(globalThis, '__bugReportURL', url); }; });
    await dialog.getByRole('button', { name: 'Report bugs', exact: true }).click();
    await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, '__bugReportURL'))).toMatch(/^mailto:/);
    const draft = new URL(await app.evaluate(() => Reflect.get(globalThis, '__bugReportURL')));
    expect(draft.pathname).toBe('manishkumars264@gmail.com');
    expect(draft.searchParams.get('subject')).toBe('API Manager v1.0.0 - Issue found');
    expect(draft.searchParams.get('body')).toContain('Summary / description:');
    expect(draft.searchParams.get('body')).toContain('1.\r\n2.\r\n3.');
    expect(draft.searchParams.get('body')).toContain('Screenshots / videos:');
    await app.evaluate(({ shell }) => { shell.openExternal = async () => { throw new Error('No default email app'); }; });
    await dialog.getByRole('button', { name: 'Report bugs', exact: true }).click();
    await expect(page.locator('.notice-stack')).toContainText('Set a default email app');
    await expect(page.locator('.notice-stack')).not.toContainText('bugs:compose');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  } finally { await cleanup(app); }
});

test('searches response text with highlighted matches, cyclic navigation and tooltips below controls', async () => {
  const dataDir = await directory(), { app, page } = await launch(dataDir);
  try {
    const before = networkRuns;
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/search`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    const toolbarTooltip = page.locator('.response-toolbar-tooltip[role="tooltip"]');
    const toolbarGeometry = async (controlName: string, findBottom?: number) => {
      const button = page.getByRole('button', { name: controlName, exact: true });
      await button.hover();
      await expect(toolbarTooltip).toBeVisible();
      const buttonBox = (await button.boundingBox())!;
      await expect.poll(async () => (await toolbarTooltip.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(Math.max(buttonBox.y + buttonBox.height + 6, findBottom === undefined ? 0 : findBottom + 8) - 1);
      const tip = (await toolbarTooltip.boundingBox())!;
      expect(tip.x).toBeGreaterThanOrEqual(0);
      expect(tip.x + tip.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
      expect(await toolbarTooltip.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
    };
    for (const control of ['Search response body', 'Toggle response word wrap', 'Zoom out response', 'Zoom in response', 'Copy response options', 'Save response options']) await toolbarGeometry(control);
    await page.getByRole('button', { name: 'Search response body', exact: true }).click();
    const find = page.locator('.response-body .find-widget');
    const input = find.getByRole('textbox', { name: 'Find', exact: true });
    await expect(input).toBeVisible();
    const findBox = (await find.boundingBox())!;
    await toolbarGeometry('Toggle response word wrap', findBox.y + findBox.height);
    await find.locator('.monaco-custom-toggle').first().hover();
    const findTooltip = page.locator('.response-body .monaco-hover[data-api-manager-find-tooltip="true"][role="tooltip"]');
    await expect(findTooltip).toBeVisible();
    await expect.poll(async () => (await findTooltip.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(findBox.y + findBox.height + 6);
    const tip = (await findTooltip.boundingBox())!;
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    await input.fill('match-token');
    await expect(find.locator('.matchesCount')).toHaveText('1 of 3');
    await find.locator('[role="button"][aria-label^="Next Match"]').hover();
    await expect(findTooltip).toBeVisible();
    await expect(findTooltip).toContainText('Next Match');
    await expect.poll(async () => (await findTooltip.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(findBox.y + findBox.height + 6);
    const nextTip = (await findTooltip.boundingBox())!;
    expect(nextTip.x).toBeGreaterThanOrEqual(0);
    expect(nextTip.x + nextTip.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    await expect(page.locator('.response-body .currentFindMatch')).not.toHaveCount(0);
    for (const count of ['2 of 3', '3 of 3', '1 of 3']) { await input.press('Enter'); await expect(find.locator('.matchesCount')).toHaveText(count); }
    await input.press('Shift+Enter');
    await expect(find.locator('.matchesCount')).toHaveText('3 of 3');
    await input.fill('no-such-text');
    await expect(find.locator('.matchesCount')).toContainText('No results');
    await expect(page.locator('.response-body .currentFindMatch')).toHaveCount(0);
    await input.press('Escape');
    await expect(input).toBeHidden();
    await expect(page.locator('.response-body .api-manager-response-find-tooltip')).toHaveCount(0);
    await expect(page.locator('.response-body [data-api-manager-find-tooltip]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByRole('button', { name: 'Search response body', exact: true }).click();
    await expect(page.locator('.response-controls').getByRole('button', { name: 'Raw', exact: true })).toHaveClass('active');
    const rawFind = page.locator('.response-body .find-widget');
    await rawFind.getByRole('textbox', { name: 'Find', exact: true }).fill('match-token');
    await expect(rawFind.locator('.matchesCount')).toHaveText(/\d of 3/);
    expect(networkRuns).toBe(before + 1);
    await expect.poll(async () => (await readWorkspace(dataDir)).history.length).toBe(1);
  } finally { await cleanup(app); }
});
