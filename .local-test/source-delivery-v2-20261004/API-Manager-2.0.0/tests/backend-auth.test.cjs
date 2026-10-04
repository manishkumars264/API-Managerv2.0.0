'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const Hawk = require('@hapi/hawk');
const { applyAdvancedAuth, challengeAuth, acquireOAuth2Token, jwtToken } = require('../electron/auth.cjs');

const prepared = (url = 'https://example.com/resource?x=1', method = 'GET', body = null, headers = []) => ({ url: new URL(url), method, body, headers, credentialHeaders: new Set() });
const authHeader = result => result.headers.find(row => row.key.toLowerCase() === 'authorization')?.value;
const auth = (type, fields) => ({ type, fields });
const decodeJwt = token => { const [header, payload, signature] = token.split('.'); return { header: JSON.parse(Buffer.from(header, 'base64url')), payload: JSON.parse(Buffer.from(payload, 'base64url')), signature: Buffer.from(signature, 'base64url'), input: Buffer.from(`${header}.${payload}`) }; };

test('Digest MD5 matches the RFC 2617 published example and handles stale bounded retries', () => {
  const request = prepared('http://www.example.com/dir/index.html');
  const credentials = auth('digest', { username: 'Mufasa', password: 'Circle Of Life', cnonce: '0a4f113b' });
  const challenge = [{ key: 'WWW-Authenticate', value: 'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"' }];
  const headers = challengeAuth(credentials, request, challenge, 1);
  assert.match(authHeader({ headers }), /response="6629fae49393a05397450978507c4ef1"/);
  assert.match(authHeader({ headers }), /nc=00000001/);
  assert.equal(challengeAuth(credentials, request, challenge, 2), null);
  assert.equal(challengeAuth(credentials, request, challenge, 3), null);
  const stale = [{ key: 'www-authenticate', value: challenge[0].value + ', stale=true' }];
  assert.match(authHeader({ headers: challengeAuth(credentials, request, stale, 2) }), /nc=00000002/);
});

test('Digest SHA-256 auth-int changes with the actual body bytes and rejects unknown algorithms', () => {
  const credentials = auth('digest', { username: 'user', password: 'secret', cnonce: 'fixed' });
  const challenge = { 'www-authenticate': 'Digest realm="realm", nonce="nonce", algorithm=SHA-256, qop="auth-int", charset=UTF-8' };
  const first = authHeader({ headers: challengeAuth(credentials, prepared('https://example.com/a', 'POST', Buffer.from([0, 255])), challenge, 1) });
  const second = authHeader({ headers: challengeAuth(credentials, prepared('https://example.com/a', 'POST', Buffer.from([0, 254])), challenge, 1) });
  assert.notEqual(first, second);
  assert.match(first, /algorithm=SHA-256/);
  assert.throws(() => challengeAuth(credentials, prepared(), { 'www-authenticate': 'Digest nonce="nonce",algorithm=UNKNOWN' }, 1), /Unsupported Digest/);
});

test('OAuth 1 HMAC-SHA1 matches RFC 5849 with repeated query/body parameters', async () => {
  const request = prepared('http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b', 'POST', 'c2&a3=2+q', [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }]);
  const signed = await applyAdvancedAuth(request, auth('oauth1', { consumerKey: '9djdj82h48djs9d2', consumerSecret: 'j49sk3j29djd', accessToken: 'kkk9d7dh3k39sjv7', tokenSecret: 'dh893hdasih9', nonce: '7d8f3e4a', timestamp: '137131201', signatureMethod: 'HMAC-SHA1', version: '' }));
  assert.match(authHeader(signed), /oauth_signature="r6%2FTJjbCOr97%2F%2BUU0NsvSne7s5g%3D"/);
  assert.equal(request.headers.some(row => row.key === 'Authorization'), false);
  assert.equal(signed.credentialHeaders.has('authorization'), true);
});

