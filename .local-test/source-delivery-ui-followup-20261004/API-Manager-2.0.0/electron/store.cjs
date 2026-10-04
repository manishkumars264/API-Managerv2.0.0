'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validateWorkspace } = require('./validation.cjs');
const MAX_STORAGE_BYTES = 256 * 1024 * 1024;

async function atomicWrite(filePath, content) {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8'); await handle.sync(); await handle.close(); handle = undefined;
    await fs.rename(temporary, filePath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function readJson(filePath, validate) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile() || stats.size > MAX_STORAGE_BYTES) throw new Error('Local data exceeds the storage limit.');
  const source = await fs.readFile(filePath, 'utf8');
  const value = JSON.parse(source); validate(value);
  return { source, value };
}
function validateCookies(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.cookies) || value.cookies.length > 100000) throw new Error('Invalid local cookie storage.');
  for (const cookie of value.cookies) {
    if (!cookie || typeof cookie !== 'object' || typeof cookie.key !== 'string' || typeof cookie.value !== 'string' || typeof cookie.domain !== 'string' || typeof cookie.path !== 'string') throw new Error('Invalid local cookie entry.');
  }
}
class WorkspaceStore {
  constructor(directory) {
    this.directory = path.resolve(directory); this.workspacePath = path.join(this.directory, 'workspace.json');
    this.cookiePath = path.join(this.directory, 'cookies.json'); this.queue = Promise.resolve();
  }
  async initialize() { await fs.mkdir(this.directory, { recursive: true }); }
  async loadFile(filePath, validate, label) {
    await this.initialize();
    try { return { value: (await readJson(filePath, validate)).value }; }
    catch (error) {
      const missing = error.code === 'ENOENT';
      const quarantine = `${filePath}.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}`;
      let preserved = false;
      if (!missing) { try { await fs.rename(filePath, quarantine); preserved = true; } catch {} }
      try {
        const backup = await readJson(`${filePath}.backup`, validate);
        await atomicWrite(filePath, backup.source);
        return { value: backup.value, warning: `${label} was ${missing ? 'missing' : 'damaged'}. The previous saved backup was restored.${preserved ? ' The damaged file was kept in the data folder.' : ''}` };
      } catch (backupError) {
        if (missing && backupError.code === 'ENOENT') return { value: null };
        return { value: null, warning: `${label} could not be read and no valid backup was available.${preserved ? ' The damaged file was kept in the data folder.' : ''} A new local workspace can be saved.` };
      }
    }
  }
  async load() {
    const result = await this.loadFile(this.workspacePath, validateWorkspace, 'The workspace');
    return { workspace: result.value, warning: result.warning, storagePath: this.directory };
  }
  async loadCookies() { return this.loadFile(this.cookiePath, validateCookies, 'The cookie jar'); }
  enqueue(operation) {
    const pending = this.queue.then(operation); this.queue = pending.catch(() => {}); return pending;
  }
  saveFile(filePath, value, validate) {
    validate(value);
    const source = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(source, 'utf8') > MAX_STORAGE_BYTES) throw new Error('Local data exceeds the 256 MB storage limit. Reduce saved response history.');
    return this.enqueue(async () => {
      await this.initialize();
      try {
        const previous = await readJson(filePath, validate);
        await atomicWrite(`${filePath}.backup`, previous.source);
      } catch (error) { if (error.code && error.code !== 'ENOENT') throw error; }
      await atomicWrite(filePath, source);
    });
  }
  save(workspace) { return this.saveFile(this.workspacePath, workspace, validateWorkspace); }
  saveCookies(cookies) { return this.saveFile(this.cookiePath, cookies, validateCookies); }
  async flush() { await this.queue; }
}

module.exports = { WorkspaceStore, atomicWrite, validateCookies };
