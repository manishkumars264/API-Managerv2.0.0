import type { ApiCollection, ApiFolder, ApiRequest, Environment, KeyValue, RequestAuth, RequestScripts, RequestTab, Workspace } from '../types';
import { initialWorkspace, newRequest, newTab, uid } from './model';
import { detectSoap, parseCurl, soapHeaders } from './curl';

export interface ImportResult {
  collections: ApiCollection[];
  environments: Environment[];
  globals?: KeyValue[];
  tabs?: RequestTab[];
  workspace?: Workspace;
  warnings: string[];
}

type JsonObject = Record<string, unknown>;
const schema = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
const authTypes = ['none', 'inherit', 'basic', 'bearer', 'apikey', 'digest', 'oauth1', 'oauth2', 'hawk', 'awsv4', 'ntlm', 'edgegrid', 'jwt', 'asap'];
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const isObject = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => value === null || value === undefined ? '' : typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
const description = (value: unknown): string => isObject(value) ? string(value.content) : string(value);
function omit(source: JsonObject, keys: string[]): JsonObject { return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key))); }
const metadata = (extra: JsonObject | undefined) => object(extra?.postman);

function readRows(value: unknown, warnings: string[], kind: 'variable' | 'field' = 'field'): KeyValue[] {
  if (value !== undefined && !Array.isArray(value)) throw new Error('Postman variables and fields must be arrays.');
  return list(value).flatMap((entry): KeyValue[] => {
    if (!isObject(entry)) throw new Error('Postman variables and fields must be objects with key/value properties.');
    const key = string(entry.key ?? entry.name);
    if (kind === 'variable' && !key) warnings.push('A variable with an empty name was retained but is ignored during substitution.');
    const imported: KeyValue = {
      id: uid(), key, value: string(entry.value), enabled: entry.disabled !== true && entry.enabled !== false,
      ...(entry.description === undefined ? {} : { description: description(entry.description) }),
      ...(entry.type === 'file' || entry.type === 'text' ? { type: entry.type } : {}),
      ...(typeof entry.contentType === 'string' ? { contentType: entry.contentType } : {}),
      ...(typeof entry.fileName === 'string' ? { fileName: entry.fileName } : {}),
      extra: { postman: omit(entry, ['key', 'name', 'value', 'disabled', 'enabled', 'type', 'description', 'src', 'contentType', 'fileName']),
        ...(entry.type === undefined ? {} : { postmanType: entry.type }),
        ...(entry.description === undefined ? {} : { postmanDescription: entry.description }),
      },
    };
    if (entry.type === 'file') {
      const paths = Array.isArray(entry.src) ? entry.src : [entry.src ?? entry.value ?? ''];
      if (paths.length > 1) warnings.push('Multiple files in a Postman form field were expanded into repeated fields with the same name.');
      return paths.map(path => ({ ...imported, id: uid(), value: string(path) }));
    }
    return [imported];
  });
}

function readAuth(value: unknown, warnings: string[], inherited = true): RequestAuth {
  if (!isObject(value)) return { type: inherited ? 'inherit' : 'none' };
  const type = string(value.type);
  const fields = isObject(value[type]) ? Object.fromEntries(Object.entries(value[type]).map(([key, entry]) => [key, string(entry)]))
    : Object.fromEntries(list(value[type]).map(attribute => [string(object(attribute).key), string(object(attribute).value)]));
  if (type === 'noauth') return { type: 'none' };
  if (type === 'basic') return { type: 'basic', username: fields.username ?? '', password: fields.password ?? '' };
  if (type === 'bearer') return { type: 'bearer', token: fields.token ?? '' };
  if (type === 'apikey') return { type: 'apikey', key: fields.key ?? '', value: fields.value ?? '', in: fields.in === 'query' ? 'query' : 'header' };
  if (authTypes.includes(type) && type !== 'none' && type !== 'inherit') return { type: type as RequestAuth['type'], fields };
  warnings.push(`Authentication type "${type || 'unknown'}" is retained for export but is not executed. Choose a supported authentication type before sending.`);
  return { type: 'none' };
}

function warnMetadata(value: JsonObject, warnings: string[]): void {
  if (value.protocolProfileBehavior) warnings.push('Postman protocol profile settings are retained for export; requests use API Manager settings.');
  if (value.proxy || value.certificate) warnings.push('Per-request proxy and certificate configuration is retained for export but is not applied.');
}

