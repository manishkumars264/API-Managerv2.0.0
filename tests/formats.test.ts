import { describe, expect, it } from 'vitest';
import { exportCollection, exportEnvironment, exportGlobals, exportWorkspace, importData } from '../src/lib/import-export';
import { exportCurl, parseCurl } from '../src/lib/curl';
import { createVariableResolver, effectiveAuth, findRequest, removeCollectionRequest, requestVariables, resolveVariables, updateCollectionRequest } from '../src/lib/variables';
import { createDynamicResolver, DYNAMIC_VARIABLE_GROUPS, dynamicValue, SUPPORTED_DYNAMIC_VARIABLES } from '../shared/dynamic-variables.mjs';
import { initialWorkspace, newRequest, row, uid } from '../src/lib/model';
import type { ApiCollection, ApiRequest, Workspace } from '../src/types';

const fixture = () => ({
  info: { name: 'Service', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', description: { content: 'Service docs', type: 'text/markdown' }, custom: 'keep-info' },
  variable: [{ key: 'base', value: 'https://example.com', type: 'string', description: 'Base URL' }, { key: 'secret', value: 'off', disabled: true, type: 'secret' }],
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  event: [{ listen: 'prerequest', script: { exec: ['console.log("retained")'], type: 'text/javascript' } }],
  item: [
    { name: 'First', request: { method: 'GET', url: '{{base}}/first' } },
    { name: 'Parent', auth: { type: 'basic', basic: [{ key: 'username', value: 'user' }, { key: 'password', value: 'password' }] },
      variable: [{ key: 'parent', value: '1' }], description: 'Folder docs', item: [
        { name: 'Child', variable: [{ key: 'child', value: '2' }], item: [
          { name: 'Create', request: { method: 'POST', description: { content: 'Create docs', type: 'text/markdown' },
            header: [{ key: 'X-A', value: 'enabled', description: { content: 'Header docs' } }, { key: 'X-Disabled', value: 'off', disabled: true }],
            url: { raw: '{{base}}/items?page=2&off=hidden', query: [{ key: 'page', value: '2' }, { key: 'off', value: 'hidden', disabled: true }] },
            body: { mode: 'raw', raw: '{"ok":true}', options: { raw: { language: 'json', custom: 'keep-body' } } },
            auth: { type: 'futureauth', futureauth: [{ key: 'accessToken', value: 'token' }] }, proxy: { host: 'example.org' },
          }, event: [{ listen: 'test', script: { exec: ['pm.test("test", () => {})'] } }], response: [{ name: 'Example', code: 200 }] },
        ] },
      ] },
    { name: 'Last', request: { method: 'DELETE', url: 'https://example.com/last', auth: { type: 'noauth' } } },
  ],
});

const importFixture = () => importData(JSON.stringify(fixture()));
const nestedRequest = (collection: ApiCollection) => collection.folders[0].folders[0].requests[0];
const collectionFor = (request: ApiRequest): ApiCollection => ({ id: uid(), name: 'Collection', description: '', requests: [request], folders: [], variables: [], auth: { type: 'none' } });

describe('Postman import/export', () => {
  it('roundtrips nested folders, order, descriptions, disabled rows, variables, and retained unsupported fields', () => {
    const imported = importFixture(), collection = imported.collections[0], request = nestedRequest(collection);
    expect(collection.description).toBe('Service docs');
    expect(collection.folders[0].folders[0].variables?.[0].key).toBe('child');
    expect(request.url).toBe('{{base}}/items');
    expect(request.params[1].enabled).toBe(false);
    expect(request.headers[1].enabled).toBe(false);
    expect(request.auth.type).toBe('none');
    expect(imported.warnings.join(' ')).toContain('not executed');
    expect(imported.warnings.join(' ')).toContain('futureauth');
    const exported = JSON.parse(exportCollection(collection));
    expect(exported.item.map((item: { name: string }) => item.name)).toEqual(['First', 'Parent', 'Last']);
    expect(exported.info.custom).toBe('keep-info');
    expect(exported.info.description).toEqual(fixture().info.description);
    expect(exported.variable[1]).toMatchObject({ key: 'secret', disabled: true, type: 'secret' });
    expect(exported.event).toEqual(fixture().event);
    const exportedRequest = exported.item[1].item[0].item[0];
    expect(exportedRequest.response).toEqual([{ name: 'Example', code: 200 }]);
    expect(exportedRequest.request.auth.type).toBe('futureauth');
    expect(exportedRequest.request.proxy.host).toBe('example.org');
    expect(exportedRequest.request.body.options.raw.custom).toBe('keep-body');
    expect(exportedRequest.request.description).toEqual({ content: 'Create docs', type: 'text/markdown' });
    expect(exportedRequest.request.url.query[1].disabled).toBe(true);
    const again = importData(JSON.stringify(exported)).collections[0];
    expect(nestedRequest(again).body.raw).toBe(request.body.raw);
    expect(again.id).not.toBe(collection.id);
    expect(nestedRequest(again).id).not.toBe(request.id);
  });

  it('keeps structured URL fields consistent after changing the URL and merges inline and edited query parameters', () => {
    const collection = importFixture().collections[0], request = nestedRequest(collection);
    request.url = 'https://new.example:9443/new-path?inline=1&dup=url&keep=2#fragment';
    request.params = [row('dup', 'edited'), row('dup', 'again'), { ...row('keep', 'disabled'), enabled: false }];
    const exported = JSON.parse(exportCollection(collection)).item[1].item[0].item[0].request.url;
    expect(exported.host).toBe('new.example');
    expect(exported.port).toBe('9443');
    expect(exported.path).toEqual(['new-path']);
    expect(exported.raw).toBe('https://new.example:9443/new-path?inline=1&keep=2&dup=edited&dup=again#fragment');
    const again = nestedRequest(importData(exportCollection(collection)).collections[0]);
    expect(again.url).toBe('https://new.example:9443/new-path#fragment');
    expect(again.params.map(p => [p.key, p.value, p.enabled])).toEqual([
      ['inline', '1', true], ['keep', '2', true], ['dup', 'edited', true], ['dup', 'again', true], ['keep', 'disabled', false],
    ]);
  });

  it('retains raw query strings when imported URL objects do not provide structured query rows', () => {
    const source = { info: { name: 'Queries' }, item: [{ name: 'Query', request: { url: { raw: 'https://example.com/a?x=1' } } }] };
    const exported = exportCollection(importData(JSON.stringify(source)).collections[0]);
    const request = importData(exported).collections[0].requests[0];
    expect(request.params.map(p => [p.key, p.value])).toEqual([['x', '1']]);
  });

  it('exports a string URL unchanged when it has no separate params', () => {
    const request = newRequest(); request.url = 'https://example.com/?q=1&q=2';
    expect(importData(exportCollection(collectionFor(request))).collections[0].requests[0].url).toBe(request.url);
  });

  it('roundtrips form files, content types, raw, binary, and disabled body metadata', () => {
    const source = { info: { name: 'Bodies' }, item: [
      { name: 'Forms', request: { url: 'https://example.com', method: 'POST', body: { mode: 'formdata', formdata: [
        { key: 'upload', type: 'file', src: 'C:\\data\\file.txt', contentType: 'text/plain', disabled: true },
        { key: 'name', type: 'text', value: 'Ada' },
      ] } } },
      { name: 'Binary', request: { url: 'https://example.com', body: { mode: 'file', file: { src: '/tmp/data.bin' } } } },
      { name: 'Disabled', request: { url: 'https://example.com', body: { mode: 'raw', raw: 'hidden', disabled: true } } },
    ] };
    const collection = importData(JSON.stringify(source)).collections[0];
    expect(collection.requests[0].body.fields[0]).toMatchObject({ value: 'C:\\data\\file.txt', type: 'file', enabled: false, contentType: 'text/plain' });
    expect(collection.requests[1].body.filePath).toBe('/tmp/data.bin');
    expect(collection.requests[2].body.mode).toBe('none');
    const again = JSON.parse(exportCollection(collection));
    expect(again.item[0].request.body.formdata[0].src).toBe('C:\\data\\file.txt');
    expect(again.item[2].request.body).toMatchObject({ disabled: true, raw: 'hidden' });
  });

  it('supports v2.0 schema, request strings and GraphQL JSON conversion', () => {
    const source = { info: { name: 'Legacy', schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json' }, auth: { type: 'basic', basic: { username: 'legacy-user', password: 'legacy-password', keep: 'metadata' } }, item: [
      { name: 'String', request: 'https://example.com' },
      { name: 'GraphQL', request: { url: 'https://example.com', body: { mode: 'graphql', graphql: { query: '{viewer{id}}', variables: '{"id":1}' } } } },
    ] };
    const imported = importData(JSON.stringify(source));
    expect(imported.collections[0].requests[0].method).toBe('GET');
    expect(imported.collections[0].auth).toEqual({ type: 'basic', username: 'legacy-user', password: 'legacy-password' });
    expect(JSON.parse(exportCollection(imported.collections[0])).auth.basic).toContainEqual({ key: 'keep', value: 'metadata', type: 'string' });
    expect(JSON.parse(imported.collections[0].requests[1].body.raw)).toEqual({ query: '{viewer{id}}', variables: { id: 1 } });
    expect(imported.warnings.join(' ')).toContain('GraphQL');
  });

  it('imports and exports environments and globals including disabled and secret variables', () => {
    const source = { name: 'Development', _postman_variable_scope: 'environment', custom: 42, values: [
      { key: 'base', value: 'http://localhost', enabled: true }, { key: 'token', value: 'secret', enabled: false, type: 'secret' },
    ] };
    const env = importData(JSON.stringify(source)).environments[0];
    expect(env.variables[1].enabled).toBe(false);
    const exported = JSON.parse(exportEnvironment(env));
    expect(exported.custom).toBe(42);
    expect(exported.values[1]).toMatchObject({ disabled: true, type: 'secret', value: 'secret' });
    expect(importData(exportGlobals(env.variables)).globals?.map(v => v.value)).toEqual(['http://localhost', 'secret']);
  });

  it('rejects corrupt formats and unsupported Postman schemas with actionable errors', () => {
    expect(() => importData('')).toThrow('empty');
    expect(() => importData('{')).toThrow('Invalid JSON');
    expect(() => importData('[]')).toThrow('must be');
    expect(() => importData('{}')).toThrow('Unrecognized');
    expect(() => importData(JSON.stringify({ info: { schema: 'https://schema.getpostman.com/json/collection/v1.0.0/collection.json' }, item: [] }))).toThrow('2.0 and 2.1');
    expect(() => importData(JSON.stringify({ info: {}, item: [null] }))).toThrow('must be an object');
    expect(() => importData(JSON.stringify({ info: {}, item: [], variable: {} }))).toThrow('must be arrays');
  });
});

describe('native workspace backups', () => {
  it('restores every session field, including draft tabs, responses, history, selection, and settings', () => {
    const workspace = initialWorkspace();
    workspace.collections = importFixture().collections;
    const env = { id: uid(), name: 'Local', variables: [row('base', 'http://localhost')] };
    workspace.environments = [env]; workspace.activeEnvironmentId = env.id;
    workspace.tabs[0].request.body = { mode: 'raw', raw: '{"draft":true}', fields: [], language: 'json' };
    workspace.tabs[0].dirty = true; workspace.tabs[0].responseZoom = 20; workspace.tabs[0].editorTab = 'Body';
    workspace.tabs[0].response = { status: 200, statusText: 'OK', headers: [row('Content-Type', 'application/json')], body: '{"ok":true}', duration: 100, size: 11, url: 'https://example.com', receivedAt: new Date().toISOString() };
    workspace.history.push({ id: uid(), request: workspace.tabs[0].request, timestamp: new Date().toISOString() });
    workspace.globals = [row('token', 'global')]; workspace.sidebarView = 'history';
    const restored = importData(exportWorkspace(workspace)).workspace;
    expect(restored).toMatchObject(JSON.parse(JSON.stringify(workspace)));
    expect(restored?.activeTabId).toBe(workspace.activeTabId);
    expect(restored?.tabs[0].response?.body).toBe('{"ok":true}');
  });

  it('rejects malformed native session objects before they reach the UI', () => {
    const workspace = initialWorkspace();
    expect(() => importData(JSON.stringify({ ...workspace, tabs: [] }))).toThrow('non-empty');
    expect(() => importData(JSON.stringify({ ...workspace, activeEnvironmentId: 'missing' }))).toThrow('does not exist');
    expect(() => importData(JSON.stringify({ ...workspace, tabs: [{ ...workspace.tabs[0], responseZoom: 100 }] }))).toThrow('between 8 and 40');
    expect(() => importData(JSON.stringify({ ...workspace, settings: { ...workspace.settings, timeout: -1 } }))).toThrow('settings.timeout');
    expect(() => importData(JSON.stringify({ ...workspace, settings: { ...workspace.settings, maxResponseMB: 1000 } }))).toThrow('maxResponseMB');
    expect(() => importData(JSON.stringify({ ...workspace, sidebarWidth: 9000 }))).toThrow('sidebarWidth');
  });

  it.each(['tab', 'history'] as const)('validates %s script-result arrays and row shapes before UI restoration', location => {
    const workspace = initialWorkspace();
    const entry = { id: uid(), request: workspace.tabs[0].request, timestamp: new Date().toISOString() };
    const restore = (scriptResults: unknown) => importData(JSON.stringify(location === 'tab'
      ? { ...workspace, tabs: [{ ...workspace.tabs[0], scriptResults }] }
      : { ...workspace, history: [{ ...entry, scriptResults }] }));
    expect(() => restore({})).toThrow('scriptResults.tests');
    expect(() => restore({ tests: [], logs: null })).toThrow('scriptResults.logs');
    expect(() => restore({ tests: [{ name: 'test', passed: 'true' }], logs: [] })).toThrow('passed');
    expect(() => restore({ tests: [null], logs: [] })).toThrow('must be an object');
    expect(() => restore({ tests: [], logs: [{ level: 1, message: 'text' }] })).toThrow('level');
    expect(() => restore({ tests: [], logs: [], error: 1 })).toThrow('scriptResults.error');
    const valid = { tests: [{ name: 'Status', passed: false, error: 'Expected 200' }], logs: [{ level: 'warn', message: 'inspect' }], error: 'Script stopped' };
    const restored = restore(valid).workspace!;
    expect(location === 'tab' ? restored.tabs[0].scriptResults : restored.history[0].scriptResults).toEqual(valid);
  });

  it('enforces native script-result count and text limits', () => {
    const workspace = initialWorkspace();
    const restore = (scriptResults: unknown) => importData(JSON.stringify({ ...workspace, tabs: [{ ...workspace.tabs[0], scriptResults }] }));
    expect(() => restore({ tests: Array.from({ length: 1001 }, () => ({ name: 'test', passed: true })), logs: [] })).toThrow('at most 1000');
    expect(() => restore({ tests: [], logs: Array.from({ length: 1001 }, () => ({ level: 'log', message: '' })) })).toThrow('at most 1000');
    expect(() => restore({ tests: [{ name: 't'.repeat(1001), passed: true }], logs: [] })).toThrow('name');
    expect(() => restore({ tests: [{ name: 'test', passed: false, error: 'e'.repeat(10001) }], logs: [] })).toThrow('tests[0].error');
    expect(() => restore({ tests: [], logs: [{ level: 'l'.repeat(33), message: '' }] })).toThrow('level');
    expect(() => restore({ tests: [], logs: [{ level: 'log', message: 'm'.repeat(10001) }] })).toThrow('message');
    expect(() => restore({ tests: [], logs: [], error: 'e'.repeat(10001) })).toThrow('scriptResults.error');
  });

  it('enforces 1 MB script source limits by UTF-8 bytes and bounded authorization dictionaries', () => {
    const workspace = initialWorkspace();
    const restoreRequest = (change: Record<string, unknown>) => importData(JSON.stringify({ ...workspace, tabs: [{ ...workspace.tabs[0], request: { ...workspace.tabs[0].request, ...change } }] }));
    const source = 'x'.repeat(1024 * 1024);
    expect(restoreRequest({ scripts: { preRequest: source, postResponse: '' } }).workspace?.tabs[0].request.scripts?.preRequest).toHaveLength(source.length);
    expect(() => restoreRequest({ scripts: { preRequest: source + 'x', postResponse: '' } })).toThrow('scripts.preRequest');
    expect(() => restoreRequest({ scripts: { preRequest: '', postResponse: 'é'.repeat(524289) } })).toThrow('1 MB');
    expect(() => restoreRequest({ auth: { type: 'jwt', fields: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`field${i}`, ''])) } })).toThrow('at most 100');
    expect(() => restoreRequest({ auth: { type: 'jwt', fields: { ['k'.repeat(257)]: '' } } })).toThrow('fields name');
    expect(() => restoreRequest({ auth: { type: 'jwt', fields: { payload: source + 'x' } } })).toThrow('fields.payload');
    expect(restoreRequest({ auth: { type: 'jwt', fields: { payload: source } } }).workspace?.tabs[0].request.auth.fields?.payload).toHaveLength(source.length);
  });

  it('checks converted Postman inputs against the same script and authorization storage limits', () => {
    const collection = { info: { name: 'Too large' }, item: [{ name: 'Request', request: { url: 'https://example.com', auth: { type: 'jwt', jwt: [{ key: 'payload', value: 'x'.repeat(1024 * 1024 + 1) }] } } }] };
    expect(() => importData(JSON.stringify(collection))).toThrow('fields.payload');
    const scripts = { info: { name: 'Too large' }, item: [], event: [{ listen: 'prerequest', script: { exec: ['é'.repeat(524289)] } }] };
    expect(() => importData(JSON.stringify(scripts))).toThrow('1 MB');
  });
});

