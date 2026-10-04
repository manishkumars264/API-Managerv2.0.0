import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { initialWorkspace, newRequest, row } from '../../src/lib/model';
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
    if (request.url?.startsWith('/token')) { if (request.url.includes('delay')) await new Promise(resolve => setTimeout(resolve, 750)); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ access_token: 'acquired-ui-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-ui-token' })); return; }
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Echo', 'API Manager'); response.setHeader('Set-Cookie', 'local=only; Path=/; HttpOnly');
    response.end(JSON.stringify({ method: request.method, path: request.url, body: body ? JSON.parse(body) : null, authorization: request.headers.authorization ?? null, correlation: request.headers['x-run-guid'] ?? null, contentType: request.headers['content-type'] ?? null, message: 'Hello from API Manager', success: true }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

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
    expect(await page.locator('.request-tabs').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await page.getByRole('textbox', { name: 'Request URL', exact: true }).fill(`${baseUrl}/echo?a=1&a=2`);
    await expect(page.locator('.request-editor').getByRole('textbox', { name: 'Key', exact: true })).toHaveCount(2);
    await page.locator('.request-editor').getByRole('button', { name: 'Disable row' }).first().click();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.response-metrics .status')).toHaveText('200 OK');
    await expect.poll(async () => { try { return JSON.parse((await readWorkspace(dataDir)).history[0].response!.body).path; } catch { return ''; } }).toBe('/echo?a=2');
    await page.getByRole('button', { name: 'Zoom in response' }).click();
    await page.locator('.response-controls').getByRole('button', { name: 'Raw', exact: true }).click();
    await page.getByRole('button', { name: 'Application settings' }).click();
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
    await page.getByRole('button', { name: 'Run again', exact: true }).click();
    await expect.poll(() => networkRuns).toBe(beforeInspect + 1);
    await expect.poll(async () => { try { return (await readWorkspace(dataDir)).history[0].response?.body; } catch { return ''; } }).toContain('Hello from API Manager');
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
