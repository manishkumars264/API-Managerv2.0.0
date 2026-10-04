'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceStore } = require('../electron/store.cjs');
const { validateWorkspace } = require('../electron/validation.cjs');
const { validateWindowState, visibleWindowBounds } = require('../electron/window-state.cjs');

function workspace(name = 'first') {
  return { version: 1, collections: [{ id: 'collection', name, description: '', folders: [], requests: [], variables: [], auth: { type: 'none' } }], environments: [], globals: [], activeEnvironmentId: null, tabs: [], activeTabId: '', history: [], settings: { theme: 'dark', timeout: 30000, followRedirects: true, verifySsl: true, maxResponseMB: 20 }, sidebarView: 'collections', sidebarWidth: 268 };
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'api-manager-store-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new WorkspaceStore(directory);
}
test('workspace saves atomically, serializes concurrent saves and restores latest state', async t => {
  const store = await fixture(t); assert.equal((await store.load()).workspace, null);
  await Promise.all([store.save(workspace('first')), store.save(workspace('second')), store.save(workspace('third'))]); await store.flush();
  assert.equal((await new WorkspaceStore(store.directory).load()).workspace.collections[0].name, 'third');
  assert.equal(JSON.parse(await fs.readFile(`${store.workspacePath}.backup`, 'utf8')).collections[0].name, 'second');
  assert.equal((await fs.readdir(store.directory)).filter(name => name.endsWith('.tmp')).length, 0);
});
test('damaged primary recovers backup with warning and preserves corruption evidence', async t => {
  const store = await fixture(t); await store.save(workspace('backup')); await store.save(workspace('latest')); await fs.writeFile(store.workspacePath, '{broken json');
  const loaded = await store.load(); assert.equal(loaded.workspace.collections[0].name, 'backup'); assert.match(loaded.warning, /backup was restored/);
  const files = await fs.readdir(store.directory); assert.ok(files.some(name => name.startsWith('workspace.json.corrupt-'))); assert.equal((await store.load()).warning, undefined);
});
test('missing primary recovers valid backup and invalid-schema primary is rejected', async t => {
  const store = await fixture(t); await store.save(workspace('backup')); await store.save(workspace('latest')); await fs.unlink(store.workspacePath);
  assert.equal((await store.load()).workspace.collections[0].name, 'backup');
  await fs.writeFile(store.workspacePath, JSON.stringify({ version: 1, collections: 'invalid' }));
  assert.equal((await store.load()).workspace.collections[0].name, 'backup');
});
test('no valid backup returns recoverable warning and subsequent save succeeds', async t => {
  const store = await fixture(t); await store.initialize(); await fs.writeFile(store.workspacePath, '{invalid'); await fs.writeFile(`${store.workspacePath}.backup`, '{also invalid');
  const loaded = await store.load(); assert.equal(loaded.workspace, null); assert.match(loaded.warning, /no valid backup/);
  await store.save(workspace('fresh')); assert.equal((await store.load()).workspace.collections[0].name, 'fresh');
});
test('schema failures cannot overwrite good data or break the next save', async t => {
  const store = await fixture(t); await store.save(workspace('good'));
  assert.throws(() => store.save({ ...workspace(), version: 2 }), /workspace version/);
  assert.equal((await store.load()).workspace.collections[0].name, 'good');
  const duplicate = workspace(); duplicate.collections.push({ ...duplicate.collections[0] }); assert.throws(() => validateWorkspace(duplicate), /Duplicate collection/);
  await store.save(workspace('updated')); assert.equal((await store.load()).workspace.collections[0].name, 'updated');
});
test('cookie storage corruption recovers an earlier validated backup', async t => {
  const store = await fixture(t), cookieData = value => ({ version: 'tough-cookie@6.0.0', storeType: 'MemoryCookieStore', rejectPublicSuffixes: true, enableLooseMode: false, allowSpecialUseDomain: true, prefixSecurity: 'silent', cookies: [{ key: 'token', value, domain: 'localhost', path: '/' }] });
  await store.saveCookies(cookieData('backup')); await store.saveCookies(cookieData('latest')); await fs.writeFile(store.cookiePath, 'corrupt');
  const loaded = await store.loadCookies(); assert.equal(loaded.value.cookies[0].value, 'backup'); assert.match(loaded.warning, /backup was restored/);
});
test('saved window layouts keep visible positions and recover after a monitor is removed', () => {
  const display = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  const layout = { version: 1, x: 100, y: 100, width: 1200, height: 800, maximized: false };
  assert.deepEqual(visibleWindowBounds(layout, display), { x: 100, y: 100, width: 1200, height: 800 });
  assert.deepEqual(visibleWindowBounds({ ...layout, x: 5000 }, display), { width: 1200, height: 800 });
  assert.throws(() => validateWindowState({ ...layout, width: Infinity }), /Invalid saved window size/);
});