describe('cURL parsing and export', () => {
  it('handles POSIX quoted JSON, escaped apostrophes, empty values and repeated headers', () => {
    const request = parseCurl(`curl 'https://example.com/search?q=1' -X POST -H 'X-Test: a:b' -H 'X-Test: again' --data-raw '{"name":"O'"'"'Brien", "empty":""}'`);
    expect(request.body.raw).toBe('{"name":"O\'Brien", "empty":""}');
    expect(request.headers.filter(h => h.key === 'X-Test').map(h => h.value)).toEqual(['a:b', 'again']);
    expect(request.method).toBe('POST');
    const again = parseCurl(exportCurl(request));
    expect(again.body.raw).toBe(request.body.raw);
    expect(again.url).toBe(request.url);
  });

  it('defaults data to POST, supports short options without spaces, and parses Basic passwords with colons', () => {
    const request = parseCurl('curl --url=https://example.com -HContent-Type:application/json -ualice:p:a:s:s -d{"ok":true}');
    expect(request.method).toBe('POST');
    expect(request.auth).toEqual({ type: 'basic', username: 'alice', password: 'p:a:s:s' });
    // Unquoted shell quotes are interpreted by a shell, so quoted JSON should be used for literal quotes.
    expect(request.body.raw).toBe('{ok:true}');
  });

  it('supports Windows caret and PowerShell continuations, double-quoted JSON and local binary paths', () => {
    const request = parseCurl('curl.exe "https://example.com" ^\r\n -X POST ^\r\n -H "Content-Type: application/json" ^\r\n -d "{\\"hello\\":\\"world\\"}"');
    expect(request.body.raw).toBe('{"hello":"world"}');
    const binary = parseCurl('curl "https://example.com" `\n --data-binary "@C:\\data\\file.bin"');
    expect(binary.body).toMatchObject({ mode: 'binary', filePath: 'C:\\data\\file.bin' });
  });

  it('supports --get, --data-urlencode, --json, and named form file metadata', () => {
    const get = parseCurl("curl https://example.com -G --data-urlencode 'q=a b' -d 'page=1&page=2'");
    expect(get.method).toBe('GET'); expect(get.body.mode).toBe('none');
    expect(get.params.map(p => [p.key, p.value])).toEqual([['q', 'a b'], ['page', '1'], ['page', '2']]);
    const json = parseCurl(`curl https://example.com --json '{"hello":"world"}'`);
    expect(json.body.language).toBe('json');
    expect(json.headers.map(h => h.key)).toEqual(['Content-Type', 'Accept']);
    const form = parseCurl("curl https://example.com --form 'upload=@/tmp/file.txt;type=text/plain;filename=report.txt' --form-string 'literal=@value;literal'");
    expect(form.body.fields[0]).toMatchObject({ type: 'file', value: '/tmp/file.txt', contentType: 'text/plain', fileName: 'report.txt' });
    expect(parseCurl(exportCurl(form)).body.fields[1].value).toBe('@value;literal');
  });

  it('applies enabled query overrides while retaining duplicates, disabled originals, and fragments in cURL exports', () => {
    const request = newRequest(); request.url = 'https://example.com/?same=url&keep=original#hash';
    request.params = [row('same', 'one'), row('same', 'two'), { ...row('keep', 'disabled'), enabled: false }];
    expect(parseCurl(exportCurl(request)).url).toBe('https://example.com/?keep=original&same=one&same=two#hash');
  });

  it('matches effective engine body defaults and replaces all conflicting auth headers', () => {
    const binary = newRequest(); binary.url = 'https://example.com'; binary.method = 'POST'; binary.body.mode = 'binary'; binary.body.filePath = '/tmp/data.bin';
    expect(parseCurl(exportCurl(binary)).headers.find(h => h.key === 'Content-Type')?.value).toBe('application/octet-stream');
    expect(parseCurl('curl https://example.com --data-binary @/tmp/data.bin').headers.find(h => h.key === 'Content-Type')?.value).toBe('application/x-www-form-urlencoded');
    const basic = newRequest(); basic.url = 'https://example.com'; basic.auth = { type: 'basic', username: 'user', password: 'password' };
    basic.headers = [row('Authorization', 'old'), row('authorization', 'older')];
    expect(parseCurl(exportCurl(basic)).headers.some(h => h.key.toLowerCase() === 'authorization')).toBe(false);
    basic.auth = { type: 'bearer', token: 'new' };
    expect(parseCurl(exportCurl(basic)).headers.filter(h => h.key.toLowerCase() === 'authorization').map(h => h.value)).toEqual(['Bearer new']);
  });

  it('resolves variables in exported requests and omits disabled headers and fields', () => {
    const request = newRequest(); request.method = 'POST'; request.url = '{{base}}/api';
    request.headers = [row('X-Token', '{{token}}'), { ...row('X-Disabled', '{{missing}}'), enabled: false }];
    request.auth = { type: 'bearer', token: '{{token}}' };
    request.body = { mode: 'urlencoded', raw: '', language: 'text', fields: [row('name', 'A & B'), { ...row('hidden', '{{missing}}'), enabled: false }] };
    const parsed = parseCurl(exportCurl(request, [row('base', 'https://example.com'), row('token', 'secret')]));
    expect(parsed.url).toBe('https://example.com/api');
    expect(parsed.headers.find(h => h.key === 'Authorization')?.value).toBe('Bearer secret');
    expect(parsed.headers.some(h => h.key === 'X-Disabled')).toBe(false);
    expect(parsed.body.fields.map(f => f.value)).toEqual(['A & B']);
    expect(() => exportCurl(request, [])).toThrow('Unresolved variable');
  });

  it.each([
    ['curl https://example.com | sh', 'Shell execution'],
    ['curl "https://example.com/$(whoami)"', 'Shell expansion'],
    ['curl https://example.com --output file', 'Unsupported cURL option'],
    ['curl "https://example.com', 'unclosed quote'],
    ['curl https://example.com -H', 'requires a value'],
    ['curl https://example.com --data @file.json', 'strips line breaks'],
    ['curl https://example.com -F a=@-', 'Standard input'],
    ['curl https://example.com -d a=1 -F b=2', 'cannot be combined'],
    ['curl https://example.com https://other.example.com', 'Only one'],
    ['curl -X GET', 'does not contain a URL'],
  ])('rejects unsupported or malformed command: %s', (command, message) => expect(() => parseCurl(command)).toThrow(message));

  it('opens an imported command in a request tab and exposes option warnings', () => {
    const result = importData('curl -L https://example.com');
    expect(result.tabs?.[0].request.url).toBe('https://example.com');
    expect(result.tabs?.[0].dirty).toBe(true);
    expect(result.warnings.join(' ')).toContain('redirect');
  });
});

