'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { WorkspaceStore, atomicWrite } = require('./store.cjs');
const { RequestEngine } = require('./request.cjs');
const { ScriptRunner } = require('./scripts.cjs');
const { acquireOAuth2Token } = require('./auth.cjs');
const { resolveVariables } = require('./request.cjs');
const { clearDynamics, forgetDynamics } = require('./dynamic-session.cjs');
const { identifier, string, validateWorkspace, validateSendPayload, validateOAuthPayload } = require('./validation.cjs');
const { validateWindowState, visibleWindowBounds } = require('./window-state.cjs');
const { openBugReportDraft } = require('./bug-report.cjs');

app.setName('API Manager');
if (process.env.API_MANAGER_DATA_DIR) app.setPath('userData', path.resolve(process.env.API_MANAGER_DATA_DIR));
const development = !app.isPackaged && process.env.API_MANAGER_PRODUCTION !== '1';
const indexPath = path.resolve(__dirname, '../dist/index.html');
const rendererUrl = development ? 'http://127.0.0.1:5173/' : pathToFileURL(indexPath).href;
const instanceLock = app.requestSingleInstanceLock();
let mainWindow, store, engine, scriptRunner, closing, windowState, windowWarning, windowSaveTimer, mayClose = false;
const tokenRequests = new Set();
async function shutdownRequests() {
  scriptRunner.shutdown(); for (const controller of tokenRequests) controller.abort(new Error('Application closing.'));
  clearDynamics();
  await engine.shutdown();
}

