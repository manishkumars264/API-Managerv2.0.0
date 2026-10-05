import { describe, expect, it } from 'vitest';
import { version } from '../package.json';
import { initialWorkspace, newRequest, row } from '../src/lib/model';
import { buildGeneratedHeaders } from '../src/lib/generated-headers';

const setup = () => { const workspace = initialWorkspace(), request = newRequest(); request.url = 'https://example.test/'; return { workspace, request }; };
const header = (preview: ReturnType<typeof buildGeneratedHeaders>, key: string) => preview.headers.find(item => item.key.toLowerCase() === key.toLowerCase());
describe('generated header previews', () => {
  it('shows native defaults without changing saved headers or credentials', () => {
    const { workspace, request } = setup(), before = JSON.stringify({ workspace, request });
    const preview = buildGeneratedHeaders(workspace, request);
    expect(header(preview, 'User-Agent')?.value).toBe(`API-Manager/${version}`);
    expect(header(preview, 'Accept-Encoding')?.value).toBe('gzip, deflate, br');
    expect(header(preview, 'Authorization')).toBeUndefined();
    expect(JSON.stringify({ workspace, request })).toBe(before);
  });
  it('encodes Basic credentials as UTF-8, including empty credentials', () => {
    const { workspace, request } = setup();
    for (const [username, password] of [['Aladdin', 'open sesame'], ['用户', 'päss:🔑'], ['', '']]) {
      request.auth = { type: 'basic', username, password };
      expect(header(buildGeneratedHeaders(workspace, request), 'Authorization')?.value).toBe(`Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`);
    }
  });
  it('uses environment precedence and recursive variables for inherited folder auth', () => {
    const { workspace, request } = setup();
    request.auth = { type: 'inherit' }; request.collectionId = 'collection'; request.folderId = 'folder';
    workspace.globals = [row('token', 'global')];
    workspace.collections = [{ id: 'collection', name: 'Collection', description: '', auth: { type: 'basic', username: 'collection' }, variables: [row('token', 'collection')], requests: [], folders: [{ id: 'folder', name: 'Folder', folders: [], requests: [request], variables: [row('token', 'folder'), row('reference', '{{token}}')], auth: { type: 'bearer', token: '{{reference}}' } }] }];
    workspace.environments = [{ id: 'env', name: 'Development', variables: [row('token', 'environment')] }]; workspace.activeEnvironmentId = 'env';
    const preview = buildGeneratedHeaders(workspace, request);
    expect(header(preview, 'Authorization')).toMatchObject({ value: 'Bearer environment', source: 'Bearer auth (inherited)', status: 'resolved' });
    workspace.activeEnvironmentId = null;
    expect(header(buildGeneratedHeaders(workspace, request), 'Authorization')?.value).toBe('Bearer folder');
  });
  it('shows Bearer credentials replacing case-insensitive custom Authorization without mutating rows', () => {
    const { workspace, request } = setup(); request.auth = { type: 'bearer', token: 'latest' }; request.headers = [row('aUtHoRiZaTiOn', 'old'), row('Authorization', 'older')];
    const preview = buildGeneratedHeaders(workspace, request);
    expect(preview.headers.filter(item => item.key === 'Authorization')).toHaveLength(1);
    expect(header(preview, 'Authorization')).toMatchObject({ value: 'Bearer latest', note: 'Replaces custom Authorization header.' });
    expect(request.headers.map(item => item.value)).toEqual(['old', 'older']);
  });
  it('resolves header API keys and distinguishes query keys', () => {
    const { workspace, request } = setup(); workspace.globals = [row('key', 'X-Api-Key'), row('secret', '123')];
    request.auth = { type: 'apikey', key: '{{key}}', value: '{{secret}}', in: 'header' };
    expect(header(buildGeneratedHeaders(workspace, request), 'X-Api-Key')?.value).toBe('123');
    request.auth.in = 'query';
    const preview = buildGeneratedHeaders(workspace, request); expect(header(preview, 'X-Api-Key')).toBeUndefined();
    expect(preview.notes.join(' ')).toContain('X-Api-Key query parameter');
  });
  it('supports OAuth 2 token aliases and custom prefixes without resolving unused acquisition fields', () => {
    const { workspace, request } = setup();
    for (const alias of ['accessToken', 'accesstoken', 'token']) {
      request.auth = { type: 'oauth2', fields: { [alias]: 'access-123', headerPrefix: 'Token', clientSecret: '{{unused}}', tokenUrl: '{{unused}}' } };
      expect(header(buildGeneratedHeaders(workspace, request), 'Authorization')?.value).toBe('Token access-123');
    }
    request.auth = { type: 'oauth2', token: 'flat-token', fields: { tokenType: 'MAC' } };
    expect(header(buildGeneratedHeaders(workspace, request), 'Authorization')?.value).toBe('MAC flat-token');
    request.auth.fields = { accessToken: 'nested-token', addTokenTo: 'queryParams', queryParamName: 'credential' };
    const preview = buildGeneratedHeaders(workspace, request); expect(header(preview, 'Authorization')).toBeUndefined();
    expect(preview.notes.join(' ')).toContain('credential query parameter');
  });
  it('marks missing OAuth tokens and invalid/unresolved credentials unavailable', () => {
    const { workspace, request } = setup();
    for (const auth of [{ type: 'oauth2' as const }, { type: 'bearer' as const, token: '{{missing}}' }, { type: 'bearer' as const, token: 'bad\r\nheader' }]) {
      request.auth = auth; expect(header(buildGeneratedHeaders(workspace, request), 'Authorization')).toMatchObject({ status: 'error', value: 'Unavailable' });
    }
    workspace.globals = [row('a', '{{b}}'), row('b', '{{a}}')]; request.auth = { type: 'bearer', token: '{{a}}' };
    expect(header(buildGeneratedHeaders(workspace, request), 'Authorization')?.note).toContain('Circular variable');
  });
  it('never generates or consumes dynamic credentials in a preview', () => {
    const { workspace, request } = setup(); workspace.globals = [row('token', '{{ $guid }}')]; request.auth = { type: 'bearer', token: '{{token}}' };
    const preview = buildGeneratedHeaders(workspace, request);
    expect(header(preview, 'Authorization')).toMatchObject({ status: 'pending', value: 'Generated when sent' });
    expect(buildGeneratedHeaders(workspace, request)).toEqual(preview);
    expect(workspace.globals[0].value).toBe('{{ $guid }}');
  });
  for (const type of ['digest', 'ntlm', 'oauth1', 'hawk', 'awsv4', 'edgegrid', 'jwt', 'asap'] as const) {
    it(`${type} defers signing/challenges to Send`, () => {
      const { workspace, request } = setup(); request.auth = { type, fields: { secret: '{{undefined}}' } };
      const preview = buildGeneratedHeaders(workspace, request); expect(header(preview, 'Authorization')).toBeUndefined();
      expect(preview.notes.join(' ')).toContain('generated when sent');
    });
  }
  for (const [mode, language, expected] of [['raw', 'json', 'application/json'], ['raw', 'xml', 'application/xml'], ['raw', 'html', 'text/html'], ['raw', 'javascript', 'application/javascript'], ['raw', 'text', 'text/plain'], ['urlencoded', 'json', 'application/x-www-form-urlencoded'], ['binary', 'json', 'application/octet-stream']] as const) {
    it(`shows native content type for ${mode}/${language} and respects custom/disabled/empty headers`, () => {
      const { workspace, request } = setup(); request.body.mode = mode; request.body.language = language;
      expect(header(buildGeneratedHeaders(workspace, request), 'Content-Type')?.value).toBe(expected);
      request.headers = [row('cOnTeNt-TyPe', 'application/custom')];
      expect(header(buildGeneratedHeaders(workspace, request), 'Content-Type')).toBeUndefined();
      request.headers[0].enabled = false;
      expect(header(buildGeneratedHeaders(workspace, request), 'Content-Type')?.value).toBe(expected);
      request.headers[0].enabled = true; request.headers[0].value = '';
      expect(header(buildGeneratedHeaders(workspace, request), 'Content-Type')?.value).toBe(expected);
    });
  }
  it('marks multipart boundary pending and removes any auth-produced framing headers', () => {
    const { workspace, request } = setup(); request.body.mode = 'formdata'; request.auth = { type: 'apikey', key: 'Content-Type', value: 'custom' }; request.headers = [row('Content-Length', '123')];
    const preview = buildGeneratedHeaders(workspace, request);
    expect(preview.headers.filter(item => item.key === 'Content-Type')).toHaveLength(1);
    expect(header(preview, 'Content-Type')).toMatchObject({ status: 'pending', source: 'Multipart body' });
    expect(header(preview, 'Content-Length')).toBeUndefined();
  });
  it('uses URL credentials only when Authorization is absent or empty', () => {
    const { workspace, request } = setup(); request.url = 'https://alice:p%40ss@example.test/';
    expect(header(buildGeneratedHeaders(workspace, request), 'Authorization')?.value).toBe('Basic YWxpY2U6cEBzcw==');
    request.headers = [row('authorization', 'Custom credential')];
    expect(header(buildGeneratedHeaders(workspace, request), 'Authorization')).toBeUndefined();
    request.headers[0].value = ''; expect(header(buildGeneratedHeaders(workspace, request), 'Authorization')?.source).toBe('URL credentials');
  });
});