describe('scoped variables and inherited auth', () => {
  it('merges scopes with environment precedence and falls through disabled values', () => {
    const workspace = initialWorkspace(), collection = importFixture().collections[0], request = nestedRequest(collection);
    request.auth = { type: 'inherit' };
    collection.variables.push(row('scope', 'collection'), row('token', 'collection-token'));
    collection.folders[0].variables?.push(row('scope', 'parent'));
    collection.folders[0].folders[0].variables?.push(row('scope', 'child'));
    workspace.collections = [collection]; workspace.globals = [row('scope', 'global'), row('fallback', 'global')];
    const env = { id: uid(), name: 'Test', variables: [row('scope', 'environment'), { ...row('fallback', 'disabled'), enabled: false }] };
    workspace.environments = [env]; workspace.activeEnvironmentId = env.id;
    const values = requestVariables(workspace, request);
    expect(resolveVariables('{{scope}}/{{fallback}}/{{parent}}/{{child}}', values)).toBe('environment/global/1/2');
    expect(effectiveAuth(workspace, request)).toEqual({ type: 'basic', username: 'user', password: 'password' });
    request.auth = { type: 'none' }; expect(effectiveAuth(workspace, request)).toEqual({ type: 'none' });
  });

  it('uses exact variable tokens with whitespace, recursively resolves references, and rejects unresolved/circular values', () => {
    expect(resolveVariables('prefix-{{ value }}-suffix', [row('value', '{{base}}/api'), row('base', 'https://example.com')])).toBe('prefix-https://example.com/api-suffix');
    expect(resolveVariables('{{a}}', [row('a', 'first'), row('a', 'last')])).toBe('last');
    expect(() => resolveVariables('{{missing}}', [row('miss', 'no')])).toThrow('Unresolved variable: {{missing}}');
    expect(() => resolveVariables('{{a}}', [row('a', '{{b}}'), row('b', '{{a}}')])).toThrow('Circular');
    expect(() => resolveVariables('{{a}}', [{ ...row('a', 'hidden'), enabled: false }])).toThrow('Unresolved');
    expect(resolveVariables('$timestamp is literal', [])).toBe('$timestamp is literal');
  });

  it('keeps dynamic values stable within one resolution and allows user values to override them', () => {
    const [first, second] = resolveVariables('{{$guid}}|{{$guid}}', []).split('|');
    expect(first).toBe(second); expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveVariables('{{$timestamp}}', [])).toMatch(/^\d+$/);
    expect(resolveVariables('{{$randomString}}', [])).toMatch(/^[0-9a-f]{12}$/);
    expect(resolveVariables('{{$guid}}', [row('$guid', 'fixed')])).toBe('fixed');
  });

  it('finds, immutably updates, and removes nested saved requests', () => {
    const workspace: Workspace = initialWorkspace(); workspace.collections = importFixture().collections;
    const request = nestedRequest(workspace.collections[0]);
    expect(findRequest(workspace, request.id)).toBe(request);
    const changed = updateCollectionRequest(workspace, { ...request, name: 'Renamed' });
    expect(findRequest(changed, request.id)?.name).toBe('Renamed');
    expect(findRequest(workspace, request.id)?.name).toBe('Create');
    expect(findRequest(removeCollectionRequest(changed, request.id), request.id)).toBeUndefined();
  });
});

