'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { RequestEngine, resolveVariables } = require('../electron/request.cjs');
const { WorkspaceStore } = require('../electron/store.cjs');

const row = (key, value, extras = {}) => ({ id: crypto.randomUUID(), key, value, enabled: true, ...extras });
function payload(url, extra = {}) {
  return {
    requestId: crypto.randomUUID(), variables: [], settings: { theme: 'dark', timeout: 3000, followRedirects: true, verifySsl: true, maxResponseMB: 20 },
    request: { id: crypto.randomUUID(), name: 'Test', method: 'GET', url, params: [], headers: [], auth: { type: 'none' }, description: '', body: { mode: 'none', raw: '', language: 'json', fields: [] } },
    ...extra
  };
}
let server, redirectServer, origin, redirectOrigin;
const ntlmSockets = new WeakMap();
function ntlmChallenge() {
  const bytes = Buffer.alloc(52); bytes.write('NTLMSSP\0', 0, 'ascii'); bytes.writeUInt32LE(2, 8); bytes.writeUInt32LE(0x00880001, 20);
  Buffer.from('0123456789abcdef', 'hex').copy(bytes, 24); bytes.writeUInt16LE(4, 40); bytes.writeUInt16LE(4, 42); bytes.writeUInt32LE(48, 44);
  return 'NTLM ' + bytes.toString('base64');
}
test.before(async () => {
  redirectServer = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ method: req.method, headers: req.headers, url: req.url })); });
  redirectServer.listen(0, '127.0.0.1'); await once(redirectServer, 'listening'); redirectOrigin = `http://127.0.0.1:${redirectServer.address().port}`;
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/slow') { const timer = setTimeout(() => res.end('done'), 1500); req.on('close', () => clearTimeout(timer)); return; }
    if (pathname === '/redirect-external') { res.writeHead(302, { location: redirectOrigin }); res.end(); return; }
    if (pathname === '/redirect-copy-query') { res.writeHead(302, { location: `${redirectOrigin}/echo${new URL(req.url, origin).search}` }); res.end(); return; }
    if (pathname === '/digest') {
      const attrs = Object.fromEntries([...(req.headers.authorization || '').matchAll(/([a-z]+)=(?:"([^"]*)"|([^,\s]+))/gi)].map(match => [match[1], match[2] ?? match[3]]));
      const hash = value => crypto.createHash('sha256').update(value).digest('hex');
      const expected = hash(`${hash('user:API Manager:pass')}:nonce:${attrs.nc}:${attrs.cnonce}:auth:${hash(`${req.method}:${req.url}`)}`);
      if (!req.headers.authorization?.startsWith('Digest ') || attrs.response !== expected) { res.writeHead(401, { 'www-authenticate': 'Digest realm="API Manager", nonce="nonce", qop="auth", algorithm=SHA-256' }); res.end('challenge'); return; }
    }
    if (pathname === '/ntlm') {
      const bytes = Buffer.from((req.headers.authorization || '').slice(5), 'base64'), kind = bytes.length >= 12 ? bytes.readUInt32LE(8) : 0;
      if (kind === 1) { ntlmSockets.set(req.socket, true); res.writeHead(401, { 'www-authenticate': ntlmChallenge() }); res.end('challenge'); return; }
      if (kind !== 3 || !ntlmSockets.get(req.socket)) { res.writeHead(401, { 'www-authenticate': 'NTLM' }); res.end('wrong connection'); return; }
    }
    if (pathname === '/redirect-303' || pathname === '/redirect-307') { res.writeHead(pathname.endsWith('303') ? 303 : 307, { location: '/echo' }); res.end(); return; }
    if (pathname === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); return; }
    if (pathname === '/cookies') { res.setHeader('set-cookie', ['first=one; HttpOnly; Path=/', 'second=two; Path=/']); res.end('cookies stored'); return; }
    if (pathname === '/duplicates') { res.writeHead(200, ['Content-Type', 'text/plain', 'X-Repeat', 'one', 'X-Repeat', 'two']); res.end('hello'); return; }
    if (pathname === '/gzip') { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.end(zlib.gzipSync('{"compressed":true}')); return; }
    if (pathname === '/large-gzip') { res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' }); res.end(zlib.gzipSync('a'.repeat(16384))); return; }
    if (pathname === '/binary') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from([0, 255, 1, 2])); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (pathname === '/soap') {
      const soap12 = req.headers['content-type'].startsWith('application/soap+xml');
      const namespace = soap12 ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/';
      res.setHeader('content-type', soap12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8');
      res.setHeader('x-request-content-type', req.headers['content-type']);
      if (req.headers.soapaction) res.setHeader('x-request-soapaction', req.headers.soapaction);
      res.setHeader('x-request-method', req.method);
      res.end(`<soap:Envelope xmlns:soap="${namespace}"><soap:Body><EchoResponse>${body.toString('utf8').includes('Hello SOAP') ? 'Hello SOAP' : 'missing'}</EchoResponse></soap:Body></soap:Envelope>`); return;
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, rawHeaders: req.rawHeaders, body: body.toString('utf8'), bytes: body.toString('base64') }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.closeAllConnections(); redirectServer.closeAllConnections(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => redirectServer.close(resolve))]); });