function readScripts(events: unknown, warnings: string[]): RequestScripts | undefined {
  const scripts: RequestScripts = { preRequest: '', postResponse: '' };
  for (const value of list(events)) {
    const event = object(value), script = object(event.script), listen = string(event.listen);
    if (!['prerequest', 'test'].includes(listen)) { warnings.push(`Postman event "${listen}" is retained for export but is not executed.`); continue; }
    if (event.disabled === true || script.disabled === true) { warnings.push('Disabled Postman scripts are retained for export and skipped.'); continue; }
    if (script.type && !['text/javascript', 'application/javascript'].includes(string(script.type))) { warnings.push(`Script language "${string(script.type)}" is retained for export but is not executed.`); continue; }
    const code = Array.isArray(script.exec) ? script.exec.map(string).join('\n') : string(script.exec);
    const key = listen === 'prerequest' ? 'preRequest' : 'postResponse';
    scripts[key] += `${scripts[key] && code ? '\n' : ''}${code}`;
  }
  return scripts.preRequest || scripts.postResponse ? scripts : undefined;
}

function writeEvents(scripts: RequestScripts | undefined, events: unknown): unknown {
  if (!scripts) return events;
  const result: JsonObject[] = [], written = new Set<string>();
  const scriptFor = (listen: string) => listen === 'prerequest' ? scripts.preRequest : scripts.postResponse;
  for (const value of list(events)) {
    const event = object(value), script = object(event.script), listen = string(event.listen);
    if (!['prerequest', 'test'].includes(listen) || event.disabled === true || script.disabled === true || (script.type && !['text/javascript', 'application/javascript'].includes(string(script.type)))) { result.push(event); continue; }
    if (written.has(listen)) continue;
    written.add(listen);
    const code = scriptFor(listen);
    if (code) result.push({ ...event, script: { ...script, type: 'text/javascript', exec: code.split('\n') } });
  }
  for (const listen of ['prerequest', 'test']) if (!written.has(listen) && scriptFor(listen)) result.push({ listen, script: { type: 'text/javascript', exec: scriptFor(listen).split('\n') } });
  return result.length ? result : undefined;
}

function readHeaders(value: unknown, warnings: string[]): KeyValue[] {
  if (typeof value === 'string') return value.split(/\r?\n/).filter(Boolean).map(line => {
    const colon = line.indexOf(':');
    if (colon < 1) throw new Error(`Invalid Postman header: ${line}`);
    return { id: uid(), key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim(), enabled: true };
  });
  return readRows(value, warnings);
}

function readUrl(value: unknown, warnings: string[]): { url: string; params: KeyValue[] } {
  if (typeof value === 'string') return { url: value, params: [] };
  const source = object(value);
  let url = string(source.raw);
  if (!url) {
    const host = Array.isArray(source.host) ? source.host.map(string).join('.') : string(source.host);
    const path = Array.isArray(source.path) ? source.path.map(segment => string(isObject(segment) ? segment.value : segment)).join('/') : string(source.path);
    url = `${source.protocol ? `${string(source.protocol)}://` : ''}${host}${source.port ? `:${string(source.port)}` : ''}${path ? `/${path.replace(/^\//, '')}` : ''}${source.hash ? `#${string(source.hash)}` : ''}`;
  }
  if (list(source.variable).length) warnings.push('Postman path variables are retained for export. Replace :name path segments with {{name}} and set the variable in a collection or environment before sending.');
  const params = readRows(source.query, warnings);
  if (Array.isArray(source.query)) {
    const hash = url.indexOf('#'), fragment = hash >= 0 ? url.slice(hash) : source.hash ? `#${string(source.hash)}` : '';
    const base = hash >= 0 ? url.slice(0, hash) : url;
    url = base.split('?')[0] + fragment;
  }
  return { url, params };
}