describe('SOAP request formats', () => {
  it.each(['1.1', '1.2'] as const)('roundtrips SOAP %s XML and action through Postman collections', version => {
    const request = newRequest('SOAP operation');
    request.method = 'POST'; request.url = 'https://example.com/soap';
    request.soap = { version, action: 'urn:service:"quoted";path\\operation' };
    request.body = { mode: 'raw', raw: '<Envelope><Body><Operation/></Body></Envelope>', language: 'xml', fields: [] };
    request.headers = [row('Content-Type', 'application/json'), row('SOAPAction', 'stale'), { ...row('Content-Type', 'disabled'), enabled: false }];
    const collection = collectionFor(request);
    const exported = JSON.parse(exportCollection(collection));
    const headers = exported.item[0].request.header as { key: string; value: string; disabled: boolean }[];
    const active = headers.filter(header => !header.disabled);
    expect(active.filter(header => header.key.toLowerCase() === 'content-type')).toHaveLength(1);
    expect(active.find(header => header.key === 'Content-Type')?.value).toContain(version === '1.2' ? 'application/soap+xml' : 'text/xml');
    expect(active.filter(header => header.key === 'SOAPAction')).toHaveLength(version === '1.1' ? 1 : 0);
    const restored = importData(JSON.stringify(exported)).collections[0].requests[0];
    expect(restored.soap).toEqual(request.soap);
    expect(restored.body).toMatchObject({ mode: 'raw', language: 'xml', raw: request.body.raw });
    expect(restored.method).toBe('POST');
  });

  it('restores SOAP configuration in native sessions and rejects invalid metadata', () => {
    const workspace = initialWorkspace(); workspace.tabs[0].request.soap = { version: '1.2', action: 'urn:operation' };
    workspace.tabs[0].request.method = 'POST'; workspace.tabs[0].request.body.mode = 'raw'; workspace.tabs[0].request.body.language = 'xml';
    expect(importData(exportWorkspace(workspace)).workspace?.tabs[0].request.soap).toEqual({ version: '1.2', action: 'urn:operation' });
    const invalid = JSON.parse(exportWorkspace(workspace)); invalid.tabs[0].request.soap.version = '2.0';
    expect(() => importData(JSON.stringify(invalid))).toThrow('soap.version');
    invalid.tabs[0].request.soap = { version: '1.1', action: 1 };
    expect(() => importData(JSON.stringify(invalid))).toThrow('soap.action');
  });

  it('detects SOAP versions from cURL headers and preserves escaped resolved actions on export', () => {
    const v11 = parseCurl(`curl https://example.com -H 'Content-Type: text/xml; charset=utf-8' -H 'SOAPAction: "urn:operation"' --data-raw '<Envelope/>'`);
    expect(v11.soap).toEqual({ version: '1.1', action: 'urn:operation' });
    expect(v11.body.language).toBe('xml');
    const v12 = parseCurl(`curl https://example.com -H 'Content-Type: application/soap+xml; charset=utf-8; action="urn:operation"' --data-raw '<Envelope/>'`);
    expect(v12.soap).toEqual({ version: '1.2', action: 'urn:operation' });
    v12.soap = { version: '1.2', action: '{{action}}' };
    const resolved = parseCurl(exportCurl(v12, [row('action', 'urn:"quote"\\operation')]));
    expect(resolved.soap).toEqual({ version: '1.2', action: 'urn:"quote"\\operation' });
    expect(resolved.body.raw).toBe('<Envelope/>');
  });

  it('keeps ordinary XML requests distinct and handles empty SOAP actions', () => {
    expect(parseCurl(`curl https://example.com -H 'Content-Type: text/xml' --data-raw '<Document/>'`).soap).toBeUndefined();
    expect(parseCurl(`curl https://example.com -H 'Content-Type: application/soap+xml' --data-raw '<Envelope/>'`).soap).toEqual({ version: '1.2', action: '' });
    const request = newRequest(); request.url = 'https://example.com'; request.body.mode = 'raw'; request.body.language = 'xml'; request.soap = { version: '1.1', action: '' };
    expect(parseCurl(exportCurl(request)).soap).toEqual({ version: '1.1', action: '' });
    request.soap.action = 'bad\r\naction'; expect(() => exportCurl(request)).toThrow('SOAP action');
  });
});