test('real HTTP resolves recursive variables, enabled params, duplicate headers and bearer auth', async () => {
  const engine = new RequestEngine(), data = payload('{{base}}/echo?keep=original&tag=old');
  data.variables = [row('base', '{{origin}}'), row('origin', origin), row('token', 'secret'), row('disabled', 'ignored', { enabled: false })];
  data.request.params = [row('tag', 'first'), row('tag', 'two words'), row('unused', 'skip', { enabled: false })];
  data.request.headers = [row('X-Repeat', 'one'), row('X-Repeat', 'two')]; data.request.auth = { type: 'bearer', token: '{{token}}' };
  const response = await engine.send(data), echo = JSON.parse(response.body);
  assert.equal(response.status, 200); assert.equal(echo.url, '/echo?keep=original&tag=first&tag=two+words'); assert.equal(echo.headers.authorization, 'Bearer secret');
  assert.equal(echo.rawHeaders.filter(value => value.toLowerCase() === 'x-repeat').length, 2);
});
test('dynamic values remain stable across URL, headers, body and authorization within a flight', async () => {
  const engine = new RequestEngine(), data = payload(`${origin}/echo/{{$randomUUID}}?id={{$randomUUID}}&email={{$randomEmail}}`);
  data.request.method = 'POST'; data.request.headers = [row('X-Email', '{{$randomEmail}}')];
  data.request.auth = { type: 'bearer', token: '{{$randomUUID}}' };
  data.request.body = { mode: 'raw', language: 'json', raw: '{"id":"{{$randomUUID}}","email":"{{$randomEmail}}","time":{{$timestamp}}}', fields: [] };
  const first = JSON.parse((await engine.send(data)).body), body = JSON.parse(first.body), url = new URL(first.url, origin);
  assert.equal(url.pathname, `/echo/${body.id}`); assert.equal(url.searchParams.get('id'), body.id);
  assert.equal(url.searchParams.get('email'), body.email); assert.equal(first.headers['x-email'], body.email); assert.equal(first.headers.authorization, `Bearer ${body.id}`);
  assert.match(body.id, /^[0-9a-f-]{36}$/i); assert.ok(Number.isInteger(body.time));
  const second = JSON.parse((await engine.send({ ...data, requestId: crypto.randomUUID() })).body);
  assert.notEqual(JSON.parse(second.body).id, body.id);
  const explicit = payload(`${origin}/echo?id={{$randomUUID}}`, { variables: [row('$randomUUID', 'explicit-value')] });
  assert.equal(JSON.parse((await engine.send(explicit)).body).url, '/echo?id=explicit-value');
});
test('supports raw JSON, duplicate URL-encoded form keys, multipart files and binary uploads', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'api-manager-upload-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true })); const filePath = path.join(directory, 'upload.txt'); await fs.writeFile(filePath, 'file contents');
  const engine = new RequestEngine();
  for (const mode of ['raw', 'urlencoded', 'formdata', 'binary']) {
    const data = payload(`${origin}/echo`); data.variables = [row('word', 'hello')]; data.request.method = 'POST';
    data.request.body = { mode, raw: '{"word":"{{word}}"}', language: 'json', fields: [row('word', '{{word}}'), row('word', 'again')], filePath };
    if (mode === 'formdata') { data.request.body.fields.push(row('attachment', filePath, { type: 'file', fileName: 'renamed.txt', contentType: 'text/plain' })); data.request.headers.push(row('Content-Type', 'multipart/form-data; boundary=wrong')); }
    const response = await engine.send(data), echo = JSON.parse(response.body);
    if (mode === 'raw') { assert.equal(echo.body, '{"word":"hello"}'); assert.equal(echo.headers['content-type'], 'application/json'); }
    if (mode === 'urlencoded') assert.equal(echo.body, 'word=hello&word=again');
    if (mode === 'formdata') { assert.match(echo.headers['content-type'], /^multipart\/form-data; boundary=/); assert.match(echo.body, /filename="renamed.txt"/); assert.match(echo.body, /file contents/); }
    if (mode === 'binary') assert.equal(echo.bytes, Buffer.from('file contents').toString('base64'));
  }
});
test('raw response header duplicates survive and compressed JSON is decoded', async () => {
  const engine = new RequestEngine();
  const duplicates = await engine.send(payload(`${origin}/duplicates`));
  assert.deepEqual(duplicates.headers.filter(row => row.key.toLowerCase() === 'x-repeat').map(row => row.value), ['one', 'two']);
  const compressed = await engine.send(payload(`${origin}/gzip`)); assert.deepEqual(JSON.parse(compressed.body), { compressed: true }); assert.equal(compressed.binary, false);
});
test('SOAP 1.1 and 1.2 send XML envelopes with version-specific headers and receive XML', async () => {
  const engine = new RequestEngine();
  for (const version of ['1.1', '1.2']) {
    const data = payload(`${origin}/soap`); data.request.method = 'POST';
    data.request.soap = { version, action: 'urn:Echo' };
    const namespace = version === '1.1' ? 'http://schemas.xmlsoap.org/soap/envelope/' : 'http://www.w3.org/2003/05/soap-envelope';
    data.request.body = { mode: 'raw', language: 'xml', raw: `<soap:Envelope xmlns:soap="${namespace}"><soap:Body><Echo>Hello SOAP</Echo></soap:Body></soap:Envelope>`, fields: [] };
    const contentType = version === '1.1' ? 'text/xml; charset=utf-8' : 'application/soap+xml; charset=utf-8; action="urn:Echo"';
    data.request.headers = [row('Content-Type', contentType)];
    if (version === '1.1') data.request.headers.push(row('SOAPAction', '"urn:Echo"'));
    const response = await engine.send(data);
    assert.equal(response.status, 200); assert.equal(response.binary, false); assert.match(response.body, /<EchoResponse>Hello SOAP<\/EchoResponse>/);
    assert.ok(response.body.includes(`xmlns:soap="${namespace}"`));
    assert.equal(response.headers.find(header => header.key.toLowerCase() === 'x-request-content-type').value, contentType);
    assert.equal(response.headers.find(header => header.key.toLowerCase() === 'x-request-method').value, 'POST');
    assert.equal(response.headers.find(header => header.key.toLowerCase() === 'x-request-soapaction')?.value, version === '1.1' ? '"urn:Echo"' : undefined);
  }
  const invalid = payload(`${origin}/soap`); invalid.request.soap = { version: '2.0', action: '' };
  await assert.rejects(engine.send(invalid), /Invalid SOAP version/);
});
test('response limits apply after decompression and binary bodies are base64', async () => {
  const engine = new RequestEngine(), data = payload(`${origin}/large-gzip`); data.settings.maxResponseMB = 0.001;
  const limited = await engine.send(data); assert.equal(limited.truncated, true); assert.equal(Buffer.byteLength(limited.body), Math.floor(0.001 * 1024 * 1024));
  const binary = await engine.send(payload(`${origin}/binary`)); assert.equal(binary.binary, true); assert.equal(binary.body, 'AP8BAg==');
});
test('redirects strip credentials across origins and preserve or transform methods correctly', async () => {
  const engine = new RequestEngine(), data = payload(`${origin}/redirect-external`);
  data.request.auth = { type: 'apikey', key: 'X-Custom-Secret', value: 'private', in: 'header' };
  data.request.headers = [row('Authorization', 'Bearer secret'), row('Cookie', 'private=yes')];
  const redirected = JSON.parse((await engine.send(data)).body);
  assert.equal(redirected.headers.authorization, undefined); assert.equal(redirected.headers.cookie, undefined); assert.equal(redirected.headers['x-custom-secret'], undefined);
  for (const [code, method, body] of [['303', 'GET', ''], ['307', 'POST', 'keep this']]) {
    const data = payload(`${origin}/redirect-${code}`); data.request.method = 'POST'; data.request.body.mode = 'raw'; data.request.body.raw = 'keep this'; data.request.body.language = 'text';
    const echo = JSON.parse((await engine.send(data)).body); assert.equal(echo.method, method); assert.equal(echo.body, body);
  }
  const noFollow = payload(`${origin}/redirect-303`); noFollow.settings.followRedirects = false; assert.equal((await engine.send(noFollow)).status, 303);
  await assert.rejects(engine.send(payload(`${origin}/loop`)), /Too many redirects/);
});
test('timeout, explicit cancellation and duplicate in-flight IDs are handled', async () => {
  const engine = new RequestEngine(), slow = payload(`${origin}/slow`); slow.settings.timeout = 30;
  await assert.rejects(engine.send(slow), /timed out after 30 ms/);
  const cancelled = payload(`${origin}/slow`), pending = engine.send(cancelled);
  await assert.rejects(engine.send(cancelled), /already running/); engine.cancel(cancelled.requestId); await assert.rejects(pending, /cancelled/); assert.equal(engine.active.size, 0);
});
test('Digest and NTLM challenges retry through the actual transport and retain the NTLM socket', async () => {
  const engine = new RequestEngine();
  for (const type of ['digest', 'ntlm']) {
    const data = payload(`${origin}/${type}`); data.request.auth = { type, fields: { username: 'user', password: 'pass', domain: 'domain', workstation: 'workstation' } };
    const response = await engine.send(data); assert.equal(response.status, 200);
    const echo = JSON.parse(response.body); assert.match(echo.headers.authorization, type === 'digest' ? /^Digest / : /^NTLM /);
    if (type === 'ntlm') assert.equal(Buffer.from(echo.headers.authorization.slice(5), 'base64').readUInt32LE(8), 3);
  }
  const wrong = payload(`${origin}/digest`); wrong.request.auth = { type: 'digest', fields: { username: 'user', password: 'wrong' } };
  assert.equal((await engine.send(wrong)).status, 401);
});
test('advanced tokens are applied on same-origin redirects and stripped on cross-origin redirects', async () => {
  const engine = new RequestEngine(), same = payload(`${origin}/redirect-307`);
  same.request.auth = { type: 'oauth2', fields: { accessToken: '{{token}}', addTokenTo: 'queryParams' } }; same.variables = [row('token', 'private')];
  const echo = JSON.parse((await engine.send(same)).body); assert.equal(new URL(echo.url, origin).searchParams.get('access_token'), 'private');
  const crossing = payload(`${origin}/redirect-copy-query`); crossing.request.auth = same.request.auth; crossing.variables = same.variables;
  const redirected = JSON.parse((await engine.send(crossing)).body); assert.equal(new URL(redirected.url, redirectOrigin).searchParams.has('access_token'), false); assert.equal(redirected.headers.authorization, undefined);
  const jwt = payload(`${origin}/echo`); jwt.request.auth = { type: 'jwt', fields: { secret: 'local-test-secret', payload: '{"sub":"test"}' } };
  assert.match(JSON.parse((await engine.send(jwt)).body).headers.authorization, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});
test('cookie jar persists across launches and supports domain clearing', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'api-manager-cookies-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkspaceStore(directory), first = new RequestEngine({ store }); await first.initialize(); await first.send(payload(`${origin}/cookies`)); await first.flush();
  assert.equal((await first.getCookies()).length, 2);
  const restored = new RequestEngine({ store }); await restored.initialize();
  const echo = JSON.parse((await restored.send(payload(`${origin}/echo`))).body); assert.equal(echo.headers.cookie, 'first=one; second=two');
  await restored.clearCookies('127.0.0.1'); assert.deepEqual(await restored.getCookies(), []);
  const cleared = new RequestEngine({ store }); await cleared.initialize(); assert.deepEqual(await cleared.getCookies(), []);
});
test('variables reject unresolved tokens and cycles before contacting the server', async () => {
  assert.throws(() => resolveVariables('{{missing}}', []), /Unresolved variable/);
  assert.throws(() => resolveVariables('{{a}}', [row('a', '{{b}}'), row('b', '{{a}}')]), /Circular variable/);
  const resolve = resolveVariables(null, []); assert.equal(resolve('{{$guid}}'), resolve('{{$guid}}')); assert.match(resolve('{{$timestamp}}'), /^\d+$/);
  const engine = new RequestEngine(); await assert.rejects(engine.send(payload('file:///etc/passwd')), /Only HTTP/);
  const invalid = payload(`${origin}/echo`); invalid.request.headers.push(row('X-Bad', 'one\r\ninjected: yes')); await assert.rejects(engine.send(invalid), /Invalid HTTP header/);
});