test('OAuth 1 query signing contains only OAuth auth attributes and changes when body data changes', async () => {
  const credentials = auth('oauth1', { consumerKey: 'key', consumerSecret: 'secret', signatureMethod: 'HMAC-SHA256', nonce: 'fixed', timestamp: '100', addParamsToHeader: 'false' });
  const first = await applyAdvancedAuth(prepared('https://example.com/?query=value', 'POST', 'body=first', [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }]), credentials);
  const second = await applyAdvancedAuth(prepared('https://example.com/?query=value', 'POST', 'body=second', [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }]), credentials);
  assert.notEqual(first.url.searchParams.get('oauth_signature'), second.url.searchParams.get('oauth_signature'));
  assert.equal(first.url.searchParams.get('body'), null);
  assert.equal(first.url.searchParams.get('query'), 'value');
  assert.equal(first.credentialQueryKeys.has('oauth_signature'), true);
});

test('Hawk MAC and payload hash authenticate with the Hawk server verifier', async () => {
  const credentials = { id: 'client', key: 'secret-shared-key', algorithm: 'sha256' };
  const body = Buffer.from([65, 0, 255, 66]);
  const request = prepared('https://example.com/upload?x=1', 'POST', body, [{ key: 'Content-Type', value: 'application/octet-stream' }]);
  const signed = await applyAdvancedAuth(request, auth('hawk', { authId: credentials.id, key: credentials.key, algorithm: credentials.algorithm, includePayloadHash: 'true', nonce: 'fixed', ext: 'app data' }));
  const headers = Object.fromEntries(signed.headers.map(row => [row.key.toLowerCase(), row.value])); headers.host = 'example.com';
  const verified = await Hawk.server.authenticate({ method: 'POST', url: '/upload?x=1', headers, connection: { encrypted: true } }, async id => { assert.equal(id, credentials.id); return credentials; }, { payload: body });
  assert.equal(verified.artifacts.ext, 'app data');
  await assert.rejects(Hawk.server.authenticate({ method: 'POST', url: '/different', headers, connection: { encrypted: true } }, async () => credentials, { payload: body }), /Bad mac/);
});
test('Hawk accepts the Postman authKey and extraData field aliases', async () => {
  const source = prepared('https://example.com/resource'), fixed = { authId: 'client', algorithm: 'sha256', nonce: 'fixed', timestamp: '1700000000' };
  const canonical = await applyAdvancedAuth(source, auth('hawk', { ...fixed, key: 'shared-secret', ext: 'app-data' }));
  const imported = await applyAdvancedAuth(source, auth('hawk', { ...fixed, authKey: 'shared-secret', extraData: 'app-data' }));
  assert.equal(authHeader(imported), authHeader(canonical));
});