describe('advanced authentication and Postman scripts', () => {
  it.each(['digest', 'oauth1', 'oauth2', 'hawk', 'awsv4', 'ntlm', 'edgegrid', 'jwt', 'asap'] as const)('roundtrips %s authentication fields without dropping custom attributes', type => {
    const source = { info: { name: 'Auth' }, item: [{ name: 'Request', request: { url: 'https://example.com', auth: { type, [type]: [
      { key: 'username', value: '{{user}}', type: 'string' }, { key: 'accessToken', value: 'token', type: 'string' },
      { key: 'booleanOption', value: true, type: 'boolean' }, { key: 'custom', value: 'preserve', extra: 'keep' },
    ] } } }] };
    const result = importData(JSON.stringify(source));
    expect(result.warnings).toEqual([]);
    const request = result.collections[0].requests[0];
    expect(request.auth).toMatchObject({ type, fields: { username: '{{user}}', accessToken: 'token', booleanOption: 'true', custom: 'preserve' } });
    const exported = JSON.parse(exportCollection(result.collections[0])).item[0].request.auth;
    expect(exported[type]).toContainEqual({ key: 'booleanOption', value: true, type: 'boolean' });
    expect(exported[type]).toContainEqual({ key: 'custom', value: 'preserve', extra: 'keep', type: 'string' });
    request.auth.fields!.accessToken = 'updated';
    expect(JSON.parse(exportCollection(result.collections[0])).item[0].request.auth[type]).toContainEqual({ key: 'accessToken', value: 'updated', type: 'string' });
  });

  it('imports pre-request and post-response scripts at every scope, skips disabled scripts, and preserves unknown events', () => {
    const event = (listen: string, exec: string[], disabled = false) => ({ listen, script: { exec, type: 'text/javascript', ...(disabled ? { disabled } : {}) } });
    const source = { info: { name: 'Scripts' }, event: [event('prerequest', ['pm.globals.set("scope", "collection");'])], item: [
      { name: 'Folder', event: [event('test', ['pm.test("folder", () => pm.expect(1).eq(1));'])], item: [
        { name: 'Request', request: { url: 'https://example.com' }, event: [
          event('prerequest', ['const a = 1;', 'console.log(a);']), event('prerequest', ['const b = 2;']),
          event('test', ['pm.test("response", () => pm.response.to.have.status(200));']),
          event('test', ['throw new Error("disabled");'], true), event('unknown-event', ['preserved()']),
        ] },
      ] },
    ] };
    const result = importData(JSON.stringify(source)), collection = result.collections[0], folder = collection.folders[0], request = folder.requests[0];
    expect(collection.scripts?.preRequest).toContain('collection');
    expect(folder.scripts?.postResponse).toContain('folder');
    expect(request.scripts?.preRequest).toBe('const a = 1;\nconsole.log(a);\nconst b = 2;');
    expect(request.scripts?.postResponse).not.toContain('disabled');
    expect(result.warnings.join(' ')).toContain('Disabled'); expect(result.warnings.join(' ')).toContain('unknown-event');
    request.scripts = { preRequest: 'pm.environment.set("edited", "yes");', postResponse: '' };
    const exported = JSON.parse(exportCollection(collection)), events = exported.item[0].item[0].event;
    expect(events.filter((value: { listen: string; script: { disabled?: boolean } }) => value.listen === 'prerequest')).toHaveLength(1);
    expect(events[0].script.exec).toEqual(['pm.environment.set("edited", "yes");']);
    expect(events.some((value: { script: { disabled?: boolean } }) => value.script.disabled)).toBe(true);
    expect(events.some((value: { listen: string }) => value.listen === 'unknown-event')).toBe(true);
    const again = importData(JSON.stringify(exported)).collections[0].folders[0].requests[0];
    expect(again.scripts?.postResponse).toBe('');
    expect(again.scripts?.preRequest).toContain('edited');
  });

  it('preserves advanced auth and edited scripts in native session backups and rejects malformed script/auth fields', () => {
    const workspace = initialWorkspace(); workspace.tabs[0].request.auth = { type: 'jwt', fields: { algorithm: 'HS256', secret: '{{secret}}', payload: '{}' } };
    workspace.tabs[0].request.scripts = { preRequest: 'pm.variables.set("x", 1);', postResponse: 'pm.test("ok", () => {});' };
    const backup = exportWorkspace(workspace), restored = importData(backup).workspace;
    expect(restored?.tabs[0].request.auth).toEqual(workspace.tabs[0].request.auth);
    expect(restored?.tabs[0].request.scripts).toEqual(workspace.tabs[0].request.scripts);
    const invalid = JSON.parse(backup); invalid.tabs[0].request.auth.fields.secret = 1;
    expect(() => importData(JSON.stringify(invalid))).toThrow('fields.secret');
    invalid.tabs[0].request.auth.fields.secret = 'secret'; invalid.tabs[0].request.scripts.preRequest = [];
    expect(() => importData(JSON.stringify(invalid))).toThrow('scripts.preRequest');
  });

  it('exports and imports native cURL Digest, NTLM, AWS signing, and OAuth2 tokens, rejecting unsupported live signature regeneration', () => {
    const request = newRequest(); request.url = 'https://example.com';
    for (const type of ['digest', 'ntlm'] as const) {
      request.auth = { type, fields: { username: 'user', password: 'p:a:ss' } };
      expect(parseCurl(exportCurl(request)).auth).toMatchObject({ type, fields: { username: 'user', password: 'p:a:ss' } });
    }
    request.auth = { type: 'awsv4', fields: { accessKey: 'key', secretKey: 'secret', service: 's3', region: 'us-east-1', sessionToken: 'session' } };
    expect(parseCurl(exportCurl(request)).auth).toEqual(request.auth);
    request.auth = { type: 'oauth2', fields: { accesstoken: '{{token}}', addTokenTo: 'queryParams' } };
    expect(parseCurl(exportCurl(request, [row('token', 'secret')])).url).toBe('https://example.com?access_token=secret');
    request.auth = { type: 'jwt', fields: { secret: 'secret', payload: '{}' } };
    expect(() => exportCurl(request)).toThrow('cannot regenerate jwt signatures');
  });

  it('resolves legacy top-level auth credentials as consistently as advanced field credentials', () => {
    const request = newRequest(); request.url = 'https://example.com';
    for (const type of ['digest', 'ntlm'] as const) {
      request.auth = { type, username: '{{username}}', password: '{{password}}' };
      const resolved = parseCurl(exportCurl(request, [row('username', 'user'), row('password', 'secret')]));
      expect(resolved.auth.fields).toEqual({ username: 'user', password: 'secret' });
    }
    request.auth = { type: 'oauth2', token: '{{token}}' };
    expect(parseCurl(exportCurl(request, [row('token', 'secret')])).headers).toContainEqual(expect.objectContaining({ key: 'Authorization', value: 'Bearer secret' }));
    expect(() => exportCurl(request, [])).toThrow('Unresolved variable: {{token}}');
  });
});

