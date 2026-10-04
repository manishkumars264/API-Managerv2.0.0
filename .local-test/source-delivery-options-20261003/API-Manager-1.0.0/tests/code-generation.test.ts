import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateRequestCode, REQUEST_CODE_LANGUAGES, type RequestCodeLanguage } from '../src/lib/code-generation';
import { exportCurl } from '../src/lib/curl';
import { newRequest, row } from '../src/lib/model';
import type { ApiRequest } from '../src/types';

const run = promisify(execFile);
let server: Server, base: string, directory: string, upload: string;
let received = 0;
interface Echo { method: string; url: string; headers: Record<string, string>; rawHeaders: string[]; body: string; }
beforeAll(async () => {
  const root = path.resolve('.local-test'); await fs.mkdir(root, { recursive: true });
  directory = await fs.mkdtemp(path.join(root, 'code-generation-')); upload = path.join(directory, 'upload.bin');
  await fs.writeFile(upload, Buffer.from([0, 1, 10, 13, 34, 255]));
  server = createServer(async (request, response) => {
    received++; const parts: Buffer[] = []; for await (const chunk of request) parts.push(Buffer.from(chunk));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ method: request.method, url: request.url, headers: request.headers, rawHeaders: request.rawHeaders, body: Buffer.concat(parts).toString('base64') }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (directory && directory.startsWith(path.resolve('.local-test') + path.sep)) await fs.rm(directory, { recursive: true, force: true });
});
const request = (): ApiRequest => ({ ...newRequest('Code example'), url: `${base}/echo?inline=1&dup=url`, params: [row('dup', 'first & value'), row('dup', 'second=value'), { ...row('unused', '{{missing}}'), enabled: false }], headers: [row('X-Repeat', 'first'), row('X-Repeat', 'second'), { ...row('X-Disabled', '{{missing}}'), enabled: false }] });
async function execute(req: ApiRequest, language: 'python' | 'javascript', variables = [row('token', 'secret')]): Promise<Echo> {
  const generated = generateRequestCode(req, language, variables);
  const file = path.join(directory, `${Date.now()}-${Math.random().toString(16).slice(2)}${language === 'python' ? '.py' : '.mjs'}`);
  await fs.writeFile(file, generated.code, 'utf8');
  const result = await run(language === 'python' ? (process.env.API_MANAGER_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')) : process.execPath, [file], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  expect(result.stderr).toContain('200');
  return JSON.parse(result.stdout) as Echo;
}

describe('request code generation', () => {
  it('lists the requested six languages and delegates existing cURL unchanged', () => {
    expect(REQUEST_CODE_LANGUAGES.map(item => item.id)).toEqual(['curl', 'python', 'java', 'javascript', 'c', 'cpp']);
    const req = request(), variables = [row('x', 'resolved')];
    expect(generateRequestCode(req, 'curl', variables).code).toBe(exportCurl(req, variables));
    expect(generateRequestCode(req, 'python').dependencies.join(' ')).toContain('standard library');
  });
  it('rejects invalid URLs, unresolved values and header injection, then recovers after correction', () => {
    const req = request(); req.url = '{{missing}}/echo';
    expect(() => generateRequestCode(req, 'javascript')).toThrow('Unresolved variable');
    req.url = base + '/echo'; req.headers = [row('X-Test', 'value\r\nInjected: yes')];
    expect(() => generateRequestCode(req, 'java')).toThrow('Invalid HTTP header');
    req.headers = [row('X-Test', 'corrected')];
    expect(generateRequestCode(req, 'javascript').code).toContain('corrected');
    req.url = 'file:///private'; expect(() => generateRequestCode(req, 'python')).toThrow('HTTP and HTTPS');
  });
  it('ignores unused form rows and URL-encoded file metadata, matching native body modes', () => {
    const req = request(); req.body.fields = [{ ...row('stale', '{{missing}}'), type: 'file', fileName: '{{missing}}' }];
    for (const language of ['python', 'javascript', 'java', 'c', 'cpp'] as RequestCodeLanguage[]) expect(() => generateRequestCode(req, language)).not.toThrow();
    req.body.mode = 'urlencoded'; req.body.fields = [{ ...row('path', 'literal'), type: 'file', fileName: '{{missing}}', contentType: '{{missing}}' }];
    expect(generateRequestCode(req, 'java').code).toContain('path=literal');
  });
  it('warns and blocks unsupported signing and Fetch GET bodies rather than sending partial requests', async () => {
    const req = request(); req.auth = { type: 'oauth1', fields: { consumerSecret: 'not-exported' } };
    for (const language of ['python', 'javascript', 'java', 'c', 'cpp'] as RequestCodeLanguage[]) {
      const result = generateRequestCode(req, language); expect(result.warnings.join(' ')).toContain('authentication is not generated'); expect(result.code).not.toContain('not-exported');
    }
    req.auth = { type: 'none' }; req.body.mode = 'raw'; req.body.raw = 'GET body';
    const result = generateRequestCode(req, 'javascript'); expect(result.warnings.join(' ')).toContain('GET or HEAD');
    const file = path.join(directory, 'blocked-get.mjs'); await fs.writeFile(file, result.code);
    const before = received; await expect(run(process.execPath, [file], { timeout: 5000 })).rejects.toThrow('Fetch does not allow a body'); expect(received).toBe(before);
  });
  it('preserves UTF-8 and null bytes in libcurl data with explicit byte length and safe string escapes', () => {
    const req = request(); req.method = 'POST'; req.body = { mode: 'raw', language: 'text', raw: '\0\u0001é😀?7"\\\n', fields: [] };
    for (const language of ['c', 'cpp'] as RequestCodeLanguage[]) {
      const code = generateRequestCode(req, language).code;
      expect(code).toContain('"\\000\\001\\303\\251\\360\\237\\230\\200\\?7\\"\\\\\\n"');
      expect(code).toContain('sizeof(body) - 1'); expect(code).not.toContain('strlen(body)');
    }
  });
  it('chunks large Java literals at runtime without splitting surrogate pairs or constant folding', () => {
    const req = request(); req.method = 'POST'; req.body.mode = 'raw'; req.body.raw = 'x'.repeat(7999) + '😀' + 'é'.repeat(40000);
    const code = generateRequestCode(req, 'java').code;
    expect(code).toContain('String.join("", '); expect(code).toContain('😀');
    const literals = [...code.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(match => match[1]);
    expect(Math.max(...literals.map(value => Buffer.byteLength(value, 'utf8')))).toBeLessThan(60000);
    expect(code).not.toMatch(/[\uD800-\uDBFF]"|"[\uDC00-\uDFFF]/);
  });
  it('labels client-specific header restrictions and preserves OAuth2 alias precedence', () => {
    const req = request(); req.headers.push(row('Host', 'custom.example'), row('Content-Length', '999'));
    const java = generateRequestCode(req, 'java'); expect(java.warnings.join(' ')).toContain('restricted headers'); expect(java.warnings.join(' ')).toContain('Content-Length'); expect(java.code).not.toContain('builder.header("Host"');
    expect(generateRequestCode(req, 'javascript').warnings.join(' ')).toContain('repeated header');
    req.auth = { type: 'oauth2', token: 'fallback', fields: { accessToken: '', tokenType: 'Custom', headerPrefix: '' } };
    expect(() => generateRequestCode(req, 'python')).toThrow('access token');
    req.auth.fields!.accessToken = 'provided'; expect(generateRequestCode(req, 'python').code).toContain('Custom provided');
    req.auth.fields = { accesstoken: 'query-token', addTokenTo: 'queryParams', queryParamName: 'oauth_key' };
    expect(generateRequestCode(req, 'javascript').code).toContain('oauth_key=query-token');
  });
  it('makes libcurl HEAD body limitations explicit without discarding body configuration silently', () => {
    const req = request(); req.method = 'HEAD'; req.body.mode = 'raw'; req.body.raw = 'body';
    for (const language of ['c', 'cpp'] as RequestCodeLanguage[]) {
      const generated = generateRequestCode(req, language); expect(generated.warnings.join(' ')).toContain('does not send a request body'); expect(generated.code).toContain('return 1;');
    }
  });
  it('retains scripts/uploads as explicit limitations and never reads files while generating', () => {
    const req = request(); req.method = 'POST'; req.body = { mode: 'binary', language: 'text', raw: '', fields: [], filePath: 'C:\\nonexistent\\upload.bin' }; req.scripts = { preRequest: 'pm.environment.set("x","y")', postResponse: '' };
    const result = generateRequestCode(req, 'python'); expect(result.code).toContain('Path('); expect(result.warnings.join(' ')).toContain('contains scripts'); expect(result.warnings.join(' ')).toContain('Upload paths');
    req.body.mode = 'formdata'; req.body.fields = [{ ...row('upload', 'file.bin'), type: 'file', fileName: 'bad\r\nname' }]; expect(() => generateRequestCode(req, 'javascript')).toThrow('control characters');
  });
  for (const language of ['python', 'javascript'] as const) {
    it(`executes ${language} native defaults for empty Content-Type and URL credential Authorization`, async () => {
      const req = request(); req.method = 'POST'; req.url = base.replace('http://', 'http://url-user:url-pass@') + '/echo'; req.headers = [row('Authorization', ''), row('Content-Type', '')]; req.body = { mode: 'raw', language: 'json', raw: '{"ok":true}', fields: [] };
      const echo = await execute(req, language); expect(echo.headers.authorization).toBe('Basic ' + Buffer.from('url-user:url-pass').toString('base64')); expect(echo.headers['content-type']).toBe('application/json');
    });
    it(`executes ${language} GET with repeated params, enabled headers and Basic UTF-8 credentials`, async () => {
      const req = request(); req.auth = { type: 'basic', username: '汉user', password: 'quote"\\pass' };
      const echo = await execute(req, language); const query = new URL(echo.url, base).searchParams;
      expect(echo.method).toBe('GET'); expect(query.get('inline')).toBe('1'); expect(query.getAll('dup')).toEqual(['first & value', 'second=value']); expect(query.has('unused')).toBe(false);
      expect(echo.headers.authorization).toBe('Basic ' + Buffer.from('汉user:quote"\\pass').toString('base64')); expect(echo.headers['x-disabled']).toBeUndefined();
      if (language === 'python') expect(echo.rawHeaders.filter(value => value.toLowerCase() === 'x-repeat')).toHaveLength(2); else expect(echo.headers['x-repeat']).toBe('first, second');
    });
    it(`executes ${language} raw/SOAP/encoded/binary/multipart bodies without mutating the request`, async () => {
      const req = request(); req.method = 'POST'; req.auth = { type: 'bearer', token: '{{token}}' };
      req.body = { mode: 'raw', language: 'text', raw: 'quote" slash\\ null\0 line\n汉😀', fields: [] }; const snapshot = structuredClone(req);
      let echo = await execute(req, language); expect(Buffer.from(echo.body, 'base64').toString('utf8')).toBe(req.body.raw); expect(echo.headers.authorization).toBe('Bearer secret'); expect(req).toEqual(snapshot);
      req.soap = { version: '1.2', action: 'urn:Echo' }; req.body.language = 'xml'; req.body.raw = '<Envelope><Body>SOAP</Body></Envelope>';
      echo = await execute(req, language); expect(echo.headers['content-type']).toBe('application/soap+xml; charset=utf-8; action="urn:Echo"'); expect(Buffer.from(echo.body, 'base64').toString()).toBe(req.body.raw);
      delete req.soap; req.body = { mode: 'urlencoded', language: 'text', raw: '', fields: [row('same', 'one & two'), row('same', 'three=四')] };
      echo = await execute(req, language); expect(new URLSearchParams(Buffer.from(echo.body, 'base64').toString()).getAll('same')).toEqual(['one & two', 'three=四']);
      req.body = { mode: 'binary', language: 'text', raw: '', fields: [], filePath: upload };
      echo = await execute(req, language); expect(Buffer.from(echo.body, 'base64')).toEqual(await fs.readFile(upload)); expect(echo.headers['content-type']).toBe('application/octet-stream');
      req.body = { mode: 'formdata', language: 'text', raw: '', fields: [row('message', 'first\nsecond'), { ...row('upload', upload), type: 'file', fileName: 'custom.bin', contentType: 'application/x-demo' }] }; req.headers.push(row('Content-Type', 'wrong/boundary'));
      echo = await execute(req, language); const body = Buffer.from(echo.body, 'base64');
      expect(echo.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/); expect(body.toString()).toContain('name="message"'); expect(body.toString()).toContain('first\r\nsecond'); expect(body.toString()).toContain('filename="custom.bin"'); expect(body.toString()).toContain('Content-Type: application/x-demo'); expect(body.includes(await fs.readFile(upload))).toBe(true);
    });
    it(`keeps sampled dynamic values stable across ${language} URL/header/body references`, async () => {
      const req = request(); req.method = 'POST'; req.url = base + '/echo?guid={{$guid}}'; req.params = []; req.headers = [row('X-Guid', '{{$guid}}')]; req.body = { mode: 'raw', language: 'json', raw: '{"guid":"{{$guid}}"}', fields: [] };
      const echo = await execute(req, language); const body = JSON.parse(Buffer.from(echo.body, 'base64').toString()); expect(body.guid).toBe(echo.headers['x-guid']); expect(body.guid).toBe(new URL(echo.url, base).searchParams.get('guid'));
    });
  }
});
