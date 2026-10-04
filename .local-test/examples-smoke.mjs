import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks, createRequire } from 'node:module';
import { once } from 'node:events';
import { createDemoServer, DEMO_TOKEN } from '../examples/mock-server.mjs';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { importData } = await import('../src/lib/import-export.ts');
const { initialWorkspace } = await import('../src/lib/model.ts');
const { requestVariables, effectiveAuth, createVariableResolver } = await import('../src/lib/variables.ts');
const require = createRequire(import.meta.url);
const { RequestEngine } = require('../electron/request.cjs');
const { acquireOAuth2Token } = require('../electron/auth.cjs');

const server = createDemoServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const engine = new RequestEngine();
try {
  const collection = importData(await readFile(new URL('../examples/Local Echo.postman_collection.json', import.meta.url), 'utf8')).collections[0];
  const env = importData(await readFile(new URL('../examples/Local.postman_environment.json', import.meta.url), 'utf8')).environments[0];
  env.variables.find(row => row.key === 'base_url').value = origin;
  const workspace = initialWorkspace(); workspace.collections = [collection]; workspace.environments = [env]; workspace.activeEnvironmentId = env.id;
  const requests = collection.folders.flatMap(folder => folder.requests); assert.equal(requests.length, 5);
  const send = request => engine.send({ request: { ...request, auth: effectiveAuth(workspace, request) }, variables: requestVariables(workspace, request), settings: workspace.settings, requestId: crypto.randomUUID() });
  const named = name => requests.find(request => request.name === name);
  const get = await send(named('GET echo')); assert.equal(get.status, 200); assert.deepEqual(JSON.parse(get.body).query.repeat, ['first', 'second']);
  const json = await send(named('Send JSON with dynamic values')); assert.equal(json.status, 200);
  const echoed = JSON.parse(json.body); assert.equal(echoed.json.requestId, echoed.headers['x-request-id']); assert.ok(Number.isInteger(echoed.json.created)); assert.ok(Math.abs(echoed.json.created - Math.floor(Date.now()/1000)) < 5);
  const next = JSON.parse((await send(named('Send JSON with dynamic values'))).body); assert.notEqual(next.json.requestId, echoed.json.requestId);
  const soapRequest = named('Send SOAP 1.2'); assert.deepEqual(soapRequest.soap, { version: '1.2', action: 'urn:api-manager:Echo' });
  const soap = await send(soapRequest); assert.equal(soap.status, 200); assert.match(soap.body, /<m:EchoResponse>/); assert.match(soap.body, /Hello from API Manager/);
  const token = await send(named('Get demo token')); assert.equal(token.status, 200); assert.equal(JSON.parse(token.body).access_token, DEMO_TOKEN);
  env.variables.find(row => row.key === 'demo_token').value = JSON.parse(token.body).access_token;
  const protectedResponse = await send(named('Echo with OAuth 2.0')); assert.equal(protectedResponse.status, 200); assert.equal(JSON.parse(protectedResponse.body).headers.authorization, `Bearer ${DEMO_TOKEN}`);
  const oauth = await acquireOAuth2Token(named('Echo with OAuth 2.0').auth, createVariableResolver(requestVariables(workspace, named('Echo with OAuth 2.0'))), workspace.settings); assert.equal(oauth.accessToken, DEMO_TOKEN);
  const unauthorized = await engine.send({ request: { ...named('GET echo'), url: origin + '/protected', params: [], auth: { type: 'none' } }, variables: [], settings: workspace.settings, requestId: crypto.randomUUID() }); assert.equal(unauthorized.status, 401);
  console.log(JSON.stringify({ import: '5 requests + Local environment', get: get.status, json: json.status, dynamicUuidMatchesHeader: true, freshUuidOnNextRun: true, soap: soap.status, soapDetected: soapRequest.soap, token: token.status, protected: protectedResponse.status, nativeOAuthHelper: oauth.tokenType, missingToken: unauthorized.status, boundAddress: server.address().address }, null, 2));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
