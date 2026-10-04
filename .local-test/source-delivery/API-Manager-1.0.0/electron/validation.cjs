'use strict';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
function string(value, label, max = 16 * 1024 * 1024) {
  if (typeof value !== 'string' || value.length > max) fail(`Invalid ${label}.`);
}
function identifier(value, label) { string(value, label, 256); if (!value) fail(`Missing ${label}.`); }
function number(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) fail(`Invalid ${label}.`);
}
function array(value, label, max = 100000) { if (!Array.isArray(value) || value.length > max) fail(`Invalid ${label}.`); }
function choice(value, values, label) { if (!values.includes(value)) fail(`Invalid ${label}.`); }
function keyValues(rows, label) {
  array(rows, label);
  for (const row of rows) {
    if (!isObject(row)) fail(`Invalid ${label} entry.`);
    identifier(row.id, `${label} entry ID`); string(row.key, `${label} key`); string(row.value, `${label} value`);
    if (typeof row.enabled !== 'boolean') fail(`Invalid ${label} enabled state.`);
    if (row.description !== undefined) string(row.description, `${label} description`);
    if (row.type !== undefined) choice(row.type, ['text', 'file'], `${label} field type`);
  }
}
function auth(value) {
  if (!isObject(value)) fail('Invalid request authorization.');
  choice(value.type, ['none', 'inherit', 'basic', 'bearer', 'apikey', 'digest', 'oauth1', 'oauth2', 'hawk', 'awsv4', 'ntlm', 'edgegrid', 'jwt', 'asap'], 'authorization type');
  for (const key of ['username', 'password', 'token', 'key', 'value']) if (value[key] !== undefined) string(value[key], `authorization ${key}`);
  if (value.in !== undefined) choice(value.in, ['header', 'query'], 'API key location');
  if (value.fields !== undefined) {
    if (!isObject(value.fields) || Object.keys(value.fields).length > 100) fail('Invalid authorization fields.');
    for (const [key, item] of Object.entries(value.fields)) { string(key, 'authorization field name', 256); string(item, 'authorization field value', 1024 * 1024); }
  }
}
function scripts(value) {
  if (!isObject(value)) fail('Invalid request scripts.');
  for (const key of ['preRequest', 'postResponse']) {
    string(value[key], `${key} script`, 1024 * 1024);
    if (Buffer.byteLength(value[key], 'utf8') > 1024 * 1024) fail('Script source must be 1 MB or smaller.');
  }
}
function scriptResults(value) {
  if (!isObject(value)) fail('Invalid script results.');
  array(value.tests, 'script tests', 1000); array(value.logs, 'script logs', 1000);
  for (const item of value.tests) {
    if (!isObject(item) || typeof item.passed !== 'boolean') fail('Invalid script test result.');
    string(item.name, 'script test name', 1000); if (item.error !== undefined) string(item.error, 'script test error', 10000);
  }
  for (const item of value.logs) {
    if (!isObject(item)) fail('Invalid script log.'); string(item.level, 'script log level', 32); string(item.message, 'script log message', 10000);
  }
  if (value.error !== undefined) string(value.error, 'script execution error', 10000);
}
function request(value) {
  if (!isObject(value)) fail('Invalid request.');
  identifier(value.id, 'request ID'); string(value.name, 'request name'); string(value.method, 'request method', 32);
  if (!/^[A-Za-z!#$%&'*+.^_`|~0-9-]{1,32}$/.test(value.method)) fail('Invalid HTTP method.');
  string(value.url, 'request URL'); string(value.description, 'request description');
  keyValues(value.params, 'query parameters'); keyValues(value.headers, 'request headers'); auth(value.auth);
  if (!isObject(value.body)) fail('Invalid request body.');
  choice(value.body.mode, ['none', 'raw', 'urlencoded', 'formdata', 'binary'], 'request body mode');
  choice(value.body.language, ['json', 'text', 'xml', 'html', 'javascript'], 'request body language');
  string(value.body.raw, 'request body'); keyValues(value.body.fields, 'body fields');
  if (value.body.filePath !== undefined) string(value.body.filePath, 'body file path', 32768);
  for (const key of ['collectionId', 'folderId']) if (value[key] !== undefined) identifier(value[key], key);
  if (value.soap !== undefined) {
    if (!isObject(value.soap)) fail('Invalid SOAP request metadata.');
    choice(value.soap.version, ['1.1', '1.2'], 'SOAP version'); string(value.soap.action, 'SOAP action');
  }
  if (value.scripts !== undefined) scripts(value.scripts);
  if (value.extra !== undefined && !isObject(value.extra)) fail('Invalid request import metadata.');
}
function response(value) {
  if (!isObject(value)) fail('Invalid response.');
  number(value.status, 'response status', 100, 599); string(value.statusText, 'response status text');
  string(value.body, 'response body', 150 * 1024 * 1024); string(value.url, 'response URL'); string(value.receivedAt, 'response timestamp');
  keyValues(value.headers, 'response headers'); number(value.duration, 'response duration', 0, Number.MAX_SAFE_INTEGER);
  number(value.size, 'response size', 0, Number.MAX_SAFE_INTEGER);
  for (const key of ['binary', 'truncated']) if (value[key] !== undefined && typeof value[key] !== 'boolean') fail(`Invalid response ${key} state.`);
}
function settings(value) {
  if (!isObject(value)) fail('Invalid settings.');
  choice(value.theme, ['dark', 'light'], 'theme'); number(value.timeout, 'request timeout', 0, 86400000);
  number(value.maxResponseMB, 'response size limit', 0.001, 100);
  for (const key of ['followRedirects', 'verifySsl']) if (typeof value[key] !== 'boolean') fail(`Invalid ${key} setting.`);
}
function folder(value, depth = 0) {
  if (!isObject(value) || depth > 32) fail('Invalid collection folder or nesting exceeds 32 levels.');
  identifier(value.id, 'folder ID'); string(value.name, 'folder name');
  array(value.folders, 'folders'); array(value.requests, 'folder requests');
  value.folders.forEach(item => folder(item, depth + 1)); value.requests.forEach(request);
  if (value.auth !== undefined) auth(value.auth); if (value.variables !== undefined) keyValues(value.variables, 'folder variables');
  if (value.scripts !== undefined) scripts(value.scripts);
  if (value.extra !== undefined && !isObject(value.extra)) fail('Invalid folder import metadata.');
}
function collection(value) {
  if (!isObject(value)) fail('Invalid collection.');
  identifier(value.id, 'collection ID'); string(value.name, 'collection name'); string(value.description, 'collection description');
  array(value.folders, 'collection folders'); array(value.requests, 'collection requests');
  value.folders.forEach(item => folder(item)); value.requests.forEach(request); keyValues(value.variables, 'collection variables'); auth(value.auth);
  if (value.scripts !== undefined) scripts(value.scripts);
  if (value.extra !== undefined && !isObject(value.extra)) fail('Invalid collection import metadata.');
}
function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) { if (ids.has(item.id)) fail(`Duplicate ${label} ID.`); ids.add(item.id); }
}
function validateWorkspace(value) {
  if (!isObject(value) || value.version !== 1) fail('Unsupported or invalid workspace version.');
  array(value.collections, 'collections'); value.collections.forEach(collection); uniqueIds(value.collections, 'collection');
  const folders = [], requests = [];
  const gather = items => { for (const item of items) { folders.push(item); requests.push(...item.requests); gather(item.folders); } };
  for (const item of value.collections) { requests.push(...item.requests); gather(item.folders); }
  uniqueIds(folders, 'folder'); uniqueIds(requests, 'saved request');
  array(value.environments, 'environments');
  for (const environment of value.environments) {
    if (!isObject(environment)) fail('Invalid environment.');
    identifier(environment.id, 'environment ID'); string(environment.name, 'environment name'); keyValues(environment.variables, 'environment variables');
  }
  uniqueIds(value.environments, 'environment'); keyValues(value.globals, 'global variables');
  if (value.activeEnvironmentId !== null) identifier(value.activeEnvironmentId, 'active environment ID');
  array(value.tabs, 'request tabs', 10000);
  for (const tab of value.tabs) {
    if (!isObject(tab)) fail('Invalid request tab.');
    identifier(tab.id, 'tab ID'); request(tab.request); if (tab.response !== undefined) response(tab.response);
    if (typeof tab.dirty !== 'boolean') fail('Invalid tab modified state.');
    string(tab.editorTab, 'editor tab', 100); string(tab.responseTab, 'response tab', 100);
    number(tab.responseZoom, 'response zoom', 8, 40);
    if (tab.scriptResults !== undefined) scriptResults(tab.scriptResults);
  }
  uniqueIds(value.tabs, 'tab'); string(value.activeTabId, 'active tab ID', 256);
  array(value.history, 'request history');
  for (const entry of value.history) {
    if (!isObject(entry)) fail('Invalid history entry.');
    identifier(entry.id, 'history ID'); request(entry.request); string(entry.timestamp, 'history timestamp');
    if (entry.response !== undefined) response(entry.response); if (entry.error !== undefined) string(entry.error, 'history error');
    if (entry.scriptResults !== undefined) scriptResults(entry.scriptResults);
  }
  settings(value.settings); choice(value.sidebarView, ['collections', 'environments', 'history'], 'sidebar view');
  number(value.sidebarWidth, 'sidebar width', 100, 1200);
  return value;
}
function validateSendPayload(value) {
  if (!isObject(value)) fail('Invalid request payload.');
  request(value.request); keyValues(value.variables, 'request variables'); settings(value.settings); identifier(value.requestId, 'running request ID');
  return value;
}
function validateScriptPayload(value) {
  if (!isObject(value)) fail('Invalid script execution payload.');
  string(value.script, 'script source', 1024 * 1024);
  if (Buffer.byteLength(value.script, 'utf8') > 1024 * 1024) fail('Script source must be 1 MB or smaller.');
  choice(value.stage, ['pre-request', 'post-response'], 'script stage'); request(value.request);
  if (value.response !== undefined) response(value.response);
  if (value.stage === 'post-response' && !value.response) fail('Post-response scripts require a response.');
  for (const key of ['environment', 'globals', 'collectionVariables', 'variables']) keyValues(value[key], `script ${key}`);
  if (value.folderVariables !== undefined) keyValues(value.folderVariables, 'script folderVariables');
  if (value.requestId !== undefined) identifier(value.requestId, 'script request ID');
  return value;
}
function validateScriptResult(value) {
  if (!isObject(value)) fail('Invalid script execution result.');
  request(value.request); scriptResults(value);
  for (const key of ['environment', 'globals', 'collectionVariables', 'variables']) keyValues(value[key], `script ${key}`);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 32 * 1024 * 1024) fail('Script result exceeds the 32 MB limit.');
  return value;
}
function validateOAuthPayload(value, variables, options) { auth(value); keyValues(variables, 'OAuth variables'); settings(options); }

module.exports = { validateWorkspace, validateSendPayload, validateScriptPayload, validateScriptResult, validateOAuthPayload, identifier, string };
