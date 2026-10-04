'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { sandboxProgram } = require('../electron/scripts.cjs');
const { validateScriptPayload, validateScriptResult, validateWorkspace } = require('../electron/validation.cjs');

const row = (key, value, extra = {}) => ({ id: crypto.randomUUID(), key, value, enabled: true, ...extra });
function payload(script, stage = 'pre-request') {
  return {
    script, stage, requestId: 'script-flight',
    request: { id: 'request', name: 'Scripted request', method: 'GET', url: 'https://example.com', params: [], headers: [], auth: { type: 'none' }, description: '', body: { mode: 'none', language: 'json', raw: '', fields: [] } },
    environment: [row('token', 'original')], globals: [row('base', 'https://example.com')], collectionVariables: [row('collectionValue', 'available')], variables: [row('token', 'original'), row('base', 'https://example.com'), row('collectionValue', 'available')],
    ...(stage === 'post-response' ? { response: { status: 200, statusText: 'OK', headers: [row('Content-Type', 'application/json')], body: '{"token":"received","items":[1,2]}', duration: 12, size: 35, url: 'https://example.com', receivedAt: new Date().toISOString() } } : {})
  };
}
// vm is used only as a unit-test harness for the pure compatibility program.
// Production execution always uses the separate Chromium worker process.
async function runUnit(input) {
  const { expect } = await import('chai');
  const context = vm.createContext({ payload: structuredClone(input), chaiExpect: expect, crypto: crypto.webcrypto, TextEncoder, setTimeout, clearTimeout, setInterval, clearInterval });
  const result = await vm.runInContext(`(${sandboxProgram.toString()})(payload, chaiExpect)`, context, { timeout: 3000 });
  return JSON.parse(JSON.stringify(result));
}
test('pre-request scripts mutate request headers, URL, body and persistent variable scopes', async () => {
  const result = await runUnit(payload(`
    pm.environment.set('token', 'new-token');
    pm.globals.set('added', 42);
    pm.collectionVariables.set('collectionValue', 'updated');
    pm.variables.set('local', 'one-run');
    pm.request.headers.add({key:'X-Test',value:'one'});
    pm.request.headers.upsert({key:'X-Test',value:pm.environment.get('token')});
    pm.request.url.update(pm.variables.replaceIn('{{base}}/script'));
    pm.request.method='POST'; pm.request.body.mode='raw'; pm.request.body.raw='{"scripted":true}';
    pm.test('scopes visible',()=>pm.expect(pm.variables.get('token')).to.equal('new-token'));
    console.log('updated',pm.request.headers.get('X-Test'));
  `));
  validateScriptResult(result); assert.equal(result.error, undefined); assert.equal(result.request.url, 'https://example.com/script');
  assert.equal(result.request.headers.length, 1); assert.equal(result.request.headers[0].value, 'new-token'); assert.equal(result.request.body.raw, '{"scripted":true}');
  assert.equal(result.environment.find(item => item.key === 'token').value, 'new-token'); assert.equal(result.globals.find(item => item.key === 'added').value, '42');
  assert.equal(result.collectionVariables[0].value, 'updated'); assert.equal(result.variables.find(item => item.key === 'local').extra.apiManagerScriptLocal, true);
  assert.deepEqual(result.tests, [{ name: 'scopes visible', passed: true }]); assert.match(result.logs[0].message, /updated new-token/);
});
test('post-response scripts use real Chai assertions, JSON, headers and status helpers', async () => {
  const result = await runUnit(payload(`
    pm.test('status',()=>pm.response.to.have.status(200));
    pm.test('header',()=>pm.response.to.have.header('content-type','application/json'));
    pm.test('json assertions',()=>{pm.expect(pm.response.json()).to.have.property('items').with.lengthOf(2);pm.expect([1,2]).to.have.members([2,1]);});
    pm.test('expected failure',()=>pm.expect(pm.response.code).to.equal(404));
    pm.environment.set('token',pm.response.json().token);
  `, 'post-response'));
  assert.equal(result.tests.filter(item => item.passed).length, 3); assert.equal(result.tests[3].passed, false); assert.match(result.tests[3].error, /expected 200 to equal 404/);
  assert.equal(result.environment[0].value, 'received');
});
test('response assertions support negation, status text, nested JSON paths and correct status groups', async () => {
  const input = payload(`
    pm.test('status text',()=>pm.response.to.have.status('Created'));
    pm.test('created is success but not OK',()=>{pm.response.to.be.success;pm.response.to.not.be.ok;});
    pm.test('negated status/header/body',()=>{pm.response.to.not.have.status(404);pm.response.to.not.have.header('missing');pm.response.to.not.have.body('other');});
    pm.test('JSON property path',()=>{pm.response.to.have.jsonBody('items[0]',1);pm.response.to.have.jsonBody('token','received');pm.response.to.not.have.jsonBody('error');});
    pm.test('JSON and body predicates',()=>{pm.response.to.be.json.and.withBody;pm.response.to.have.jsonBody();pm.response.to.have.responseTime.not.above(20);});
    pm.test('missing property fails',()=>pm.response.to.have.jsonBody('missing'));
  `, 'post-response');
  input.response.status = 201; input.response.statusText = 'Created';
  const result = await runUnit(input); assert.equal(result.error, undefined); assert.deepEqual(result.tests.map(item => item.passed), [true, true, true, true, true, false]);
  input.response.status = 302; input.script = `pm.test('redirect is not success',()=>{pm.response.to.be.redirection;pm.response.to.not.be.success;});`;
  assert.equal((await runUnit(input)).tests[0].passed, true);
  input.response.body = '<xml/>'; input.script = `pm.test('non-JSON is not JSON',()=>{pm.response.to.not.be.json;pm.response.to.not.have.jsonBody();});`;
  assert.equal((await runUnit(input)).tests[0].passed, true);
});
test('async functions, done callbacks and timers finish before test results return', async () => {
  const result = await runUnit(payload(`
    await new Promise(resolve=>setTimeout(resolve,5));
    pm.test('async assertion',async()=>{await new Promise(resolve=>setTimeout(resolve,5));pm.expect(true).to.be.true;});
    pm.test('done assertion',done=>setTimeout(()=>{pm.expect(2).to.be.above(1);done();},5));
    setTimeout(()=>{pm.globals.set('late','stored');console.info('timer finished');},10);
  `));
  assert.deepEqual(result.tests.map(item => item.passed), [true, true]); assert.equal(result.globals.find(item => item.key === 'late').value, 'stored');
  assert.equal(result.logs[0].message, 'timer finished');
});
test('script exceptions preserve earlier tests, logs and mutations and unsupported APIs explain failure', async () => {
  const result = await runUnit(payload(`pm.test('earlier',()=>pm.expect(1).to.equal(1));console.warn('kept');pm.environment.set('token','kept');throw new Error('intentional failure');`));
  assert.equal(result.error, 'intentional failure'); assert.equal(result.tests[0].passed, true); assert.equal(result.logs[0].message, 'kept'); assert.equal(result.environment[0].value, 'kept');
  const unsupported = await runUnit(payload('pm.sendRequest("https://example.com");')); assert.match(unsupported.error, /pm.sendRequest is not supported/);
});
test('local overrides survive sequential stages while environment mutations update effective values', async () => {
  const first = await runUnit(payload(`pm.variables.set('token','local');pm.environment.set('token','environment');`));
  const second = payload(`pm.environment.set('token','changed');pm.test('local takes precedence',()=>pm.expect(pm.variables.get('token')).to.equal('local'));pm.variables.unset('token');pm.test('fallback environment',()=>pm.expect(pm.variables.get('token')).to.equal('changed'));`);
  for (const key of ['request', 'environment', 'globals', 'collectionVariables', 'variables']) second[key] = first[key];
  const result = await runUnit(second); assert.deepEqual(result.tests.map(item => item.passed), [true, true]); assert.equal(result.variables.find(item => item.key === 'token').value, 'changed');
});
test('explicit folder scopes retain equal or environment-masked fallback values across script mutations', async () => {
  const input = payload(`pm.collectionVariables.set('x','changed-collection');pm.test('folder remains stronger',()=>pm.expect(pm.variables.get('x')).equal('same'));pm.environment.unset('masked');pm.test('folder fallback restored',()=>pm.expect(pm.variables.get('masked')).equal('closest-folder'));`);
  input.collectionVariables = [row('x', 'same'), row('masked', 'collection')];
  input.folderVariables = [row('x', 'same'), row('masked', 'ancestor-folder'), row('masked', 'closest-folder')];
  input.environment = [row('masked', 'environment')]; input.variables = [row('x', 'same'), row('masked', 'environment')];
  validateScriptPayload(input);
  const first = await runUnit(input); assert.deepEqual(first.tests.map(item => item.passed), [true, true]);
  assert.equal(first.variables.find(item => item.key === 'x').value, 'same'); assert.equal(first.variables.find(item => item.key === 'masked').value, 'closest-folder');
  const second = await runUnit({ ...input, ...first, script: `pm.collectionVariables.clear();pm.variables.set('x','local');pm.variables.unset('x');pm.test('folder remains after local removed',()=>pm.expect(pm.variables.get('x')).equal('same'));` });
  assert.equal(second.tests[0].passed, true);
  assert.throws(() => validateScriptPayload({ ...input, folderVariables: 'invalid' }), /folderVariables/);
});
test('script payload validation bounds source and requires a response for post-response stage', () => {
  assert.throws(() => validateScriptPayload(payload('x'.repeat(1024 * 1024 + 1))), /Invalid script source/);
  const invalid = payload('', 'post-response'); delete invalid.response; assert.throws(() => validateScriptPayload(invalid), /require a response/);
});
test('oversized script results are rejected in the sandbox before being sent to the application', async () => {
  await assert.rejects(runUnit(payload(`const value='x'.repeat(1024*1024);for(let i=0;i<33;i++)pm.variables.set('large'+i,value);`)), /32 MB limit/);
});