function readBody(value: unknown, warnings: string[]): ApiRequest['body'] {
  const source = object(value);
  const body: ApiRequest['body'] = { mode: 'none', raw: '', language: 'json', fields: [] };
  if (source.disabled === true) { warnings.push('A disabled Postman request body was retained for export and will not be sent.'); return body; }
  switch (source.mode) {
    case undefined: return body;
    case 'raw': {
      const language = string(object(object(source.options).raw).language) || 'text';
      const supported = ['json', 'text', 'xml', 'html', 'javascript'];
      if (!supported.includes(language)) warnings.push(`Raw body language "${language}" is displayed as plain text; original metadata is retained for export.`);
      return { ...body, mode: 'raw', raw: string(source.raw), language: supported.includes(language) ? language as ApiRequest['body']['language'] : 'text' };
    }
    case 'urlencoded': return { ...body, mode: 'urlencoded', fields: readRows(source.urlencoded, warnings) };
    case 'formdata': return { ...body, mode: 'formdata', fields: readRows(source.formdata, warnings) };
    case 'file': return { ...body, mode: 'binary', filePath: string(object(source.file).src) };
    case 'graphql': {
      const graph = object(source.graphql);
      let variables: unknown = {};
      try { variables = typeof graph.variables === 'string' ? JSON.parse(graph.variables || '{}') : graph.variables ?? {}; }
      catch { warnings.push('Invalid GraphQL variables were retained as text. Correct the raw JSON body before sending.'); variables = graph.variables; }
      warnings.push('GraphQL bodies are converted to raw JSON; GraphQL editor metadata is retained for export.');
      return { ...body, mode: 'raw', raw: JSON.stringify({ query: string(graph.query), variables }, null, 2), language: 'json' };
    }
    default: warnings.push(`Body mode "${string(source.mode)}" is retained for export but is not sent. Choose a supported body mode before sending.`); return body;
  }
}

function readRequest(item: JsonObject, collectionId: string, folderId: string | undefined, warnings: string[]): ApiRequest {
  const source = typeof item.request === 'string' ? { url: item.request } : object(item.request);
  if (item.request === undefined) throw new Error(`Collection item "${string(item.name)}" contains neither a request nor a folder.`);
  const request = newRequest(string(item.name) || 'Untitled request');
  const parsedUrl = readUrl(source.url, warnings);
  const method = string(source.method) || 'GET';
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,32}$/.test(method)) throw new Error(`Invalid request method in "${request.name}". Use an HTTP token of at most 32 characters.`);
  warnMetadata(item, warnings); warnMetadata(source, warnings);
  const body = readBody(source.body, warnings);
  return detectSoap({ ...request, method: method.toUpperCase(), ...parsedUrl, headers: readHeaders(source.header, warnings), body,
    auth: readAuth(source.auth, warnings), scripts: readScripts(item.event, warnings), description: description(source.description ?? item.description), collectionId, folderId,
    extra: { postman: {
      item: omit(item, ['name', 'request']), request: omit(source, ['method', 'url', 'header', 'body', 'auth', 'description']),
      url: typeof source.url === 'object' ? source.url : undefined, body: source.body, auth: source.auth, description: source.description,
    } },
  });
}

function readItems(value: unknown, collectionId: string, warnings: string[], folderId?: string, depth = 0): { folders: ApiFolder[]; requests: ApiRequest[]; order: string[] } {
  if (depth > 32) throw new Error('Collection folder nesting exceeds the supported depth (32).');
  if (!Array.isArray(value)) throw new Error('A Postman collection or folder must contain an item array.');
  const folders: ApiFolder[] = [], requests: ApiRequest[] = [], order: string[] = [];
  for (const entry of value) {
    if (!isObject(entry)) throw new Error('Each Postman collection item must be an object.');
    if (Array.isArray(entry.item)) {
      const id = uid(), nested = readItems(entry.item, collectionId, warnings, id, depth + 1);
      warnMetadata(entry, warnings);
      const folder: ApiFolder = { id, name: string(entry.name) || 'Untitled folder', folders: nested.folders, requests: nested.requests,
        auth: readAuth(entry.auth, warnings), variables: readRows(entry.variable, warnings, 'variable'), scripts: readScripts(entry.event, warnings),
        extra: { postman: { folder: omit(entry, ['name', 'item', 'auth', 'variable']), auth: entry.auth, order: nested.order } },
      };
      folders.push(folder); order.push(id);
    } else {
      const request = readRequest(entry, collectionId, folderId, warnings);
      requests.push(request); order.push(request.id);
    }
  }
  return { folders, requests, order };
}

