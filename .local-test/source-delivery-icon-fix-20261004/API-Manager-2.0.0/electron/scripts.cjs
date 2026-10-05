'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { validateScriptPayload, validateScriptResult } = require('./validation.cjs');
const { dynamicSession, pinDynamics } = require('./dynamic-session.cjs');

// This function is serialized into a separate, unprivileged Chromium renderer.
// It must not close over Node values, imports, application objects, or IPC.
async function sandboxProgram(payload, expect) {
  const copy = value => JSON.parse(JSON.stringify(value));
  const encode = TextEncoder.prototype.encode.bind(new TextEncoder()), serialize = JSON.stringify.bind(JSON);
  const request = copy(payload.request), tests = [], logs = [], pending = new Set(), timers = new Set();
  const nativeTimeout = globalThis.setTimeout.bind(globalThis), nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const nativeInterval = globalThis.setInterval.bind(globalThis), nativeClearInterval = globalThis.clearInterval.bind(globalThis);
  let runtimeError;
  const describe = value => {
    try { return typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); }
  };
  const errorText = error => String(error?.message || error).slice(0, 10000);
  const uuid = () => globalThis.crypto?.randomUUID?.() || `script-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  function tracked(promise) {
    const task = Promise.resolve(promise).catch(error => { runtimeError ||= errorText(error); }).finally(() => pending.delete(task));
    pending.add(task); return task;
  }
  const callTimer = (callback, args) => { try { const value = callback(...args); if (value?.then) tracked(value); } catch (error) { runtimeError ||= errorText(error); } };
  const safeTimeout = (callback, delay = 0, ...args) => {
    if (typeof callback !== 'function') throw new Error('Timers require a function callback.');
    if (timers.size >= 1000) throw new Error('Script timer limit reached.');
    const id = nativeTimeout(() => { timers.delete(id); callTimer(callback, args); }, Math.max(0, Number(delay) || 0)); timers.add(id); return id;
  };
  const safeInterval = (callback, delay = 0, ...args) => {
    if (typeof callback !== 'function') throw new Error('Timers require a function callback.');
    if (timers.size >= 1000) throw new Error('Script timer limit reached.');
    const id = nativeInterval(() => callTimer(callback, args), Math.max(1, Number(delay) || 1)); timers.add(id); return id;
  };
  const clearTimer = id => { timers.delete(id); nativeClearTimeout(id); nativeClearInterval(id); };
  globalThis.setTimeout = safeTimeout; globalThis.setInterval = safeInterval;
  globalThis.clearTimeout = clearTimer; globalThis.clearInterval = clearTimer;
  function scope(initial) {
    let rows = copy(initial);
    const get = key => rows.filter(row => row.enabled && row.key === String(key)).at(-1)?.value;
    const set = (key, value) => {
      key = String(key); value = typeof value === 'string' ? value : String(value);
      if (!key || key.length > 10000 || value.length > 1024 * 1024) throw new Error('Script variable name or value exceeds its size limit.');
      const found = rows.findLast(row => row.key === key);
      if (found) { found.value = value; found.enabled = true; }
      else { if (rows.length >= 10000) throw new Error('Script variable count limit reached.'); rows.push({ id: uuid(), key, value, enabled: true }); }
    };
    return {
      get, set, has: key => get(key) !== undefined,
      unset: key => { rows = rows.filter(row => row.key !== String(key)); }, clear: () => { rows = []; },
      toObject: () => Object.fromEntries(rows.filter(row => row.enabled).map(row => [row.key, row.value])),
      _rows: () => copy(rows)
    };
  }
  const environment = scope(payload.environment), globals = scope(payload.globals), collectionVariables = scope(payload.collectionVariables);
  const scopedAtStart = { ...globals.toObject(), ...collectionVariables.toObject(), ...environment.toObject() };
  // Effective values that are absent from these explicit scopes represent folder
  // or earlier local values. They remain available between stage executions.
  const priorLocals = scope(payload.variables.filter(row => row.enabled && row.extra?.apiManagerScriptLocal === true));
  const inheritedValues = scope(payload.folderVariables ?? payload.variables.filter(row => row.enabled && row.extra?.apiManagerScriptLocal !== true && row.extra?.apiManagerScriptDynamic !== true && (!Object.hasOwn(scopedAtStart, row.key) || scopedAtStart[row.key] !== row.value)));
  const priorDynamics = scope(payload.variables.filter(row => row.enabled && row.extra?.apiManagerScriptDynamic === true));
  const locals = scope([]);
  const effectiveObject = () => ({ ...priorDynamics.toObject(), ...globals.toObject(), ...collectionVariables.toObject(), ...inheritedValues.toObject(), ...environment.toObject(), ...priorLocals.toObject(), ...locals.toObject() });
  const dynamicValues = new Map();
  function replaceIn(text, stack = []) {
    return String(text).replace(/{{\s*([^{}]+?)\s*}}/g, (_match, name) => {
      name = name.trim();
      if (stack.includes(name) || stack.length >= 30) throw new Error(`Circular or excessively nested variable: ${name}`);
      const values = effectiveObject();
      if (Object.hasOwn(values, name)) return replaceIn(values[name], [...stack, name]);
      if (!dynamicValues.has(name)) {
        let value;
        if (Object.hasOwn(payload.dynamicValues || {}, name)) value = payload.dynamicValues[name];
        else if (name === '$guid' || name === '$randomUUID') value = uuid();
        else if (name === '$timestamp') value = String(Math.floor(Date.now() / 1000));
        else if (name === '$isoTimestamp') value = new Date().toISOString();
        else if (name === '$randomInt') value = String(Math.floor(Math.random() * 1001));
        else if (name === '$randomBoolean') value = String(Math.random() >= 0.5);
        else if (name === '$randomString') value = Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        else throw new Error(`Unresolved variable: {{${name}}}`);
        dynamicValues.set(name, value);
      }
      return dynamicValues.get(name);
    });
  }
  const variables = {
    get: key => { const values = effectiveObject(); return Object.hasOwn(values, String(key)) ? values[String(key)] : undefined; }, has: key => Object.hasOwn(effectiveObject(), String(key)),
    set: locals.set, unset: key => { locals.unset(key); priorLocals.unset(key); }, clear: () => { locals.clear(); priorLocals.clear(); },
    toObject: effectiveObject, replaceIn
  };
  for (const item of [environment, globals, collectionVariables]) item.replaceIn = replaceIn;
  function headers(owner) {
    return {
      get: key => owner.headers.findLast(row => row.enabled && row.key.toLowerCase() === String(key).toLowerCase())?.value,
      has(key) { return this.get(key) !== undefined; },
      add: value => {
        const row = typeof value === 'string' ? { key: value.split(':')[0], value: value.split(':').slice(1).join(':').trim() } : value;
        if (!row || typeof row.key !== 'string' || typeof row.value !== 'string') throw new Error('Headers require a key and string value.');
        if (owner.headers.length >= 10000 || row.value.length > 1024 * 1024) throw new Error('Script header limit reached.');
        owner.headers.push({ id: uuid(), key: row.key, value: row.value, enabled: row.disabled !== true });
      },
      upsert(value) { this.remove(value.key); this.add(value); },
      remove: key => { owner.headers = owner.headers.filter(row => row.key.toLowerCase() !== String(key).toLowerCase()); },
      all: () => copy(owner.headers), toJSON: () => copy(owner.headers),
      each: callback => owner.headers.forEach(row => callback(copy(row)))
    };
  }
  const requestHeaders = headers(request);
  const requestUrl = { toString: () => request.url, toJSON: () => request.url, update: value => { request.url = String(value); } };
  const pmRequest = new Proxy(request, {
    get(target, key) { if (key === 'headers') return requestHeaders; if (key === 'url') return requestUrl; return target[key]; },
    set(target, key, value) { if (key === 'url') target.url = String(value); else target[key] = value; return true; }
  });
  const response = payload.response ? copy(payload.response) : undefined;
  function responseAssertions(negated = false) {
    const chain = {}, assertion = (value, message) => negated ? expect(value, message).not : expect(value, message);
    const check = (matches, label) => { assertion(Boolean(matches), label).equal(true); return chain; };
    for (const key of ['to', 'be', 'have', 'and', 'that', 'which']) Object.defineProperty(chain, key, { get: () => chain });
    Object.defineProperty(chain, 'not', { get: () => responseAssertions(!negated) });
    chain.status = value => { assertion(typeof value === 'string' ? response.statusText : response.status).equal(value); return chain; };
    chain.header = (key, value) => {
      const found = headers(response).get(key);
      if (value === undefined) check(found !== undefined, `response header ${key}`);
      else assertion(found).equal(value);
      return chain;
    };
    chain.body = value => { if (value === undefined) check(response.body.length > 0, 'response body exists'); else assertion(response.body).equal(value); return chain; };
    chain.jsonBody = (path, value) => {
      let parsed;
      try { parsed = JSON.parse(response.body); } catch { return check(false, 'response is valid JSON'); }
      if (path === undefined || path === '') return check(true, 'response is valid JSON');
      if (typeof path === 'string') {
        if (value === undefined) assertion(parsed).have.nested.property(path);
        else assertion(parsed).have.deep.nested.property(path, value);
      } else assertion(parsed).deep.include(path);
      return chain;
    };
    Object.defineProperty(chain, 'responseTime', { get: () => assertion(response.duration) });
    const predicates = {
      ok: () => response.status === 200, success: () => response.status >= 200 && response.status < 300,
      info: () => response.status >= 100 && response.status < 200, redirection: () => response.status >= 300 && response.status < 400,
      error: () => response.status >= 400, clientError: () => response.status >= 400 && response.status < 500, serverError: () => response.status >= 500,
      accepted: () => response.status === 202, badRequest: () => response.status === 400, unauthorized: () => response.status === 401,
      forbidden: () => response.status === 403, notFound: () => response.status === 404, rateLimited: () => response.status === 429,
      withBody: () => response.body.length > 0, json: () => { try { JSON.parse(response.body); return true; } catch { return false; } }
    };
    for (const [key, predicate] of Object.entries(predicates)) Object.defineProperty(chain, key, { get: () => check(predicate(), `response ${key}`) });
    return chain;
  }
  const pmResponse = response ? {
    code: response.status, status: response.statusText, responseTime: response.duration, responseSize: response.size, headers: headers(response),
    text: () => response.body, json: () => JSON.parse(response.body), size: () => ({ body: response.size }),
    to: responseAssertions()
  } : undefined;
  const runTest = (name, callback) => {
    if (typeof callback !== 'function') throw new Error('pm.test requires a function.');
    if (tests.length >= 1000) throw new Error('Script test count limit reached.');
    const result = { name: String(name).slice(0, 1000), passed: false }; tests.push(result);
    try {
      const value = callback.length ? new Promise((resolve, reject) => callback(error => error ? reject(error) : resolve())) : callback();
      if (value?.then) tracked(Promise.resolve(value).then(() => { result.passed = true; }, error => { result.error = errorText(error); }));
      else result.passed = true;
    } catch (error) { result.error = errorText(error); }
  };
  runTest.skip = name => { if (logs.length < 1000) logs.push({ level: 'info', message: `Skipped test: ${String(name).slice(0, 1000)}` }); };
  runTest.index = () => tests.length;
  const pm = {
    environment, globals, collectionVariables, variables, request: pmRequest, response: pmResponse,
    test: runTest, expect,
    info: { eventName: payload.stage === 'pre-request' ? 'prerequest' : 'test', requestName: request.name, requestId: request.id, iteration: 0, iterationCount: 1 },
    iterationData: { get: () => undefined, has: () => false, toObject: () => ({}) },
    sendRequest: () => { throw new Error('pm.sendRequest is not supported in this script sandbox. Send additional requests from their own tabs.'); },
    execution: { setNextRequest: () => { throw new Error('Collection runner control is not supported.'); } }
  };
  const scriptConsole = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(level => [level, (...values) => {
    if (logs.length < 1000) logs.push({ level, message: values.map(describe).join(' ').slice(0, 10000) });
  }]));
  globalThis.console = scriptConsole;
  const postman = {
    setEnvironmentVariable: environment.set, getEnvironmentVariable: environment.get, clearEnvironmentVariable: environment.unset,
    setGlobalVariable: globals.set, getGlobalVariable: globals.get, clearGlobalVariable: globals.unset,
    setNextRequest: pm.execution.setNextRequest
  };
  let error;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const program = new AsyncFunction('pm', 'postman', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', `"use strict";\n${payload.script}`);
    await program(pm, postman, scriptConsole, safeTimeout, clearTimer, safeInterval, clearTimer);
    // Registered timers and asynchronous pm.test callbacks complete before results
    // are returned. The main process destroys this renderer at the hard deadline.
    while ((timers.size || pending.size) && !runtimeError) await new Promise(resolve => nativeTimeout(resolve, 5));
    if (runtimeError) error = runtimeError;
  } catch (cause) { error = errorText(cause); }
  finally { for (const id of timers) clearTimer(id); }
  const merged = new Map();
  for (const rows of [priorDynamics._rows(), globals._rows(), collectionVariables._rows(), inheritedValues._rows(), environment._rows(), priorLocals._rows(), locals._rows().map(row => ({ ...row, extra: { ...row.extra, apiManagerScriptLocal: true } }))]) for (const row of rows) if (row.enabled) merged.set(row.key, row);
  for (const [name, value] of dynamicValues) if (!merged.has(name)) merged.set(name, { id: uuid(), key: name, value, enabled: true, extra: { apiManagerScriptDynamic: true } });
  const result = { request, environment: environment._rows(), globals: globals._rows(), collectionVariables: collectionVariables._rows(), variables: [...merged.values()], tests, logs, ...(error ? { error } : {}) };
  // Check inside the isolated worker before transferring a large result through
  // Chromium IPC. Main validates the same ceiling again on received data.
  if (encode(serialize(result)).byteLength > 32 * 1024 * 1024) throw new Error('Script result exceeds the 32 MB limit.');
  return result;
}
function scriptSource(payload, chaiSource) {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(chaiSource).toString('base64')}`;
  const workerSource = `self.onmessage = async event => { try { const { expect } = await import(${JSON.stringify(moduleUrl)}); const result = await (${sandboxProgram.toString()})(event.data, expect); self.postMessage({ ok: true, result }); } catch (error) { self.postMessage({ ok: false, message: error.message || String(error) }); } };`;
  return `new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const finish = () => { worker.terminate(); URL.revokeObjectURL(url); };
    worker.onmessage = event => { finish(); if (event.data.ok) resolve(event.data.result); else reject(new Error(event.data.message)); };
    worker.onerror = event => { finish(); reject(new Error(event.message || 'The script worker failed.')); };
    worker.postMessage(${JSON.stringify(payload)});
  })`;
}
let chaiBundle;
function loadChai() { chaiBundle ||= fs.readFile(require.resolve('chai'), 'utf8'); return chaiBundle; }
class ScriptRunner {
  constructor({ timeout = 3000 } = {}) { this.timeout = timeout; this.active = new Set(); }
  async run(payload) {
    validateScriptPayload(payload);
    const { BrowserWindow } = require('electron');
    const partition = `api-manager-script-${randomUUID()}`;
    const win = new BrowserWindow({ show: false, width: 1, height: 1, skipTaskbar: true, webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false,
      partition, backgroundThrottling: false, disableDialogs: true, navigateOnDragDrop: false
    } });
    const entry = { win, requestId: payload.requestId, reject: null }; this.active.add(entry);
    const contents = win.webContents, session = contents.session, diagnostics = [];
    contents.on('console-message', (event, details, legacyMessage) => { if (diagnostics.length < 20) diagnostics.push({ level: 'error', message: String(event?.message || details?.message || legacyMessage || 'Script sandbox console message').slice(0, 10000) }); });
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false); session.setDevicePermissionHandler(() => false);
    session.on('will-download', event => event.preventDefault());
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !details.url.startsWith('data:') && !details.url.startsWith('blob:') }));
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault()); contents.on('will-redirect', event => event.preventDefault());
    const page = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-eval\' data: blob:; connect-src \'none\'; worker-src blob:; frame-src \'none\'; form-action \'none\'; base-uri \'none\'"><title>API Manager script sandbox</title>');
    let timer, releaseDynamics;
    const failure = new Promise((_resolve, reject) => {
      entry.reject = reject;
      timer = setTimeout(() => reject(new Error(`Script exceeded the ${this.timeout} ms execution limit.`)), this.timeout);
      contents.once('render-process-gone', () => reject(new Error('The script sandbox stopped unexpectedly.')));
      win.once('closed', () => reject(new Error('Script execution cancelled.')));
    });
    try {
      // Pin the same flight through loading, execution and result transfer. The
      // request engine does the same for arbitrarily long HTTP operations.
      const flightId = payload.requestId || randomUUID();
      releaseDynamics = pinDynamics(flightId, payload.variables);
      const executionPayload = { ...payload, dynamicValues: dynamicSession(flightId, payload.variables).dictionary() };
      const source = await loadChai();
      const execution = win.loadURL(page).then(() => contents.executeJavaScript(scriptSource(executionPayload, source), false));
      const result = await Promise.race([execution, failure]); validateScriptResult(result); return result;
    } catch (error) {
      return { request: payload.request, environment: payload.environment, globals: payload.globals, collectionVariables: payload.collectionVariables, variables: payload.variables, tests: [], logs: diagnostics, error: error.message || String(error) };
    } finally {
      releaseDynamics?.();
      clearTimeout(timer); this.active.delete(entry);
      if (!win.isDestroyed()) win.destroy();
      await session.clearStorageData().catch(() => {});
    }
  }
  cancel(requestId) {
    for (const entry of this.active) if (!requestId || entry.requestId === requestId) { entry.reject?.(new Error('Script execution cancelled.')); if (!entry.win.isDestroyed()) entry.win.destroy(); }
  }
  shutdown() { this.cancel(); }
}
module.exports = { ScriptRunner, scriptSource, sandboxProgram };
