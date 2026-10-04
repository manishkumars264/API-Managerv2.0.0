'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const aws4 = require('aws4');
const OAuth = require('oauth-1.0a');
const Hawk = require('@hapi/hawk');
const ntlm = require('httpntlm').ntlm;
// Use Akamai's signer without constructing its HTTP client or registering global interceptors.
const edgeSigner = require(path.join(path.dirname(require.resolve('akamai-edgegrid')), 'src', 'auth.js'));
const { request: httpRequest, Agent } = require('undici');

const SUPPORTED_AUTH_TYPES = ['none', 'inherit', 'basic', 'bearer', 'apikey', 'digest', 'oauth1', 'oauth2', 'hawk', 'awsv4', 'ntlm', 'edgegrid', 'jwt', 'asap'];
const valueOf = (value) => value === undefined || value === null ? '' : String(value);
const yes = value => value === true || ['true', '1', 'yes'].includes(String(value).toLowerCase());
function fields(auth, resolve = value => value) {
  const result = {};
  for (const [key, value] of Object.entries({ ...auth, ...(auth.fields || {}) })) if (['string', 'number', 'boolean'].includes(typeof value)) result[key] = String(value);
  const alias = (target, ...names) => { if (result[target] === undefined) for (const name of names) if (result[name] !== undefined) { result[target] = result[name]; break; } };
  alias('accessToken', 'accesstoken', 'token'); alias('tokenUrl', 'accessTokenUrl', 'accessTokenURL');
  alias('clientId', 'clientID'); alias('clientAuthentication', 'client_authentication');
  alias('accessKey', 'accessKeyId'); alias('secretKey', 'secretAccessKey');
  alias('authId', 'id'); alias('keyId', 'kid'); alias('privateKey', 'private_key');
  alias('key', 'authKey'); alias('ext', 'extraData');
  alias('queryParamKey', 'queryParamName'); alias('code', 'authorizationCode');
  // OAuth token acquisition fields can contain variables that are irrelevant to a token send.
  // Resolve a field only when that field actually participates in this operation.
  return new Proxy(result, { get: (target, key) => typeof target[key] === 'string' ? resolve(target[key]) : target[key] });
}
function requireField(field, label) { if (!field) throw new Error(`Enter ${label}.`); return field; }
function safeHeader(value, label = 'authentication value') { if (/[\r\n\0]/.test(value)) throw new Error(`Invalid ${label}: line breaks and null characters are not allowed.`); return value; }
const quote = value => `"${safeHeader(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const getHeader = (headers, key) => headers.find(header => header.key.toLowerCase() === key.toLowerCase())?.value;
function putHeader(prepared, key, value, credential = true) {
  safeHeader(value, key);
  prepared.headers = [...prepared.headers.filter(header => header.key.toLowerCase() !== key.toLowerCase()), { key, value }];
  if (credential) prepared.credentialHeaders.add(key.toLowerCase());
}
function byteBody(prepared, scheme) {
  if (prepared.body === undefined || prepared.body === null) return Buffer.alloc(0);
  if (typeof prepared.body === 'string' || Buffer.isBuffer(prepared.body) || prepared.body instanceof Uint8Array) return Buffer.from(prepared.body);
  throw new Error(`${scheme} signing requires exact body bytes. Use a raw, URL-encoded, or binary body instead of multipart form data.`);
}
function headerObject(headers) {
  const output = {};
  for (const { key, value } of headers) {
    const previous = Object.keys(output).find(name => name.toLowerCase() === key.toLowerCase());
    if (previous) output[previous] += `, ${value}`; else output[key] = value;
  }
  return output;
}
function putQuery(prepared, key, value) { prepared.url.searchParams.set(key, value); prepared.credentialQueryKeys.add(key); }
function parseObject(text, label) {
  let value;
  try { value = JSON.parse(text || '{}'); } catch { throw new Error(`${label} must be valid JSON.`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}
function privateKey(f) {
  const value = requireField(f.privateKey || f.secret, 'the private signing key').replace(/\\n/g, '\n');
  return crypto.createPrivateKey({ key: value, ...(f.passphrase ? { passphrase: f.passphrase } : {}) });
}

function jwtToken(f, asap = false) {
  const algorithm = asap ? 'RS256' : (f.algorithm || 'HS256').toUpperCase();
  const allowed = /^(HS|RS|ES|PS)(256|384|512)$/.exec(algorithm);
  if (!allowed) throw new Error('JWT signing supports HS256/384/512, RS256/384/512, ES256/384/512, and PS256/384/512.');
  const header = { ...parseObject(f.header, 'JWT header'), alg: algorithm, typ: 'JWT' };
  let payload = parseObject(f.payload, 'JWT payload');
  if (asap) {
    const now = Number(f.issuedAt || f.iat || Math.floor(Date.now() / 1000)), lifetime = Number(f.expiry || 3600);
    if (!Number.isInteger(now) || !Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 3600) throw new Error('ASAP expiry must be between 1 and 3600 seconds and issuedAt must be an integer timestamp.');
    header.kid = requireField(f.keyId, 'the ASAP key ID');
    payload = { ...payload, iss: requireField(f.issuer, 'the ASAP issuer'), aud: requireField(f.audience, 'the ASAP audience'),
      iat: now, exp: now + lifetime, jti: f.jwtId || crypto.randomUUID(), ...(f.subject ? { sub: f.subject } : {}),
    };
  }
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const digest = `sha${allowed[2]}`;
  let signature;
  if (allowed[1] === 'HS') {
    const secret = requireField(f.secret, 'the JWT secret');
    const key = yes(f.isSecretBase64Encoded) ? Buffer.from(secret, 'base64') : Buffer.from(secret);
    signature = crypto.createHmac(digest, key).update(input).digest();
  } else {
    const key = privateKey(f);
    const expectedType = allowed[1] === 'ES' ? 'ec' : 'rsa';
    if (key.asymmetricKeyType !== expectedType && !(expectedType === 'rsa' && key.asymmetricKeyType === 'rsa-pss' && allowed[1] === 'PS')) throw new Error(`${algorithm} requires an ${expectedType.toUpperCase()} private key.`);
    if (allowed[1] === 'ES') {
      const curves = { ES256: 'prime256v1', ES384: 'secp384r1', ES512: 'secp521r1' };
      if (key.asymmetricKeyDetails?.namedCurve !== curves[algorithm]) throw new Error(`${algorithm} requires the ${curves[algorithm]} curve.`);
    }
    signature = crypto.sign(digest, Buffer.from(input), { key, ...(allowed[1] === 'ES' ? { dsaEncoding: 'ieee-p1363' } : {}),
      ...(allowed[1] === 'PS' ? { padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST } : {}),
    });
  }
  return `${input}.${signature.toString('base64url')}`;
}

function oauth1(prepared, f) {
  for (const key of [...prepared.url.searchParams.keys()]) if (/^oauth_(?:consumer_key|nonce|signature_method|timestamp|version|token|callback|verifier|body_hash|signature)$/.test(key)) prepared.url.searchParams.delete(key);
  const method = (f.signatureMethod || 'HMAC-SHA1').toUpperCase();
  if (!['HMAC-SHA1', 'HMAC-SHA256', 'RSA-SHA1', 'RSA-SHA256', 'PLAINTEXT'].includes(method)) throw new Error(`Unsupported OAuth 1 signature method: ${method}.`);
  const digest = method.endsWith('256') ? 'sha256' : 'sha1';
  const oauth = OAuth({ consumer: { key: requireField(f.consumerKey, 'the OAuth consumer key'), secret: f.consumerSecret || '' }, signature_method: method, realm: f.realm,
    hash_function: (base, key) => method === 'PLAINTEXT' ? key : method.startsWith('RSA') ? crypto.sign(digest, Buffer.from(base), privateKey({ ...f, privateKey: f.privateKey || f.consumerSecret })).toString('base64') : crypto.createHmac(digest, key).update(base).digest('base64'),
  });
  const data = {};
  const addParameter = (key, value) => { if (data[key] === undefined) data[key] = value; else data[key] = [...(Array.isArray(data[key]) ? data[key] : [data[key]]), value]; };
  for (const [key, value] of prepared.url.searchParams) addParameter(key, value);
  if (/^application\/x-www-form-urlencoded(?:;|$)/i.test(getHeader(prepared.headers, 'content-type') || '') && prepared.body) {
    for (const [key, value] of new URLSearchParams(byteBody(prepared, 'OAuth 1').toString())) {
      addParameter(key, value);
    }
  }
  const attrs = { oauth_consumer_key: f.consumerKey, oauth_nonce: f.nonce || crypto.randomBytes(16).toString('hex'), oauth_signature_method: method, oauth_timestamp: f.timestamp || String(Math.floor(Date.now() / 1000)) };
  if (f.version !== '') attrs.oauth_version = f.version || '1.0';
  if (f.accessToken || yes(f.addEmptyParamsToSign)) attrs.oauth_token = f.accessToken || '';
  if (f.callback) attrs.oauth_callback = f.callback;
  if (f.verifier) attrs.oauth_verifier = f.verifier;
  if (yes(f.includeBodyHash)) attrs.oauth_body_hash = crypto.createHash(digest).update(byteBody(prepared, 'OAuth 1 body hash')).digest('base64');
  const signingUrl = new URL(prepared.url); if (!attrs.oauth_body_hash) signingUrl.search = '';
  // Avoid the library's object merge overwriting a body/query duplicate or mutating auth attributes.
  attrs.oauth_signature = oauth.getSignature({ url: signingUrl.href, method: prepared.method, data }, f.tokenSecret || '', { ...attrs });
  if (f.addParamsToHeader === 'false' || f.addTokenTo === 'queryParams' || f.addTokenTo === 'query') {
    for (const [key, value] of Object.entries(attrs)) putQuery(prepared, key, value);
  } else if (yes(f.disableHeaderEncoding)) {
    putHeader(prepared, 'Authorization', `OAuth ${Object.entries(attrs).map(([key, value]) => `${key}=${quote(value)}`).join(', ')}${f.realm ? `, realm=${quote(f.realm)}` : ''}`);
  } else putHeader(prepared, 'Authorization', oauth.toHeader(attrs).Authorization);
}

function digestHeader(prepared, f, challenge, attempt = 1) {
  const algorithm = (challenge.algorithm || f.algorithm || 'MD5').toUpperCase();
  const hashAlgorithm = { MD5: 'md5', 'SHA-256': 'sha256', 'SHA-512-256': 'sha512-256' }[algorithm.replace(/-SESS$/, '')];
  if (!hashAlgorithm) throw new Error(`Unsupported Digest algorithm: ${algorithm}.`);
  const username = requireField(f.username, 'the Digest username'), password = f.password || '', realm = challenge.realm ?? f.realm ?? '', nonce = requireField(challenge.nonce || f.nonce, 'the Digest server nonce');
  const charset = String(challenge.charset || '').toLowerCase() === 'utf-8' ? 'utf8' : 'latin1';
  if (charset === 'latin1' && /[^\u0000-\u00ff]/.test(username + password + realm)) throw new Error('This Digest server does not advertise UTF-8 credentials.');
  const hash = value => crypto.createHash(hashAlgorithm).update(typeof value === 'string' ? Buffer.from(value, charset) : value).digest('hex');
  const cnonce = f.cnonce || f.clientNonce || crypto.randomBytes(12).toString('hex');
  const qops = valueOf(challenge.qop || f.qop).split(',').map(qop => qop.trim()).filter(Boolean);
  const qop = qops.includes('auth') ? 'auth' : qops.includes('auth-int') ? 'auth-int' : qops.length ? undefined : '';
  if (qop === undefined) throw new Error(`Unsupported Digest quality of protection: ${qops.join(', ')}.`);
  const uri = prepared.url.pathname + prepared.url.search;
  let a1 = hash(`${username}:${realm}:${password}`);
  if (algorithm.endsWith('-SESS')) a1 = hash(`${a1}:${nonce}:${cnonce}`);
  const a2 = hash(`${prepared.method}:${uri}${qop === 'auth-int' ? `:${hash(byteBody(prepared, 'Digest auth-int'))}` : ''}`);
  const count = Number(f.nonceCount || 1) + attempt - 1;
  if (!Number.isInteger(count) || count < 1 || count > 0xffffffff) throw new Error('Digest nonce count must be a positive 32-bit integer.');
  const nc = count.toString(16).padStart(8, '0');
  const response = hash(qop ? `${a1}:${nonce}:${nc}:${cnonce}:${qop}:${a2}` : `${a1}:${nonce}:${a2}`);
  const userhash = String(challenge.userhash).toLowerCase() === 'true';
  const attrs = [`username=${quote(userhash ? hash(`${username}:${realm}`) : username)}`, `realm=${quote(realm)}`, `nonce=${quote(nonce)}`, `uri=${quote(uri)}`, `response=${quote(response)}`, `algorithm=${algorithm}`];
  if (challenge.opaque) attrs.push(`opaque=${quote(challenge.opaque)}`);
  if (qop) attrs.push(`qop=${qop}`, `nc=${nc}`, `cnonce=${quote(cnonce)}`); else if (algorithm.endsWith('-SESS')) attrs.push(`cnonce=${quote(cnonce)}`);
  if (userhash) attrs.push('userhash=true');
  return `Digest ${attrs.join(', ')}`;
}

function ntlmOptions(f) {
  if (/[^\x00-\x7f]/.test((f.domain || '') + (f.workstation || ''))) throw new Error('NTLM domain and workstation names must contain ASCII characters.');
  return { username: requireField(f.username, 'the NTLM username'), password: f.password || '', domain: f.domain || '', workstation: f.workstation || '' };
}

function ntlmType1Message(options) {
  const framing = Buffer.from(ntlm.createType1Message(options).slice(5), 'base64').subarray(0, 40);
  const domain = Buffer.from(options.domain.toUpperCase(), 'ascii'), workstation = Buffer.from(options.workstation.toUpperCase(), 'ascii');
  let offset = framing.length;
  for (const [field, value] of [[16, domain], [24, workstation]]) {
    if (value.length > 65535) throw new Error('NTLM domain or workstation exceeds the protocol field size limit.');
    framing.writeUInt16LE(value.length, field); framing.writeUInt16LE(value.length, field + 2); framing.writeUInt32LE(offset, field + 4); offset += value.length;
  }
  return 'NTLM ' + Buffer.concat([framing, domain, workstation]).toString('base64');
}

function ntlmV2Message(parsed, options, serverTimestamp) {
  // Keep the library's message framing and MD4 implementation, but do not use
  // its Math.random nonce, escaped domain, or locally generated server timestamp.
  // Disable its response calculation for this framing-only call; those placeholder
  // fields are all replaced below and are never sent.
  const framing = Buffer.from(ntlm.createType3Message({ ...parsed, negotiateFlags: parsed.negotiateFlags & ~0x00080000 }, {
    ...options, password: '', lm_password: Buffer.alloc(16), nt_password: Buffer.alloc(16),
  }).slice(5), 'base64').subarray(0, 72);
  const mac = (key, value) => crypto.createHmac('md5', key).update(value).digest();
  // MS-NLMP 3.3.2: uppercase only the username; preserve the supplied domain.
  const key = mac(ntlm.create_NT_hashed_password(options.password), Buffer.from(options.username.toUpperCase() + options.domain, 'utf16le'));
  const nonce = crypto.randomBytes(8);
  const timestamp = serverTimestamp ? Buffer.from(serverTimestamp) : Buffer.alloc(8);
  if (!serverTimestamp) timestamp.writeBigUInt64LE((BigInt(Date.now()) + 11644473600000n) * 10000n);
  const blob = Buffer.concat([Buffer.from('0101000000000000', 'hex'), timestamp, nonce, Buffer.alloc(4), parsed.targetInfo, Buffer.alloc(4)]);
  const ntResponse = Buffer.concat([mac(key, Buffer.concat([parsed.serverChallenge, blob])), blob]);
  // MS-NLMP 3.1.5.1.2 suppresses LM when the server supplies MsvAvTimestamp.
  const lmResponse = serverTimestamp ? Buffer.alloc(24) : Buffer.concat([mac(key, Buffer.concat([parsed.serverChallenge, nonce])), nonce]);
  const payload = [
    [28, Buffer.from(options.domain, 'utf16le')], [36, Buffer.from(options.username, 'utf16le')],
    [44, Buffer.from(options.workstation.toUpperCase(), 'utf16le')], [12, lmResponse], [20, ntResponse], [52, Buffer.alloc(0)],
  ];
  let offset = framing.length;
  for (const [field, value] of payload) {
    if (value.length > 65535) throw new Error('NTLM credentials or target information exceed the protocol field size limit.');
    framing.writeUInt16LE(value.length, field); framing.writeUInt16LE(value.length, field + 2); framing.writeUInt32LE(offset, field + 4); offset += value.length;
  }
  const flags = (framing.readUInt32LE(60) & parsed.negotiateFlags) >>> 0;
  framing.writeUInt32LE(flags, 60);
  if (!(flags & 0x02000000)) framing.fill(0, 64, 72);
  return 'NTLM ' + Buffer.concat([framing, ...payload.map(([, value]) => value)]).toString('base64');
}

async function applyAdvancedAuth(input, auth, resolve = value => value) {
  if (!SUPPORTED_AUTH_TYPES.includes(auth.type)) throw new Error(`Unsupported authorization type: ${auth.type}.`);
  const prepared = { ...input, url: new URL(input.url), headers: [...input.headers], credentialHeaders: new Set(input.credentialHeaders || []), credentialQueryKeys: new Set(input.credentialQueryKeys || []) };
  const f = fields(auth, resolve);
  if (['none', 'inherit', 'basic', 'bearer', 'apikey'].includes(auth.type)) return prepared;
  if (auth.type === 'digest') { if (f.nonce) putHeader(prepared, 'Authorization', digestHeader(prepared, f, f)); return prepared; }
  if (auth.type === 'ntlm') { putHeader(prepared, 'Authorization', ntlmType1Message(ntlmOptions(f))); return prepared; }
  if (auth.type === 'oauth2') {
    const token = requireField(f.accessToken, 'an OAuth 2 access token. Use Get Token or enter a token');
    if (['queryParams', 'query'].includes(f.addTokenTo)) putQuery(prepared, f.queryParamKey || 'access_token', token);
    else putHeader(prepared, 'Authorization', `${f.headerPrefix || f.tokenType || 'Bearer'} ${token}`);
  } else if (auth.type === 'oauth1') oauth1(prepared, f);
  else if (auth.type === 'jwt' || auth.type === 'asap') {
    const token = jwtToken(f, auth.type === 'asap');
    if (auth.type === 'jwt' && ['queryParams', 'query'].includes(f.addTokenTo)) putQuery(prepared, f.queryParamKey || 'token', token);
    else putHeader(prepared, 'Authorization', `${f.headerPrefix || 'Bearer'} ${token}`);
  } else if (auth.type === 'hawk') {
    const options = { credentials: { id: requireField(f.authId, 'the Hawk ID'), key: requireField(f.key || f.secret, 'the Hawk key'), algorithm: (f.algorithm || 'sha256').toLowerCase() },
      ...(f.timestamp ? { timestamp: Number(f.timestamp) } : {}), ...(f.nonce ? { nonce: f.nonce } : {}), ...(f.ext ? { ext: f.ext } : {}), ...(f.app ? { app: f.app } : {}), ...(f.dlg ? { dlg: f.dlg } : {}),
    };
    if (yes(f.includePayloadHash)) { options.payload = byteBody(prepared, 'Hawk payload'); options.contentType = getHeader(prepared.headers, 'content-type') || ''; }
    const header = Hawk.client.header(prepared.url.href, prepared.method, options);
    putHeader(prepared, 'Authorization', header.header);
  } else if (auth.type === 'awsv4') {
    const body = byteBody(prepared, 'AWS Signature V4');
    prepared.headers = prepared.headers.filter(header => !['authorization', 'x-amz-security-token'].includes(header.key.toLowerCase()));
    for (const key of ['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-SignedHeaders', 'X-Amz-Signature', 'X-Amz-Security-Token']) prepared.url.searchParams.delete(key);
    const headers = headerObject(prepared.headers);
    if (f.timestamp || f.amzDate) headers['X-Amz-Date'] = f.amzDate || f.timestamp;
    const signQuery = yes(f.addAuthDataToQuery) || yes(f.signQuery) || f.addTokenTo === 'queryParams';
    if (signQuery && f.expires) prepared.url.searchParams.set('X-Amz-Expires', f.expires);
    const signed = aws4.sign({ host: prepared.url.host, method: prepared.method, path: prepared.url.pathname + prepared.url.search,
      service: requireField(f.service, 'the AWS service'), region: f.region || 'us-east-1', headers, body: prepared.body === null || prepared.body === undefined ? undefined : body, signQuery,
    }, { accessKeyId: requireField(f.accessKey, 'the AWS access key'), secretAccessKey: requireField(f.secretKey, 'the AWS secret key'), ...(f.sessionToken ? { sessionToken: f.sessionToken } : {}) });
    prepared.headers = Object.entries(signed.headers).map(([key, value]) => ({ key, value: String(value) }));
    prepared.url = new URL(signed.path, prepared.url.origin);
    prepared.credentialHeaders.add('authorization'); prepared.credentialHeaders.add('x-amz-security-token');
    if (signQuery) for (const key of prepared.url.searchParams.keys()) if (/^X-Amz-/i.test(key)) prepared.credentialQueryKeys.add(key);
  } else if (auth.type === 'edgegrid') {
    const bytes = byteBody(prepared, 'EdgeGrid'), headersToSign = {};
    let names = [];
    if (f.headersToSign) { try { names = JSON.parse(f.headersToSign); } catch { names = f.headersToSign.split(',').map(name => name.trim()).filter(Boolean); } if (!Array.isArray(names)) throw new Error('EdgeGrid headersToSign must be a JSON array or comma-separated list of header names.'); }
    for (const name of names) { const value = getHeader(prepared.headers, String(name)); if (value === undefined) throw new Error(`EdgeGrid signed header is missing: ${name}.`); headersToSign[String(name)] = value; }
    if (f.timestamp && !/^\d{8}T\d{2}:\d{2}:\d{2}\+0000$/.test(f.timestamp)) throw new Error('EdgeGrid timestamp must use YYYYMMDDTHH:mm:ss+0000 format.');
    // The official signer hashes Buffer bytes for gzip bodies. This signing-only content type
    // selects that byte-preserving path; actual outgoing headers and signed header values stay intact.
    const signed = edgeSigner.generateAuth({ path: prepared.url.pathname + prepared.url.search, method: prepared.method, body: bytes,
      headers: { 'Content-Type': 'application/gzip' }, headersToSign,
    }, requireField(f.clientToken, 'the EdgeGrid client token'), requireField(f.clientSecret, 'the EdgeGrid client secret'), requireField(f.accessToken, 'the EdgeGrid access token'), prepared.url.origin, undefined, f.nonce, f.timestamp);
    putHeader(prepared, 'Authorization', signed.headers.Authorization);
  }
  prepared.headers.forEach(header => safeHeader(header.value, header.key));
  return prepared;
}

function authenticationHeaders(headers) {
  if (Array.isArray(headers)) return headers.filter(header => header.key.toLowerCase() === 'www-authenticate').map(header => header.value);
  const value = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === 'www-authenticate')?.[1];
  return Array.isArray(value) ? value : value ? [value] : [];
}
function challengeAuth(auth, prepared, responseHeaders, attempt, resolve = value => value) {
  if (attempt < 1 || attempt > 2) return null;
  const f = fields(auth, resolve), values = authenticationHeaders(responseHeaders);
  let authorization;
  if (auth.type === 'digest') {
    const value = values.find(value => /(?:^|,\s*)Digest\s/i.test(value));
    if (!value) return null;
    const challenge = {};
    const raw = value.slice(value.search(/Digest\s/i) + 7);
    const pairs = /([a-zA-Z][\w-]*)\s*=\s*("((?:\\.|[^"\\])*)"|([^\s,]+))/g;
    for (const match of raw.matchAll(pairs)) challenge[match[1].toLowerCase()] = match[3] === undefined ? match[4] : match[3].replace(/\\(.)/g, '$1');
    if (attempt > 1 && challenge.stale !== 'true') return null;
    authorization = digestHeader(prepared, f, challenge, attempt);
  } else if (auth.type === 'ntlm') {
    if (attempt > 1) return null;
    const value = values.join(', ').match(/(?:^|,\s*)NTLM\s+([A-Za-z0-9+/]+={0,2})(?:\s*,|\s*$)/i);
    if (!value) return null;
    const bytes = Buffer.from(value[1], 'base64');
    if (bytes.length < 48 || bytes.toString('ascii', 0, 8) !== 'NTLMSSP\0' || bytes.readUInt32LE(8) !== 2) throw new Error('Invalid NTLM Type 2 challenge.');
    const flags = bytes.readUInt32LE(20), length = bytes.readUInt16LE(40), offset = bytes.readUInt32LE(44);
    if (!(flags & 0x00080000) || !(flags & 0x00800000) || !(flags & 1) || length < 4 || offset < 48 || offset + length > bytes.length) throw new Error('The NTLM server must support NTLMv2 with Unicode and target information. Legacy NTLMv1 is not enabled.');
    const targetInfo = bytes.subarray(offset, offset + length);
    let serverTimestamp, terminated = false;
    for (let position = 0; position + 4 <= targetInfo.length;) {
      const id = targetInfo.readUInt16LE(position), size = targetInfo.readUInt16LE(position + 2); position += 4;
      if (position + size > targetInfo.length) throw new Error('Invalid NTLM target information.');
      if ((id === 6 && size !== 4) || (id === 7 && size !== 8) || (id === 10 && size !== 16)) throw new Error('Invalid NTLM target information field size.');
      if ((id === 6 && (targetInfo.readUInt32LE(position) & 2)) || (id === 10 && targetInfo.subarray(position, position + size).some(value => value !== 0))) throw new Error('This NTLM server requires MIC/channel binding, which is not supported by the NTLMv2 adapter.');
      if (id === 7) { if (serverTimestamp) throw new Error('Invalid duplicate NTLM server timestamp.'); serverTimestamp = targetInfo.subarray(position, position + size); }
      if (id === 0) { if (size !== 0 || position !== targetInfo.length) throw new Error('Invalid NTLM target information terminator.'); terminated = true; break; }
      position += size;
    }
    if (!terminated) throw new Error('NTLM target information is missing its terminator.');
    const parsed = ntlm.parseType2Message(`NTLM ${value[1]}`, error => { throw error; });
    // The library reads these lengths as signed int16; use our validated slices
    // so valid large target information cannot be silently truncated.
    parsed.targetInfo = targetInfo; parsed.serverChallenge = bytes.subarray(24, 32); parsed.negotiateFlags = flags;
    authorization = ntlmV2Message(parsed, ntlmOptions(f), serverTimestamp);
  } else return null;
  return [...prepared.headers.filter(header => header.key.toLowerCase() !== 'authorization'), { key: 'Authorization', value: authorization }];
}

async function acquireOAuth2Token(auth, resolve = value => value, settings = {}, signal) {
  const f = fields(auth, resolve);
  let url;
  try { url = new URL(requireField(f.tokenUrl, 'the OAuth 2 token URL')); } catch { throw new Error('Enter a complete HTTP or HTTPS OAuth 2 token URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('The token URL must use HTTP or HTTPS and must not contain embedded credentials.');
  const aliases = { clientcredentials: 'client_credentials', client_credentials: 'client_credentials', refresh: 'refresh_token', refresh_token: 'refresh_token', authorizationcode: 'authorization_code', authorization_code: 'authorization_code', password: 'password' };
  const grant = aliases[(f.grantType || 'client_credentials').toLowerCase().replace(/[- ]/g, '')];
  if (!grant) throw new Error('OAuth 2 token grants supported: client_credentials, refresh_token, authorization_code with optional PKCE, and password.');
  const body = new URLSearchParams({ grant_type: grant });
  if (f.scope) body.set('scope', f.scope);
  if (f.audience) body.set('audience', f.audience);
  if (grant === 'refresh_token') body.set('refresh_token', requireField(f.refreshToken, 'the OAuth refresh token'));
  if (grant === 'authorization_code') {
    body.set('code', requireField(f.code, 'the OAuth authorization code'));
    if (f.redirectUri) body.set('redirect_uri', f.redirectUri);
    if (f.codeVerifier) { if (!/^[A-Za-z0-9._~-]{43,128}$/.test(f.codeVerifier)) throw new Error('PKCE code verifier must contain 43–128 URL-safe characters.'); body.set('code_verifier', f.codeVerifier); }
  }
  if (grant === 'password') { body.set('username', requireField(f.username, 'the resource-owner username')); body.set('password', f.password || ''); }
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const clientId = requireField(f.clientId, 'the OAuth client ID');
  if (f.clientAuthentication === 'body' || (grant === 'authorization_code' && !f.clientSecret)) { body.set('client_id', clientId); if (f.clientSecret) body.set('client_secret', f.clientSecret); }
  else { const encode = value => new URLSearchParams({ v: value }).toString().slice(2); headers.Authorization = `Basic ${Buffer.from(`${encode(clientId)}:${encode(f.clientSecret || '')}`).toString('base64')}`; }
  const controller = new AbortController(), abort = () => controller.abort(signal?.reason), timeout = Number(settings.timeout ?? 30000);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = timeout > 0 ? setTimeout(() => controller.abort(new Error('OAuth token request timed out.')), timeout) : null;
  const dispatcher = new Agent({ connect: { rejectUnauthorized: settings.verifySsl !== false }, connections: 1 });
  let completed = false;
  try {
    const response = await httpRequest(url, { method: 'POST', body: body.toString(), headers, dispatcher, signal: controller.signal, maxRedirections: 0, headersTimeout: timeout, bodyTimeout: timeout });
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 1024 * 1024) { response.body.on('error', () => {}); response.body.destroy(); throw new Error('OAuth token response exceeds 1 MB.'); } chunks.push(chunk); }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error(`OAuth token endpoint returned HTTP ${response.statusCode} with an invalid JSON response.`); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('OAuth token endpoint must return a JSON object containing access_token.');
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`OAuth token request failed (HTTP ${response.statusCode}): ${valueOf(data.error_description || data.error || 'the endpoint rejected the grant').slice(0, 500)}`);
    if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('OAuth token response did not include access_token.');
    const expiresIn = Number(data.expires_in);
    completed = true;
    return { accessToken: data.access_token, tokenType: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
      ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : f.refreshToken ? { refreshToken: f.refreshToken } : {}),
      ...(Number.isFinite(expiresIn) && expiresIn >= 0 ? { expiresIn } : {}),
    };
  } finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); if (completed) await dispatcher.close(); else await dispatcher.destroy().catch(() => {}); }
}

module.exports = { SUPPORTED_AUTH_TYPES, applyAdvancedAuth, challengeAuth, acquireOAuth2Token, jwtToken };