function readCollection(source: JsonObject, warnings: string[]): ApiCollection {
  const info = object(source.info), sourceSchema = string(info.schema);
  if (sourceSchema && !/\/v2\.(?:0|1)(?:\.0)?\/collection\.json(?:[?#].*)?$/.test(sourceSchema)) throw new Error('Only Postman collection versions 2.0 and 2.1 are supported. Export the collection as v2.1 and import it again.');
  const id = uid(), nested = readItems(source.item, id, warnings);
  warnMetadata(source, warnings);
  return { id, name: string(info.name) || 'Imported collection', description: description(info.description), folders: nested.folders,
    requests: nested.requests, variables: readRows(source.variable, warnings, 'variable'), auth: readAuth(source.auth, warnings, false), scripts: readScripts(source.event, warnings),
    extra: { postman: { collection: omit(source, ['info', 'item', 'variable', 'auth']), info: omit(info, ['name', 'description', 'schema']),
      description: info.description, auth: source.auth, order: nested.order } },
  };
}

function validateWorkspace(source: JsonObject, label = 'API Manager workspace backup'): Workspace {
  const fail = (path: string): never => { throw new Error(`Invalid ${label}: ${path}.`); };
  const assert = (condition: unknown, path: string): void => { if (!condition) fail(path); };
  const stringAt = (value: unknown, path: string, max = 16 * 1024 * 1024) => assert(typeof value === 'string' && value.length <= max, `${path} must be text with at most ${max} characters`);
  const arrayAt = (value: unknown, path: string, max = 100000) => assert(Array.isArray(value) && value.length <= max, `${path} must be an array with at most ${max} entries`);
  const ids = new Set<string>();
  const identifier = (value: unknown, path: string) => { stringAt(value, path, 256); assert(!!value, `${path} must be a non-empty identifier`); };
  const uniqueId = (value: unknown, path: string) => { identifier(value, path); assert(!ids.has(value as string), `${path} must be a unique identifier`); ids.add(value as string); };
  const rows = (value: unknown, path: string) => { arrayAt(value, path); for (const [i, entry] of list(value).entries()) {
    assert(isObject(entry), `${path}[${i}] must be an object`); const v = object(entry);
    identifier(v.id, `${path}[${i}].id`); stringAt(v.key, `${path}[${i}].key`); stringAt(v.value, `${path}[${i}].value`); assert(typeof v.enabled === 'boolean', `${path}[${i}].enabled must be boolean`);
    if (v.description !== undefined) stringAt(v.description, `${path}[${i}].description`);
    if (v.type !== undefined) assert(['text', 'file'].includes(string(v.type)), `${path}[${i}].type must be text or file`);
  } };
  const auth = (value: unknown, path: string) => { assert(isObject(value) && authTypes.includes(string(object(value).type)), `${path} has an unsupported authentication type`);
    const a = object(value); for (const key of ['username', 'password', 'token', 'key', 'value']) if (a[key] !== undefined) stringAt(a[key], `${path}.${key}`);
    if (a.in !== undefined) assert(['header', 'query'].includes(string(a.in)), `${path}.in must be header or query`);
    if (a.fields !== undefined) {
      assert(isObject(a.fields) && Object.keys(object(a.fields)).length <= 100, `${path}.fields must be an object with at most 100 entries`);
      for (const [key, entry] of Object.entries(object(a.fields))) { stringAt(key, `${path}.fields name`, 256); stringAt(entry, `${path}.fields.${key}`, 1024 * 1024); }
    }
  };
  const scripts = (value: unknown, path: string) => {
    if (value === undefined) return;
    assert(isObject(value), `${path} must be an object`);
    const s = object(value);
    for (const key of ['preRequest', 'postResponse']) {
      stringAt(s[key], `${path}.${key}`, 1024 * 1024);
      assert(new TextEncoder().encode(s[key] as string).length <= 1024 * 1024, `${path}.${key} source must be 1 MB or smaller`);
    }
  };
  const scriptResults = (value: unknown, path: string) => {
    if (value === undefined) return;
    assert(isObject(value), `${path} must be an object`); const results = object(value);
    arrayAt(results.tests, `${path}.tests`, 1000); arrayAt(results.logs, `${path}.logs`, 1000);
    for (const [i, entry] of list(results.tests).entries()) {
      assert(isObject(entry), `${path}.tests[${i}] must be an object`); const test = object(entry);
      assert(typeof test.passed === 'boolean', `${path}.tests[${i}].passed must be boolean`);
      stringAt(test.name, `${path}.tests[${i}].name`, 1000);
      if (test.error !== undefined) stringAt(test.error, `${path}.tests[${i}].error`, 10000);
    }
    for (const [i, entry] of list(results.logs).entries()) {
      assert(isObject(entry), `${path}.logs[${i}] must be an object`); const log = object(entry);
      stringAt(log.level, `${path}.logs[${i}].level`, 32); stringAt(log.message, `${path}.logs[${i}].message`, 10000);
    }
    if (results.error !== undefined) stringAt(results.error, `${path}.error`, 10000);
  };
  const request = (value: unknown, path: string, unique = true) => {
    assert(isObject(value), `${path} must be an object`); const r = object(value);
    if (unique) uniqueId(r.id, `${path}.id`); else identifier(r.id, `${path}.id`);
    for (const key of ['name', 'method', 'url', 'description']) stringAt(r[key], `${path}.${key}`);
    assert(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,32}$/.test(string(r.method)), `${path}.method must be a valid HTTP token`);
    rows(r.params, `${path}.params`); rows(r.headers, `${path}.headers`); auth(r.auth, `${path}.auth`);
    assert(isObject(r.body), `${path}.body must be an object`); const b = object(r.body);
    assert(['none', 'raw', 'urlencoded', 'formdata', 'binary'].includes(string(b.mode)), `${path}.body.mode is unsupported`);
    assert(['json', 'text', 'xml', 'html', 'javascript'].includes(string(b.language)), `${path}.body.language is unsupported`); stringAt(b.raw, `${path}.body.raw`); rows(b.fields, `${path}.body.fields`);
    if (b.filePath !== undefined) stringAt(b.filePath, `${path}.body.filePath`, 32768);
    for (const key of ['collectionId', 'folderId']) if (r[key] !== undefined) identifier(r[key], `${path}.${key}`);
    if (r.extra !== undefined) assert(isObject(r.extra), `${path}.extra must be an object`);
    scripts(r.scripts, `${path}.scripts`);
    if (r.soap !== undefined) {
      assert(isObject(r.soap), `${path}.soap must be an object`);
      const soap = object(r.soap);
      assert(['1.1', '1.2'].includes(string(soap.version)), `${path}.soap.version must be 1.1 or 1.2`);
      stringAt(soap.action, `${path}.soap.action`);
    }
  };
  const folders = (value: unknown, path: string, depth = 0) => {
    arrayAt(value, path);
    assert(depth <= 32 || !list(value).length, `${path} must be an array with at most 32 folder levels`);
    for (const [i, entry] of list(value).entries()) { const f = object(entry), p = `${path}[${i}]`; uniqueId(f.id, `${p}.id`); stringAt(f.name, `${p}.name`);
      arrayAt(f.requests, `${p}.requests`); list(f.requests).forEach((r, j) => request(r, `${p}.requests[${j}]`));
      folders(f.folders, `${p}.folders`, depth + 1); if (f.variables !== undefined) rows(f.variables, `${p}.variables`); if (f.auth !== undefined) auth(f.auth, `${p}.auth`); scripts(f.scripts, `${p}.scripts`);
      if (f.extra !== undefined) assert(isObject(f.extra), `${p}.extra must be an object`);
    }
  };
  assert(source.version === 1, 'unsupported version');
  arrayAt(source.collections, 'collections');
  for (const [i, entry] of list(source.collections).entries()) {
    const c = object(entry), path = `collections[${i}]`; uniqueId(c.id, `${path}.id`); stringAt(c.name, `${path}.name`); stringAt(c.description, `${path}.description`);
    rows(c.variables, `${path}.variables`); auth(c.auth, `${path}.auth`); folders(c.folders, `${path}.folders`); scripts(c.scripts, `${path}.scripts`);
    arrayAt(c.requests, `${path}.requests`); list(c.requests).forEach((r, j) => request(r, `${path}.requests[${j}]`));
    if (c.extra !== undefined) assert(isObject(c.extra), `${path}.extra must be an object`);
  }
  arrayAt(source.environments, 'environments');
  for (const [i, entry] of list(source.environments).entries()) { const e = object(entry); uniqueId(e.id, `environments[${i}].id`); stringAt(e.name, `environments[${i}].name`); rows(e.variables, `environments[${i}].variables`); }
  rows(source.globals, 'globals');
  assert(source.activeEnvironmentId === null || typeof source.activeEnvironmentId === 'string', 'activeEnvironmentId must be text or null');
  assert(source.activeEnvironmentId === null || list(source.environments).some(e => object(e).id === source.activeEnvironmentId), 'the active environment does not exist');
  arrayAt(source.tabs, 'tabs', 10000); assert(list(source.tabs).length > 0, 'tabs must be a non-empty array');
  const response = (value: unknown, path: string) => { const r = object(value); assert(isObject(value), `${path} must be an object`); for (const key of ['body', 'statusText', 'url', 'receivedAt']) stringAt(r[key], `${path}.${key}`, key === 'body' ? 150 * 1024 * 1024 : undefined); rows(r.headers, `${path}.headers`); for (const key of ['status', 'duration', 'size']) assert(typeof r[key] === 'number' && Number.isFinite(r[key]), `${path}.${key} must be a finite number`);
    assert(Number.isInteger(r.status) && Number(r.status) >= 100 && Number(r.status) <= 599, `${path}.status must be an HTTP status (100–599)`);
    assert(Number(r.duration) >= 0 && Number(r.size) >= 0 && Number(r.duration) <= Number.MAX_SAFE_INTEGER && Number(r.size) <= Number.MAX_SAFE_INTEGER, `${path}.duration and size must be non-negative safe numbers`);
    for (const key of ['binary', 'truncated']) if (r[key] !== undefined) assert(typeof r[key] === 'boolean', `${path}.${key} must be boolean`);
  };
  for (const [i, entry] of list(source.tabs).entries()) { const t = object(entry), path = `tabs[${i}]`; uniqueId(t.id, `${path}.id`); request(t.request, `${path}.request`, false);
    stringAt(t.editorTab, `${path}.editorTab`, 100); stringAt(t.responseTab, `${path}.responseTab`, 100); assert(typeof t.dirty === 'boolean', `${path}.dirty must be boolean`); assert(typeof t.responseZoom === 'number' && Number.isFinite(t.responseZoom) && t.responseZoom >= 8 && t.responseZoom <= 40, `${path}.responseZoom must be between 8 and 40`); if (t.response !== undefined) response(t.response, `${path}.response`);
    scriptResults(t.scriptResults, `${path}.scriptResults`);
  }
  assert(list(source.tabs).some(tab => object(tab).id === source.activeTabId), 'the active tab does not exist');
  arrayAt(source.history, 'history');
  for (const [i, entry] of list(source.history).entries()) { const h = object(entry), path = `history[${i}]`; identifier(h.id, `${path}.id`); stringAt(h.timestamp, `${path}.timestamp`); request(h.request, `${path}.request`, false); if (h.response !== undefined) response(h.response, `${path}.response`); if (h.error !== undefined) stringAt(h.error, `${path}.error`); scriptResults(h.scriptResults, `${path}.scriptResults`); }
  const settings = object(source.settings); assert(['dark', 'light'].includes(string(settings.theme)), 'settings.theme is unsupported');
  assert(typeof settings.timeout === 'number' && settings.timeout >= 0 && settings.timeout <= 86400000 && Number.isFinite(settings.timeout), 'settings.timeout must be between 0 and 86400000');
  assert(typeof settings.maxResponseMB === 'number' && settings.maxResponseMB >= 0.001 && settings.maxResponseMB <= 100 && Number.isFinite(settings.maxResponseMB), 'settings.maxResponseMB must be between 0.001 and 100');
  assert(typeof settings.followRedirects === 'boolean' && typeof settings.verifySsl === 'boolean', 'request settings must be boolean');
  assert(['collections', 'environments', 'history'].includes(string(source.sidebarView)), 'sidebarView is unsupported');
  assert(typeof source.sidebarWidth === 'number' && Number.isFinite(source.sidebarWidth) && source.sidebarWidth >= 100 && source.sidebarWidth <= 1200, 'sidebarWidth must be between 100 and 1200');
  return source as unknown as Workspace;
}

/** Converted Postman/cURL input must satisfy storage limits before changing the UI. */
function validateImportedData(result: ImportResult): ImportResult {
  const workspace = initialWorkspace();
  workspace.collections = result.collections; workspace.environments = result.environments; workspace.globals = result.globals ?? [];
  if (result.tabs?.length) { workspace.tabs = result.tabs; workspace.activeTabId = result.tabs[0].id; }
  validateWorkspace(workspace as unknown as JsonObject, 'imported data');
  return result;
}

export function importData(text: string, name = 'Imported file'): ImportResult {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error('The import is empty. Choose a collection, environment, workspace backup, or cURL command.');
  const result: ImportResult = { collections: [], environments: [], warnings: [] };
  if (/^curl(?:\.exe)?(?:\s|$)/i.test(trimmed)) {
    const request = parseCurl(trimmed);
    result.tabs = [{ ...newTab(request), dirty: true }]; result.warnings.push(...list(request.extra?.curlWarnings).map(string)); return validateImportedData(result);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); }
  catch { throw new Error('Invalid JSON. Import a Postman v2/v2.1 collection, environment, API Manager backup, or one cURL command.'); }
  if (!isObject(parsed)) throw new Error('The imported JSON must be a collection, environment, globals file, or API Manager workspace object.');
  const source = parsed;
  if ((source.version !== undefined && Array.isArray(source.collections)) || (source.format === 'api-manager' && source.workspace)) {
    const workspace = validateWorkspace(source.workspace ? object(source.workspace) : source);
    return { collections: workspace.collections, environments: workspace.environments, globals: workspace.globals, tabs: workspace.tabs, workspace, warnings: [] };
  }
  if (Array.isArray(source.item) && isObject(source.info)) result.collections.push(readCollection(source, result.warnings));
  else if (Array.isArray(source.values)) {
    const variables = readRows(source.values, result.warnings, 'variable');
    if (source._postman_variable_scope === 'globals') result.globals = variables;
    else if (!source._postman_variable_scope || source._postman_variable_scope === 'environment') result.environments.push({ id: uid(), name: string(source.name) || name.replace(/\.json$/i, ''), variables,
      extra: { postman: omit(source, ['id', 'name', 'values', '_postman_variable_scope']) },
    });
    else throw new Error(`Unsupported Postman variable scope: ${string(source._postman_variable_scope)}.`);
  } else throw new Error('Unrecognized import format. Supported formats: Postman collection v2/v2.1, environments, globals, API Manager workspace backups, and cURL.');
  result.warnings = [...new Set(result.warnings)];
  return validateImportedData(result);
}

function writeDescription(text: string, original: unknown): unknown { return isObject(original) ? { ...original, content: text } : text; }

function writeRows(rows: KeyValue[], kind: 'variable' | 'field' = 'field'): JsonObject[] {
  return rows.map(row => {
    const preserved = object(row.extra?.postman), originalType = row.extra?.postmanType;
    const result: JsonObject = { ...preserved, key: row.key, value: row.value, disabled: !row.enabled };
    if (row.description !== undefined) result.description = writeDescription(row.description, row.extra?.postmanDescription);
    if (kind === 'variable') result.type = originalType ?? 'default';
    else if (row.type !== undefined || originalType !== undefined) result.type = row.type ?? originalType;
    if (row.type === 'file') { result.src = row.value; delete result.value; }
    if (row.contentType !== undefined) result.contentType = row.contentType;
    if (row.fileName !== undefined) result.fileName = row.fileName;
    return result;
  });
}

function writeAuth(auth: RequestAuth | undefined, original: unknown): unknown {
  if (!auth || auth.type === 'inherit') return undefined;
  // Collection v2.0 uses objects while v2.1 uses auth attribute arrays.
  const source = { ...object(original) };
  for (const type of ['basic', 'bearer', 'apikey', 'digest', 'oauth1', 'oauth2', 'awsv4', 'hawk', 'ntlm', 'edgegrid']) {
    if (isObject(source[type])) source[type] = Object.entries(source[type]).map(([key, value]) => ({ key, value, type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string' }));
  }
  const originalType = string(source.type);
  if (auth.type === 'none') return originalType && originalType !== 'noauth' && !authTypes.includes(originalType) ? source : { type: 'noauth' };
  const values: Record<string, string> = auth.type === 'basic' ? { username: auth.username ?? '', password: auth.password ?? '' }
    : auth.type === 'bearer' ? { token: auth.token ?? '' } : auth.type === 'apikey' ? { key: auth.key ?? '', value: auth.value ?? '', in: auth.in ?? 'header' } : { ...auth.fields };
  const existing = originalType === auth.type ? list(source[auth.type]).map(object) : [];
  const fields = Object.entries(values).map(([key, value]) => { const old = existing.find(field => field.key === key); return { ...old, key, value: old && string(old.value) === value ? old.value : value, type: old?.type ?? 'string' }; });
  for (const field of existing) if (!Object.hasOwn(values, string(field.key))) fields.push(field as { key: string; value: string; type: string });
  return { ...(originalType === auth.type ? source : {}), type: auth.type, [auth.type]: fields };
}

function writeUrl(request: ApiRequest, original: unknown): unknown {
  const source = object(original);
  if (!Object.keys(source).length && !request.params.length) return request.url;
  const hash = request.url.indexOf('#'), fragment = hash < 0 ? '' : request.url.slice(hash), base = hash < 0 ? request.url : request.url.slice(0, hash);
  const queryIndex = base.indexOf('?'), replaced = new Set(request.params.filter(p => p.enabled && p.key).map(p => p.key));
  const inlineRows: KeyValue[] = [...new URLSearchParams(queryIndex < 0 ? '' : base.slice(queryIndex + 1))].filter(([key]) => !replaced.has(key)).map(([key, value]) => ({ id: uid(), key, value, enabled: true }));
  const rows = [...inlineRows, ...request.params];
  const query = rows.filter(p => p.enabled && p.key).map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  const raw = `${queryIndex < 0 ? base : base.slice(0, queryIndex)}${query ? `?${query}` : ''}${fragment}`;
  // Keep structured fields consistent with edits rather than retaining a stale host/path.
  const match = request.url.match(/^([A-Za-z][\w+.-]*):\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/);
  const fields: JsonObject = { ...omit(source, ['raw', 'query', 'protocol', 'host', 'port', 'path', 'hash']), raw, query: writeRows(rows) };
  if (match) {
    fields.protocol = match[1];
    const authority = match[2], port = authority.match(/:(\d+)$/);
    fields.host = port ? authority.slice(0, -port[0].length) : authority;
    if (port) fields.port = port[1];
    fields.path = match[3].replace(/^\//, '').split('/');
    if (match[4]) fields.hash = match[4];
  }
  return fields;
}

function writeBody(body: ApiRequest['body'], original: unknown): unknown {
  const source = object(original);
  if (body.mode === 'none') return Object.keys(source).length && (source.disabled === true || !['raw', 'urlencoded', 'formdata', 'file'].includes(string(source.mode))) ? source : undefined;
  const retained = omit(source, ['mode', 'raw', 'urlencoded', 'formdata', 'file', 'disabled']);
  if (body.mode === 'raw') return { ...retained, mode: 'raw', raw: body.raw,
    options: { ...object(retained.options), raw: { ...object(object(retained.options).raw), language: body.language } },
  };
  if (body.mode === 'binary') return { ...retained, mode: 'file', file: { ...object(source.file), src: body.filePath ?? '' } };
  return { ...retained, mode: body.mode, [body.mode === 'urlencoded' ? 'urlencoded' : 'formdata']: writeRows(body.fields) };
}

function writeRequest(request: ApiRequest): JsonObject {
  const meta = metadata(request.extra), source = object(meta.request);
  const item = object(meta.item);
  return { ...item, name: request.name, event: writeEvents(request.scripts, item.event), request: { ...source, method: request.method,
    header: writeRows(soapHeaders(request)), url: writeUrl(request, meta.url), body: writeBody(request.soap ? { ...request.body, language: 'xml' } : request.body, meta.body),
    auth: writeAuth(request.auth, meta.auth), description: writeDescription(request.description, meta.description),
  } };
}

function writeItems(folders: ApiFolder[], requests: ApiRequest[], order: unknown): JsonObject[] {
  const children = new Map<string, JsonObject>();
  for (const folder of folders) {
    const meta = metadata(folder.extra);
    const preserved = object(meta.folder);
    children.set(folder.id, { ...preserved, name: folder.name, event: writeEvents(folder.scripts, preserved.event), auth: writeAuth(folder.auth, meta.auth), variable: writeRows(folder.variables ?? [], 'variable'), item: writeItems(folder.folders, folder.requests, meta.order) });
  }
  for (const request of requests) children.set(request.id, writeRequest(request));
  const result: JsonObject[] = [];
  for (const id of list(order)) { const child = children.get(string(id)); if (child) { result.push(child); children.delete(string(id)); } }
  result.push(...children.values());
  return result;
}

export function exportCollection(collection: ApiCollection): string {
  const meta = metadata(collection.extra);
  const preserved = object(meta.collection);
  return JSON.stringify({ ...preserved, event: writeEvents(collection.scripts, preserved.event), info: { ...object(meta.info), _postman_id: object(meta.info)._postman_id ?? collection.id,
    name: collection.name, description: writeDescription(collection.description, meta.description), schema,
  }, item: writeItems(collection.folders, collection.requests, meta.order), variable: writeRows(collection.variables, 'variable'), auth: writeAuth(collection.auth, meta.auth) }, null, 2);
}

export function exportEnvironment(environment: Environment): string {
  return JSON.stringify({ ...object(environment.extra?.postman), id: environment.id, name: environment.name,
    values: writeRows(environment.variables, 'variable'), _postman_variable_scope: 'environment', _postman_exported_at: new Date().toISOString(), _postman_exported_using: 'API Manager/1.0.0',
  }, null, 2);
}

export function exportGlobals(globals: KeyValue[]): string {
  return JSON.stringify({ name: 'Globals', values: writeRows(globals, 'variable'), _postman_variable_scope: 'globals', _postman_exported_at: new Date().toISOString(), _postman_exported_using: 'API Manager/1.0.0' }, null, 2);
}

export function exportWorkspace(workspace: Workspace): string {
  return JSON.stringify({ format: 'api-manager', exportedAt: new Date().toISOString(), ...workspace }, null, 2);
}