test('AWS Signature V4 matches the published IAM ListUsers signing vector', async () => {
  const request = prepared('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08', 'GET', null, [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded; charset=utf-8' }, { key: 'X-Amz-Date', value: '20150830T123600Z' }]);
  const signed = await applyAdvancedAuth(request, auth('awsv4', { accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'iam' }));
  assert.match(authHeader(signed), /Credential=AKIDEXAMPLE\/20150830\/us-east-1\/iam\/aws4_request/);
  assert.match(authHeader(signed), /Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7/);
});

test('AWS query signatures include session token, preserve duplicate params, and hash binary bodies', async () => {
  const credentials = auth('awsv4', { accessKey: 'key', secretKey: 'secret', service: 's3', region: 'us-east-1', signQuery: 'true', sessionToken: 'session', timestamp: '20200101T000000Z', expires: '300' });
  const signed = await applyAdvancedAuth(prepared('https://bucket.s3.amazonaws.com/path?x=1&x=2', 'PUT', Buffer.from([0, 255])), credentials);
  assert.equal(signed.url.searchParams.get('X-Amz-Security-Token'), 'session');
  assert.equal(signed.url.searchParams.get('X-Amz-Expires'), '300');
  assert.equal(signed.credentialQueryKeys.has('X-Amz-Signature'), true);
  assert.ok(signed.url.searchParams.get('X-Amz-Signature'));
});

test('EdgeGrid signature verifies independently using actual binary bytes and signed headers', async () => {
  const request = prepared('https://example.com/resource?q=1', 'POST', Buffer.from([0, 255, 1]), [{ key: 'Content-Type', value: 'application/octet-stream' }, { key: 'X-Custom', value: '  a   b ' }]);
  const fields = { clientToken: 'client', clientSecret: 'secret', accessToken: 'access', nonce: 'fixed', timestamp: '20200101T00:00:00+0000', headersToSign: 'X-Custom' };
  const signed = await applyAdvancedAuth(request, auth('edgegrid', fields));
  const unsigned = 'EG1-HMAC-SHA256 client_token=client;access_token=access;timestamp=20200101T00:00:00+0000;nonce=fixed;';
  const bodyHash = crypto.createHash('sha256').update(request.body).digest('base64');
  const signingKey = crypto.createHmac('sha256', fields.clientSecret).update(fields.timestamp).digest('base64');
  const data = ['POST', 'https', 'example.com', '/resource?q=1', 'x-custom:a b', bodyHash, unsigned].join('\t');
  const signature = crypto.createHmac('sha256', signingKey).update(data).digest('base64');
  assert.equal(authHeader(signed), unsigned + 'signature=' + signature);
  assert.equal(signed.headers.find(row => row.key === 'Content-Type').value, 'application/octet-stream');
});

test('JWT HS256 matches a published JWT example and rejects algorithm none', () => {
  const token = jwtToken({ algorithm: 'HS256', secret: 'your-256-bit-secret', payload: '{"sub":"1234567890","name":"John Doe","iat":1516239022}' });
  assert.equal(token, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  assert.throws(() => jwtToken({ algorithm: 'none', payload: '{}' }), /JWT signing supports/);
});

test('JWT RSA, ECDSA JOSE encoding, and PSS signatures verify with public keys', () => {
  for (const algorithm of ['RS256', 'PS256', 'ES256']) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync(algorithm === 'ES256' ? 'ec' : 'rsa', algorithm === 'ES256' ? { namedCurve: 'prime256v1' } : { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const decoded = decodeJwt(jwtToken({ algorithm, privateKey: pem, payload: '{"ok":true}' }));
    assert.equal(decoded.header.alg, algorithm);
    const options = { key: publicKey, ...(algorithm === 'ES256' ? { dsaEncoding: 'ieee-p1363' } : {}), ...(algorithm === 'PS256' ? { padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST } : {}) };
    assert.equal(crypto.verify('sha256', decoded.input, options, decoded.signature), true);
    if (algorithm === 'ES256') assert.equal(decoded.signature.length, 64);
  }
});

test('ASAP creates a verified RSA token with required issuer, audience, key ID, expiry, and token ID', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signed = await applyAdvancedAuth(prepared(), auth('asap', { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), issuer: 'service', audience: 'target', keyId: 'service/key', issuedAt: '100', expiry: '60', jwtId: 'fixed' }));
  const decoded = decodeJwt(authHeader(signed).slice(7));
  assert.equal(crypto.verify('sha256', decoded.input, publicKey, decoded.signature), true);
  assert.equal(decoded.header.kid, 'service/key');
  assert.deepEqual(decoded.payload, { iss: 'service', aud: 'target', iat: 100, exp: 160, jti: 'fixed' });
});

test('JWT and OAuth2 support query tokens and variable resolution without leaking credentials into the original object', async () => {
  const request = prepared();
  const oauth = await applyAdvancedAuth(request, auth('oauth2', { accesstoken: '{{token}}', addTokenTo: 'queryParams' }), value => value.replace('{{token}}', 'secret'));
  assert.equal(oauth.url.searchParams.get('access_token'), 'secret');
  assert.equal(request.url.searchParams.get('access_token'), null);
  assert.equal(oauth.credentialQueryKeys.has('access_token'), true);
  const jwt = await applyAdvancedAuth(request, auth('jwt', { secret: 'secret', payload: '{"aud":"test"}', addTokenTo: 'queryParams', queryParamKey: 'jwt' }));
  assert.equal(decodeJwt(jwt.url.searchParams.get('jwt')).payload.aud, 'test');
  await assert.rejects(applyAdvancedAuth(request, auth('oauth2', {})), /access token/);
  const ready = await applyAdvancedAuth(request, auth('oauth2', { accessToken: 'ready-token', clientSecret: '{{unused}}' }), value => { if (value.includes('{{')) throw new Error('Unresolved variable'); return value; });
  assert.equal(authHeader(ready), 'Bearer ready-token');
});

function type2Challenge(flags = 0x00880001, info = Buffer.alloc(4)) {
  const message = Buffer.alloc(48 + info.length); message.write('NTLMSSP\0', 0, 'ascii'); message.writeUInt32LE(2, 8); message.writeUInt32LE(flags, 20);
  Buffer.from('0123456789abcdef', 'hex').copy(message, 24); message.writeUInt16LE(info.length, 40); message.writeUInt16LE(info.length, 42); message.writeUInt32LE(48, 44); info.copy(message, 48);
  return 'NTLM ' + message.toString('base64');
}

test('NTLM negotiates Type1 and creates an NTLMv2 Type3 response from a validated server challenge', async () => {
  const credentials = auth('ntlm', { username: 'User', password: 'Password', domain: 'Domain', workstation: 'Workstation' });
  const first = await applyAdvancedAuth(prepared(), credentials);
  const type1 = Buffer.from(authHeader(first).slice(5), 'base64'); assert.equal(type1.readUInt32LE(8), 1);
  const headers = challengeAuth(credentials, first, { 'www-authenticate': ['Basic realm="test"', type2Challenge()] }, 1);
  const type3 = Buffer.from(authHeader({ headers }).slice(5), 'base64'); assert.equal(type3.readUInt32LE(8), 3);
  const ntLength = type3.readUInt16LE(20), ntOffset = type3.readUInt32LE(24);
  assert.ok(ntLength > 24); assert.equal(type3.readUInt32LE(ntOffset + 16), 0x00000101);
  assert.equal(challengeAuth(credentials, first, { 'www-authenticate': type2Challenge() }, 2), null);
  assert.throws(() => challengeAuth(credentials, first, { 'www-authenticate': type2Challenge(1) }, 1), /NTLMv2/);
  const mic = Buffer.alloc(12); mic.writeUInt16LE(6, 0); mic.writeUInt16LE(4, 2); mic.writeUInt32LE(2, 4);
  assert.throws(() => challengeAuth(credentials, first, { 'www-authenticate': type2Challenge(0x00880001, mic) }, 1), /MIC\/channel binding/);
});

const ntlmField = (message, field) => message.subarray(message.readUInt32LE(field + 4), message.readUInt32LE(field + 4) + message.readUInt16LE(field));
const vectorTargetInfo = Buffer.from('02000c0044006f006d00610069006e0001000c0053006500720076006500720000000000', 'hex');

test('NTLMv2 proof and LM response match Microsoft MS-NLMP 4.2.4 published vectors', t => {
  // Published User/Password/Domain, nonce aa*8, server challenge 0123456789abcdef,
  // FILETIME zero. These literal expected proofs are independent of this signer.
  // https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-nlmp/125f7a94-933e-4023-a146-a449e49bf774
  t.mock.method(Date, 'now', () => -11644473600000);
  const random = t.mock.method(crypto, 'randomBytes', length => { assert.equal(length, 8); return Buffer.alloc(length, 0xaa); });
  t.mock.method(Math, 'random', () => { throw new Error('NTLM authentication must not use Math.random'); });
  const credentials = auth('ntlm', { username: 'User', password: 'Password', domain: 'Domain', workstation: 'Workstation' });
  const headers = challengeAuth(credentials, prepared(), { 'www-authenticate': type2Challenge(0x00880001, vectorTargetInfo) }, 1);
  const message = Buffer.from(authHeader({ headers }).slice(5), 'base64');
  const nt = ntlmField(message, 20), lm = ntlmField(message, 12);
  assert.equal(nt.subarray(0, 16).toString('hex'), '68cd0ab851e51c96aabc927bebef6a1c');
  assert.equal(lm.toString('hex'), '86c35097ac9cec102554764a57cccc19aaaaaaaaaaaaaaaa');
  assert.equal(nt.subarray(24, 32).toString('hex'), '0000000000000000');
  assert.equal(nt.subarray(32, 40).toString('hex'), 'aaaaaaaaaaaaaaaa');
  assert.equal(ntlmField(message, 28).toString('utf16le'), 'Domain');
  assert.equal(ntlmField(message, 36).toString('utf16le'), 'User');
  assert.equal(random.mock.callCount(), 1);
});

test('NTLMv2 honors server AV timestamp, zeros LM response, and passes independent proof verification', t => {
  const timestamp = Buffer.from('0090d336b734c301', 'hex');
  const pair = Buffer.alloc(12); pair.writeUInt16LE(7); pair.writeUInt16LE(8, 2); timestamp.copy(pair, 4);
  const info = Buffer.concat([vectorTargetInfo.subarray(0, -4), pair, Buffer.alloc(4)]);
  t.mock.method(crypto, 'randomBytes', length => Buffer.alloc(length, 0xcc));
  const credentials = auth('ntlm', { username: 'User', password: 'Password', domain: 'Domain', workstation: 'Work station' });
  const headers = challengeAuth(credentials, prepared(), { 'www-authenticate': type2Challenge(0x00880001, info) }, 1);
  const message = Buffer.from(authHeader({ headers }).slice(5), 'base64'), nt = ntlmField(message, 20);
  assert.deepEqual(nt.subarray(24, 32), timestamp);
  assert.deepEqual(nt.subarray(32, 40), Buffer.alloc(8, 0xcc));
  assert.deepEqual(ntlmField(message, 12), Buffer.alloc(24));
  assert.equal(ntlmField(message, 44).toString('utf16le'), 'WORK STATION');
  const responseKey = Buffer.from('0c868a403bfd7a93a3001ef22ef02e3f', 'hex'); // Published NTOWFv2(User, Password, Domain).
  const challenge = Buffer.from('0123456789abcdef', 'hex'), blob = nt.subarray(16);
  const expected = crypto.createHmac('md5', responseKey).update(challenge).update(blob).digest();
  assert.deepEqual(nt.subarray(0, 16), expected);
  const tampered = Buffer.from(blob); tampered[16] ^= 1;
  assert.notDeepEqual(nt.subarray(0, 16), crypto.createHmac('md5', responseKey).update(challenge).update(tampered).digest());
});

test('NTLM Type1 preserves ASCII domain and workstation without URI escaping', async () => {
  const first = await applyAdvancedAuth(prepared(), auth('ntlm', { username: 'user', password: 'password', domain: 'Domain name', workstation: 'Work station' }));
  const message = Buffer.from(authHeader(first).slice(5), 'base64');
  assert.equal(ntlmField(message, 16).toString('ascii'), 'DOMAIN NAME');
  assert.equal(ntlmField(message, 24).toString('ascii'), 'WORK STATION');
});

test('NTLMv2 validates AV field sizes, terminators, duplicate time, and required channel binding', () => {
  const credentials = auth('ntlm', { username: 'User', password: 'Password', domain: 'Domain' });
  const validate = info => challengeAuth(credentials, prepared(), { 'www-authenticate': type2Challenge(0x00880001, info) }, 1);
  assert.throws(() => validate(Buffer.from('010002004100', 'hex')), /terminator/);
  assert.throws(() => validate(Buffer.alloc(8)), /terminator/);
  const malformedTime = Buffer.alloc(8); malformedTime.writeUInt16LE(7); malformedTime.writeUInt16LE(4, 2);
  assert.throws(() => validate(malformedTime), /field size/);
  const time = Buffer.alloc(12); time.writeUInt16LE(7); time.writeUInt16LE(8, 2);
  assert.throws(() => validate(Buffer.concat([time, time, Buffer.alloc(4)])), /duplicate/);
  const binding = Buffer.alloc(24); binding.writeUInt16LE(10); binding.writeUInt16LE(16, 2); binding[4] = 1;
  assert.throws(() => validate(binding), /MIC\/channel binding/);
});

test('unsupported signing/body combinations and CRLF credential injection fail explicitly', async () => {
  await assert.rejects(applyAdvancedAuth(prepared('https://example.com', 'POST', {}), auth('awsv4', { service: 's3', accessKey: 'key', secretKey: 'secret' })), /exact body bytes/);
  await assert.rejects(applyAdvancedAuth(prepared(), auth('oauth2', { accessToken: 'bad\r\ntoken' })), /line breaks/);
  await assert.rejects(applyAdvancedAuth(prepared(), auth('unknown', {})), /Unsupported authorization/);
});

test('OAuth2 client credentials, refresh, manual PKCE code, and password grants reach a local token endpoint correctly', async t => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    seen.push({ headers: req.headers, body: new URLSearchParams(text) });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ access_token: 'token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refreshed' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const tokenUrl = `http://127.0.0.1:${server.address().port}/token`;
  const base = { tokenUrl, clientId: 'client', clientSecret: 'secret', scope: 'read write' };
  const result = await acquireOAuth2Token(auth('oauth2', base)); assert.deepEqual(result, { accessToken: 'token', tokenType: 'Bearer', expiresIn: 3600, refreshToken: 'refreshed' });
  assert.equal(seen[0].body.get('grant_type'), 'client_credentials'); assert.equal(seen[0].headers.authorization, 'Basic ' + Buffer.from('client:secret').toString('base64'));
  await acquireOAuth2Token(auth('oauth2', { ...base, grantType: 'refresh_token', refreshToken: 'old', clientAuthentication: 'body' }));
  assert.equal(seen[1].body.get('refresh_token'), 'old'); assert.equal(seen[1].body.get('client_secret'), 'secret'); assert.equal(seen[1].headers.authorization, undefined);
  await acquireOAuth2Token(auth('oauth2', { ...base, grantType: 'authorization_code', code: 'code', redirectUri: 'http://localhost/callback', codeVerifier: 'x'.repeat(43) }));
  assert.equal(seen[2].body.get('code_verifier'), 'x'.repeat(43)); assert.equal(seen[2].body.get('redirect_uri'), 'http://localhost/callback');
  await acquireOAuth2Token(auth('oauth2', { ...base, grantType: 'password', username: 'user', password: 'pass' }));
  assert.equal(seen[3].body.get('username'), 'user'); assert.equal(seen[3].body.get('password'), 'pass');
  await assert.rejects(acquireOAuth2Token(auth('oauth2', { ...base, grantType: 'implicit' })), /grants supported/);
});

test('OAuth2 rejects redirects, malformed JSON, invalid token URLs, and missing access tokens', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/success' }); res.end('{"error":"redirect"}'); }
    else if (req.url === '/invalid') { res.end('not json'); }
    else res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(acquireOAuth2Token(auth('oauth2', { tokenUrl: base + '/redirect', clientId: 'client' })), /HTTP 302/);
  await assert.rejects(acquireOAuth2Token(auth('oauth2', { tokenUrl: base + '/invalid', clientId: 'client' })), /invalid JSON/);
  await assert.rejects(acquireOAuth2Token(auth('oauth2', { tokenUrl: base + '/empty', clientId: 'client' })), /access_token/);
  await assert.rejects(acquireOAuth2Token(auth('oauth2', { tokenUrl: 'file:///secret', clientId: 'client' })), /HTTP or HTTPS/);
});