// A small generated X.509 certificate avoids depending on OpenSSL or external fixtures.
function selfSignedCertificate() {
  const length = size => size < 128 ? Buffer.from([size]) : (() => { const hex = size.toString(16).padStart(Math.ceil(size.toString(16).length / 2) * 2, '0'); const bytes = Buffer.from(hex, 'hex'); return Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes]); })();
  const der = (tag, ...parts) => { const value = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), length(value.length), value]); };
  const sequence = (...parts) => der(0x30, ...parts), integer = byte => der(0x02, Buffer.from([byte]));
  const algorithm = sequence(Buffer.from('06092a864886f70d01010b', 'hex'), der(0x05, Buffer.alloc(0)));
  const name = sequence(der(0x31, sequence(Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('API Manager Test')))));
  const date = offset => { const d = new Date(Date.now() + offset); return der(0x17, Buffer.from(d.toISOString().replace(/[-:]/g, '').slice(2, 8) + d.toISOString().replace(/[-:]/g, '').slice(9, 15) + 'Z')); };
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const san = sequence(Buffer.from('0603551d11', 'hex'), der(0x04, sequence(der(0x87, Buffer.from([127, 0, 0, 1])))));
  const tbs = sequence(der(0xa0, integer(2)), integer(1), algorithm, name, sequence(date(-86400000), date(86400000)), name, keys.publicKey.export({ type: 'spki', format: 'der' }), der(0xa3, sequence(san)));
  const certificate = sequence(tbs, algorithm, der(0x03, Buffer.from([0]), crypto.sign('sha256', tbs, keys.privateKey)));
  return { key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: `-----BEGIN CERTIFICATE-----\n${certificate.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n` };
}
test('SSL verification is enabled by default and can be deliberately disabled', async t => {
  const tlsServer = https.createServer(selfSignedCertificate(), (_req, res) => res.end('tls works'));
  tlsServer.listen(0, '127.0.0.1'); await once(tlsServer, 'listening'); t.after(() => { tlsServer.closeAllConnections(); return new Promise(resolve => tlsServer.close(resolve)); });
  const engine = new RequestEngine(), url = `https://127.0.0.1:${tlsServer.address().port}`;
  await assert.rejects(engine.send(payload(url)), /self.signed certificate/i);
  const data = payload(url); data.settings.verifySsl = false; assert.equal((await engine.send(data)).body, 'tls works');
});