describe('Postman dynamic variables', () => {
  it.each(SUPPORTED_DYNAMIC_VARIABLES)('generates %s as a nonempty string and keeps its sample stable', name => {
    const dynamic = createDynamicResolver();
    const sample = dynamic(name);
    expect(typeof sample).toBe('string');
    expect(sample).not.toBe('');
    expect(sample).not.toBe('undefined');
    expect(sample).not.toBe('[object Object]');
    expect(dynamic(name)).toBe(sample);
  });

  it('implements every case-sensitive name in the official Postman dynamic list', () => {
    const official = `
      $guid $timestamp $isoTimestamp $randomUUID
      $randomAlphaNumeric $randomBoolean $randomInt $randomColor $randomHexColor $randomAbbreviation
      $randomIP $randomIPV6 $randomMACAddress $randomPassword $randomLocale $randomUserAgent $randomProtocol $randomSemver
      $randomFirstName $randomLastName $randomFullName $randomNamePrefix $randomNameSuffix
      $randomJobArea $randomJobDescriptor $randomJobTitle $randomJobType
      $randomPhoneNumber $randomPhoneNumberExt $randomCity $randomStreetName $randomStreetAddress $randomCountry $randomCountryCode $randomLatitude $randomLongitude
      $randomAvatarImage $randomImageUrl $randomAbstractImage $randomAnimalsImage $randomBusinessImage $randomCatsImage $randomCityImage $randomFoodImage $randomNightlifeImage $randomFashionImage $randomPeopleImage $randomNatureImage $randomSportsImage $randomTransportImage $randomImageDataUri
      $randomBankAccount $randomBankAccountName $randomCreditCardMask $randomBankAccountBic $randomBankAccountIban $randomTransactionType $randomCurrencyCode $randomCurrencyName $randomCurrencySymbol $randomBitcoin
      $randomCompanyName $randomCompanySuffix $randomBs $randomBsAdjective $randomBsBuzz $randomBsNoun
      $randomCatchPhrase $randomCatchPhraseAdjective $randomCatchPhraseDescriptor $randomCatchPhraseNoun
      $randomDatabaseColumn $randomDatabaseType $randomDatabaseCollation $randomDatabaseEngine
      $randomDateFuture $randomDatePast $randomDateRecent $randomWeekday $randomMonth
      $randomDomainName $randomDomainSuffix $randomDomainWord $randomEmail $randomExampleEmail $randomUserName $randomUrl
      $randomFileName $randomFileType $randomFileExt $randomCommonFileName $randomCommonFileType $randomCommonFileExt $randomFilePath $randomDirectoryPath $randomMimeType
      $randomPrice $randomProduct $randomProductAdjective $randomProductMaterial $randomProductName $randomDepartment
      $randomNoun $randomVerb $randomIngverb $randomAdjective $randomWord $randomWords $randomPhrase
      $randomLoremWord $randomLoremWords $randomLoremSentence $randomLoremSentences $randomLoremParagraph $randomLoremParagraphs $randomLoremText $randomLoremSlug $randomLoremLines
    `.trim().split(/\s+/);
    expect(official).toHaveLength(118);
    expect(official.every(name => SUPPORTED_DYNAMIC_VARIABLES.includes(name))).toBe(true);
    expect(new Set(SUPPORTED_DYNAMIC_VARIABLES).size).toBe(SUPPORTED_DYNAMIC_VARIABLES.length);
    expect(Object.values(DYNAMIC_VARIABLE_GROUPS).flat().sort()).toEqual([...SUPPORTED_DYNAMIC_VARIABLES].sort());
    expect(SUPPORTED_DYNAMIC_VARIABLES.filter(name => !official.includes(name)).sort()).toEqual([...DYNAMIC_VARIABLE_GROUPS.extensions].sort());
  });

  it('generates correct identifier, numeric, internet, and local-data formats', () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      const d = createDynamicResolver();
      for (const name of ['$guid', '$randomUUID']) expect(d(name)).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
      expect(d('$randomAlphaNumeric')).toMatch(/^[A-Za-z0-9]$/);
      expect(d('$randomBoolean')).toMatch(/^(true|false)$/);
      expect(Number(d('$randomInt'))).toBeGreaterThanOrEqual(0); expect(Number(d('$randomInt'))).toBeLessThanOrEqual(1000);
      expect(d('$randomHexColor')).toMatch(/^#[a-f0-9]{6}$/);
      expect(d('$randomPassword')).toMatch(/^[A-Za-z0-9]{15}$/);
      expect(d('$randomLocale')).toMatch(/^[a-z]{2}$/);
      expect(d('$randomCountryCode')).toMatch(/^[A-Z]{2}$/);
      expect(d('$randomCurrencyCode')).toMatch(/^[A-Z]{3}$/);
      expect(d('$randomSemver')).toMatch(/^\d+\.\d+\.\d+$/);
      expect(d('$randomMACAddress')).toMatch(/^[a-f0-9]{2}(:[a-f0-9]{2}){5}$/i);
      const ip = d('$randomIP')!.split('.').map(Number);
      expect(ip).toHaveLength(4); expect(ip.every(value => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(true);
      expect(d('$randomIPV6')).toMatch(/^[a-f0-9:]+$/i);
      expect(d('$randomPhoneNumber')).toMatch(/^\d{3}-\d{3}-\d{4}$/);
      expect(d('$randomPhoneNumberExt')).toMatch(/^\d{2}-\d{3}-\d{3}-\d{4}$/);
      expect(d('$randomBankAccount')).toMatch(/^\d{8}$/);
      expect(d('$randomCreditCardMask')).toMatch(/^\d{4}$/);
      expect(d('$randomBankAccountBic')).toMatch(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/);
      expect(d('$randomBankAccountIban')).toMatch(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/);
      expect(Number(d('$randomLatitude'))).toBeGreaterThanOrEqual(-90); expect(Number(d('$randomLatitude'))).toBeLessThanOrEqual(90);
      expect(Number(d('$randomLongitude'))).toBeGreaterThanOrEqual(-180); expect(Number(d('$randomLongitude'))).toBeLessThanOrEqual(180);
      expect(d('$randomPrice')).toMatch(/^\d+\.\d{2}$/); expect(Number(d('$randomPrice'))).toBeLessThanOrEqual(1000);
      expect(d('$randomExampleEmail')).toMatch(/^[^\s@]+@example\.(com|org|net)$/);
      expect(new URL(d('$randomUrl')!).protocol).toMatch(/^https?:$/);
      expect(d('$randomIngverb')).toContain('ing');
      expect(d('$randomLoremParagraphs')!.split('\n').filter(Boolean)).toHaveLength(3);
      expect(d('$randomLoremLines')!.split('\n').length).toBeGreaterThanOrEqual(1);
      expect(d('$randomLoremLines')!.split('\n').length).toBeLessThanOrEqual(5);
    }
  });

  it('uses seconds, UTC ISO time, and directional dates without caching across distinct runs', () => {
    const now = Date.now(); const d = createDynamicResolver();
    expect(Number(d('$timestamp'))).toBeGreaterThanOrEqual(Math.floor(now / 1000));
    expect(Number(d('$timestamp'))).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(d('$isoTimestamp')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(d('$randomDateFuture')!)).toBeGreaterThan(now);
    expect(Date.parse(d('$randomDatePast')!)).toBeLessThanOrEqual(now);
    expect(Date.parse(d('$randomDateRecent')!)).toBeLessThanOrEqual(now);
    expect(d('$guid')).not.toBe(createDynamicResolver()('$guid'));
  });

  it('reuses supplied runtime samples, rejects unknown names, and respects enabled user overrides', () => {
    const d = createDynamicResolver({ $guid: 'script-sample', $randomEmail: 'script@example.com', unknown: 'reject' });
    expect(d('$guid')).toBe('script-sample'); expect(d('$randomEmail')).toBe('script@example.com');
    for (const name of ['unknown', '$randomemail', '$faker.internet.email()', '__proto__', 'constructor']) expect(d(name)).toBeUndefined();
    expect(dynamicValue('$notAvailable')).toBeUndefined();
    const resolve = createVariableResolver([row('ref', '{{$guid}}'), row('$guid', 'custom')], { $guid: 'script-sample' });
    expect(resolve('{{ref}}|{{$guid}}')).toBe('custom|custom');
    expect(createVariableResolver([{ ...row('$guid', 'disabled'), enabled: false }], { $guid: 'script-sample' })('{{$guid}}')).toBe('script-sample');
    expect(() => resolve('{{$randomemail}}')).toThrow('Unresolved variable: {{$randomemail}}');
    expect(() => resolveVariables('{{$guid}}', [row('$guid', '{{nested}}'), row('nested', '{{$guid}}')])).toThrow('Circular');
    expect(() => resolveVariables('{{v0}}', Array.from({ length: 31 }, (_, index) => row(`v${index}`, index === 30 ? 'value' : `{{v${index + 1}}}`)))).toThrow('maximum nesting depth');
  });

  it('keeps one dynamic value across all cURL fields and preserves unresolved templates in saved collections', () => {
    const request = newRequest(); request.url = 'https://example.com/{{$guid}}'; request.params = [row('id', '{{$guid}}')];
    request.headers = [row('X-Request-ID', '{{$guid}}')]; request.auth = { type: 'bearer', token: '{{$guid}}' };
    request.body = { ...request.body, mode: 'raw', language: 'json', raw: '{"id":"{{$guid}}"}' };
    const exported = parseCurl(exportCurl(request, []));
    const id = new URL(exported.url).pathname.slice(1);
    expect(new URL(exported.url).searchParams.get('id')).toBe(id);
    expect(exported.headers.find(value => value.key === 'X-Request-ID')?.value).toBe(id);
    expect(exported.headers.find(value => value.key === 'Authorization')?.value).toBe(`Bearer ${id}`);
    expect(JSON.parse(exported.body.raw).id).toBe(id);
    const saved = importData(exportCollection(collectionFor(request))).collections[0].requests[0];
    expect(saved.url).toContain('{{$guid}}'); expect(saved.body.raw).toBe(request.body.raw);
  });

  it('generates image placeholders locally without calling any image service', () => {
    const d = createDynamicResolver();
    for (const name of DYNAMIC_VARIABLE_GROUPS.images.filter(name => name !== '$randomImageDataUri')) {
      const url = new URL(d(name)!); expect(url.protocol).toBe('https:');
      if (name !== '$randomAvatarImage') expect(url.hostname).toBe('picsum.photos');
    }
    expect(d('$randomImageDataUri')).toMatch(/^data:image\/svg\+xml/);
    expect(d('$randomAnimalsImage')).toContain('/seed/animals-');
  });
});