test('actual Electron sandbox denies Node, DOM and network, terminates loops, and cancels by request ID', { timeout: 25000 }, async t => {
  const { _electron } = require('@playwright/test');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'api-manager-script-electron-'));
  const environment = { ...process.env, API_MANAGER_PRODUCTION: '1', API_MANAGER_TEST_MODE: '1', API_MANAGER_DATA_DIR: directory };
  delete environment.ELECTRON_RUN_AS_NODE;
  const electronApp = await _electron.launch({ args: [path.resolve(__dirname, '..')], env: environment, timeout: 15000 });
  t.after(async () => { await electronApp.close().catch(() => {}); await fs.rm(directory, { recursive: true, force: true }); });
  const window = await electronApp.firstWindow(); await window.waitForFunction(() => Boolean(window.apiManager), { timeout: 15000 });
  let hits = 0;
  const network = http.createServer(async (request, response) => {
    hits++; const chunks = []; for await (const chunk of request) chunks.push(chunk);
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') }));
  }); network.listen(0, '127.0.0.1'); await once(network, 'listening');
  t.after(() => { network.closeAllConnections(); return new Promise(resolve => network.close(resolve)); });
  const safe = await window.evaluate(input => window.apiManager.runScript(input), payload(`
    pm.test('no Node',()=>{pm.expect(typeof process).to.equal('undefined');pm.expect(typeof require).to.equal('undefined');});
    pm.test('no DOM or app bridge',()=>{pm.expect(typeof document).to.equal('undefined');pm.expect(typeof window).to.equal('undefined');pm.expect(typeof apiManager).to.equal('undefined');});
    let denied=false;try{await fetch('http://127.0.0.1:${network.address().port}/private')}catch(error){denied=true};pm.test('network denied',()=>pm.expect(denied).to.be.true);
  `));
  assert.equal(safe.error, undefined, JSON.stringify(safe.logs)); assert.deepEqual(safe.tests.map(item => item.passed), [true, true, true]);
  assert.equal(hits, 0);
  const override = payload(`pm.environment.unset('$randomUUID');pm.test('built-in returns after saved override removed',()=>pm.expect(pm.variables.replaceIn('{{$randomUUID}}')).match(/^[0-9a-f-]{36}$/i));`);
  override.requestId = crypto.randomUUID(); override.environment = [row('$randomUUID', 'saved-override')]; override.variables = override.environment;
  const recovered = await window.evaluate(input => window.apiManager.runScript(input), override);
  assert.equal(recovered.tests[0].passed, true, recovered.tests[0].error);
  const flight = payload(`pm.request.headers.upsert({key:'X-Script-Name',value:pm.variables.replaceIn('{{$randomFirstName}}')});pm.variables.set('sampledEmail',pm.variables.replaceIn('{{$randomEmail}}'));`);
  flight.requestId = crypto.randomUUID(); flight.request.method = 'POST';
  flight.request.url = `http://127.0.0.1:${network.address().port}/echo?id={{$randomUUID}}&name={{$randomFirstName}}`;
  flight.request.body = { mode: 'raw', language: 'json', raw: '{"id":"{{$randomUUID}}","email":"{{$randomEmail}}"}', fields: [] };
  const pre = await window.evaluate(input => window.apiManager.runScript(input), flight); assert.equal(pre.error, undefined);
  const response = await window.evaluate(input => window.apiManager.sendRequest(input), { requestId: flight.requestId, request: pre.request, variables: pre.variables, settings: { theme: 'dark', timeout: 3000, followRedirects: true, verifySsl: true, maxResponseMB: 20 } });
  const post = await window.evaluate(input => window.apiManager.runScript(input), {
    ...flight, stage: 'post-response', request: pre.request, response, environment: pre.environment, globals: pre.globals, collectionVariables: pre.collectionVariables, variables: pre.variables,
    script: `const echo=pm.response.json(), body=JSON.parse(echo.body), url=new URL(echo.url,'http://localhost');pm.test('script/native/post-response dynamic parity',()=>{pm.expect(body.id).equal(pm.variables.replaceIn('{{$randomUUID}}'));pm.expect(body.email).equal(pm.variables.get('sampledEmail'));pm.expect(url.searchParams.get('name')).equal(echo.headers['x-script-name']);pm.expect(echo.headers['x-script-name']).equal(pm.variables.replaceIn('{{$randomFirstName}}'));});`
  });
  assert.equal(post.error, undefined); assert.equal(post.tests[0].passed, true, post.tests[0].error);
  assert.equal(post.environment.some(item => item.key.startsWith('$random')), false); assert.equal(post.globals.some(item => item.key.startsWith('$random')), false);
  assert.equal(hits, 1);
  const started = Date.now(); const loop = await window.evaluate(input => window.apiManager.runScript(input), payload('while(true) {}'));
  assert.match(loop.error, /execution limit/); assert.ok(Date.now() - started < 6000);
  const cancelled = await window.evaluate(async input => { const pending = window.apiManager.runScript(input); await new Promise(resolve => setTimeout(resolve, 50)); await window.apiManager.cancelRequest(input.requestId); return pending; }, payload('await new Promise(resolve=>setTimeout(resolve,2000));'));
  assert.match(cancelled.error, /cancelled/);
  assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
});