function trustedUrl(url) {
  try {
    const parsed = new URL(url);
    if (development) return parsed.origin === 'http://127.0.0.1:5173';
    return parsed.protocol === 'file:' && path.resolve(fileURLToPath(parsed)).toLowerCase() === indexPath.toLowerCase();
  } catch { return false; }
}
function assertSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || !event.senderFrame || event.senderFrame.parent !== null || !trustedUrl(event.senderFrame.url)) {
    throw new Error('This operation is available only to the API Manager application window.');
  }
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => { assertSender(event); return callback(...args); });
}
async function finishClosing(pending) {
  if (closing !== pending || !mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(pending.timer); pending.finishing = true;
  try {
    clearTimeout(windowSaveTimer); await saveWindowState(); await shutdownRequests(); await store.flush();
    if (closing === pending && mainWindow && !mainWindow.isDestroyed()) { mayClose = true; mainWindow.close(); }
  } catch (error) {
    pending.finishing = false; await showCloseFailure(pending, error.message);
  }
}
async function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  windowState = { version: 1, ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() };
  await store.saveFile(path.join(store.directory, 'window-state.json'), windowState, validateWindowState);
}
async function showCloseFailure(pending, reason) {
  if (closing !== pending || pending.showingDialog || !mainWindow || mainWindow.isDestroyed()) return;
  pending.showingDialog = true;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning', title: 'Save workspace before closing',
    message: 'API Manager could not confirm that your latest workspace was saved.', detail: reason,
    buttons: ['Retry Save', 'Keep Working', 'Close Without Saving'], defaultId: 0, cancelId: 1, noLink: true
  });
  pending.showingDialog = false;
  if (closing !== pending) return;
  if (response === 0) { closing = undefined; requestClose(); }
  else if (response === 2) {
    clearTimeout(pending.timer); await shutdownRequests().catch(() => {}); mayClose = true; mainWindow?.close();
  } else { clearTimeout(pending.timer); closing = undefined; }
}
function requestClose() {
  if (closing || !mainWindow || mainWindow.isDestroyed()) return;
  const pending = { token: randomUUID(), timer: null, finishing: false, showingDialog: false }; closing = pending;
  pending.timer = setTimeout(() => { if (!pending.finishing) void showCloseFailure(pending, 'The application did not respond to the save request.'); }, 8000);
  mainWindow.webContents.send('workspace:save-requested', pending.token);
}
function registerIpc() {
  handle('workspace:load', async () => {
    const loaded = await store.load();
    loaded.warning = [loaded.warning, engine.cookieWarning, windowWarning].filter(Boolean).join(' ') || undefined;
    return loaded;
  });
  handle('workspace:save', async (workspace, token) => {
    // Once closing begins, only the snapshot requested by the close handshake may
    // write. Delayed autosaves must not overwrite that final acknowledged state.
    if (closing && token !== closing.token) return;
    validateWorkspace(workspace); const pending = closing && token === closing.token ? closing : undefined;
    try { await store.save(workspace); }
    catch (error) { if (pending && closing === pending) void showCloseFailure(pending, error.message); throw error; }
    if (pending && closing === pending) void finishClosing(pending);
  });
  handle('request:send', payload => { if (closing) throw new Error('The application is closing.'); return engine.send(validateSendPayload(payload)); });
  handle('request:sent', requestId => { identifier(requestId, 'running request ID'); return engine.getSentRequest(requestId); });
  handle('request:cancel', requestId => { identifier(requestId, 'running request ID'); scriptRunner.cancel(requestId); engine.cancel(requestId); forgetDynamics(requestId); });
  handle('scripts:run', payload => { if (closing) throw new Error('The application is closing.'); return scriptRunner.run(payload); });
  handle('oauth:acquire', async (auth, variables, settings) => {
    if (closing) throw new Error('The application is closing.'); validateOAuthPayload(auth, variables, settings);
    if (auth.type !== 'oauth2') throw new Error('Token acquisition requires OAuth 2 authorization.');
    const controller = new AbortController(); tokenRequests.add(controller);
    try { return await acquireOAuth2Token(auth, resolveVariables(null, variables), settings, controller.signal); }
    finally { tokenRequests.delete(controller); }
  });
  handle('cookies:list', () => engine.getCookies());
  handle('cookies:clear', domain => engine.clearCookies(domain));
  handle('bugs:compose', async () => {
    try { await openBugReportDraft(shell, app.getVersion()); return { ok: true }; }
    catch (error) { return { ok: false, error: error.message || String(error) }; }
  });
  handle('storage:open', async () => {
    await store.initialize(); const error = await shell.openPath(store.directory);
    if (error) throw new Error(`Could not open the local data folder: ${error}`);
  });
  handle('files:import', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Import collections, environments or cURL files', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JSON and text files', extensions: ['json', 'txt', 'curl'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (selection.canceled) return [];
    if (selection.filePaths.length > 100) throw new Error('Import up to 100 files at a time.');
    let total = 0;
    const files = [];
    for (const filePath of selection.filePaths) {
      const stats = await fs.stat(filePath); total += stats.size;
      if (!stats.isFile() || total > 256 * 1024 * 1024) throw new Error('Imported files must total 256 MB or smaller.');
      const content = await fs.readFile(filePath, 'utf8');
      total += Buffer.byteLength(content, 'utf8') - stats.size;
      if (total > 256 * 1024 * 1024) throw new Error('Imported files must total 256 MB or smaller.');
      files.push({ name: path.basename(filePath), content });
    }
    return files;
  });
  handle('files:save', async (name, content) => {
    string(name, 'export file name', 256); string(content, 'export contents', 256 * 1024 * 1024);
    if (Buffer.byteLength(content, 'utf8') > 256 * 1024 * 1024) throw new Error('Export contents must be 256 MB or smaller.');
    const cleanName = path.basename(name.replace(/\\/g, '/')).replace(/[<>:"|?*\x00-\x1F]/g, '_') || 'api-manager-export.json';
    const selected = await dialog.showSaveDialog(mainWindow, {
      title: 'Save API Manager export', defaultPath: cleanName,
      filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'Text', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (selected.canceled || !selected.filePath) return false;
    await atomicWrite(selected.filePath, content); return true;
  });
  handle('files:select', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, { title: 'Choose an upload file', properties: ['openFile'] });
    return selection.canceled ? null : selection.filePaths[0] || null;
  });
}
function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Save Workspace', click: () => mainWindow?.webContents.send('workspace:save-requested', closing?.token) },
      { label: 'Open Local Data Folder', click: async () => { const error = await shell.openPath(store.directory); if (error) await dialog.showMessageBox(mainWindow, { type: 'error', message: error }); } },
      { type: 'separator' }, { role: 'quit' }
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(development ? [{ role: 'reload' }, { role: 'toggleDevTools' }] : [])] },
    { label: 'Help', submenu: [{ label: 'About API Manager', click: () => dialog.showMessageBox(mainWindow, { title: 'API Manager', message: `API Manager ${app.getVersion()}`, detail: 'Your collections, environments, sessions and cookies stay in the local application data folder. No account is required.' }) }] }
  ]));
}
function createWindow() {
  mayClose = false; closing = undefined;
  mainWindow = new BrowserWindow({
    title: 'API Manager', width: 1440, height: 960, minWidth: 1000, minHeight: 650,
    ...visibleWindowBounds(windowState, screen.getAllDisplays()),
    backgroundColor: '#171717', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, webSecurity: true }
  });
  if (windowState?.maximized) mainWindow.maximize();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!trustedUrl(url)) event.preventDefault(); });
  mainWindow.webContents.on('will-redirect', (event, url) => { if (!trustedUrl(url)) event.preventDefault(); });
  mainWindow.on('ready-to-show', () => { if (process.env.API_MANAGER_TEST_MODE !== '1') mainWindow.show(); });
  mainWindow.on('close', event => { if (!mayClose) { event.preventDefault(); requestClose(); } });
  const queueWindowSave = () => {
    clearTimeout(windowSaveTimer);
    windowSaveTimer = setTimeout(() => { void saveWindowState().catch(error => { windowWarning = `Window layout could not be saved: ${error.message}`; }); }, 500);
  };
  for (const event of ['move', 'resize', 'maximize', 'unmaximize']) mainWindow.on(event, queueWindowSave);
  mainWindow.on('closed', () => { clearTimeout(windowSaveTimer); mainWindow = undefined; closing = undefined; });
  mainWindow.webContents.on('render-process-gone', async (_event, details) => {
    if (details.reason === 'clean-exit' || !mainWindow) return;
    const answer = await dialog.showMessageBox(mainWindow, { type: 'error', title: 'API Manager interrupted', message: 'The application view stopped unexpectedly.', detail: 'Your last saved workspace is kept locally. Reload to restore it.', buttons: ['Reload', 'Close'], defaultId: 0 });
    if (answer.response === 0) mainWindow.webContents.reload(); else { mayClose = true; mainWindow.close(); }
  });
  mainWindow.loadURL(rendererUrl).catch(async error => {
    await dialog.showMessageBox(mainWindow, { type: 'error', message: 'API Manager could not open.', detail: development ? 'Start the development server with npm run dev, or build the application and launch with API_MANAGER_PRODUCTION=1.' : error.message });
    mayClose = true; mainWindow.close();
  });
}
if (!instanceLock) app.quit();
else app.whenReady().then(async () => {
  store = new WorkspaceStore(app.getPath('userData')); await store.initialize();
  engine = new RequestEngine({ store }); await engine.initialize();
  scriptRunner = new ScriptRunner();
  const savedWindow = await store.loadFile(path.join(store.directory, 'window-state.json'), validateWindowState, 'The window layout');
  windowState = savedWindow.value; windowWarning = savedWindow.warning;
  const canWriteClipboard = (contents, permission, details) => permission === 'clipboard-sanitized-write' &&
    contents === mainWindow?.webContents && details?.isMainFrame === true && trustedUrl(details.requestingUrl || contents.getURL());
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(canWriteClipboard(contents, permission, details)));
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => canWriteClipboard(contents, permission, details));
  session.defaultSession.setDevicePermissionHandler(() => false);
  registerIpc(); createMenu(); createWindow();
}).catch(async error => { await dialog.showErrorBox('API Manager could not start', error.message); app.exit(1); });
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && store) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
