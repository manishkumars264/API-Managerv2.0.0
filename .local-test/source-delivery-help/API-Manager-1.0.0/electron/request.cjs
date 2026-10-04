'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { File } = require('node:buffer');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { pipeline } = require('node:stream');
const zlib = require('node:zlib');
const { request: httpRequest, Agent, FormData } = require('undici');
const { CookieJar } = require('tough-cookie');
const { validateSendPayload } = require('./validation.cjs');
const { applyAdvancedAuth, challengeAuth } = require('./auth.cjs');
const { dynamicSession, pinDynamics } = require('./dynamic-session.cjs');

const FILE_LIMIT = 100 * 1024 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
function resolveVariables(source, rows, requestId) {
  const values = new Map(rows.filter(row => row.enabled && row.key).map(row => [row.key, row.value]));
  const dynamics = dynamicSession(requestId, rows);
  function dynamic(name) {
    const value = dynamics.get(name);
    if (value === undefined) throw new Error(`Unresolved variable: {{${name}}}`);
    return value;
  }
  function substitute(text, stack = []) {
    return String(text).replace(/{{\s*([^{}]+?)\s*}}/g, (_match, name) => {
      name = name.trim();
      if (stack.includes(name)) throw new Error(`Circular variable reference: ${[...stack, name].join(' → ')}`);
      if (stack.length >= 30) throw new Error('Variable nesting exceeds 30 levels.');
      if (!values.has(name)) return dynamic(name);
      return substitute(values.get(name), [...stack, name]);
    });
  }
  return typeof source === 'string' ? substitute(source) : substitute;
}
function headerRows(raw) {
  const rows = [];
  if (Array.isArray(raw)) {
    for (let index = 0; index + 1 < raw.length; index += 2) rows.push({ id: randomUUID(), key: String(raw[index]), value: String(raw[index + 1]), enabled: true });
  } else {
    for (const [key, value] of Object.entries(raw || {})) for (const item of Array.isArray(value) ? value : [value]) rows.push({ id: randomUUID(), key, value: String(item), enabled: true });
  }
  return rows;
}
function getHeader(rows, key) { return rows.find(row => row.key.toLowerCase() === key)?.value; }
function discardResponse(body) { body.on('error', () => {}); body.destroy(); }
function setHeader(rows, key, value) { return [...rows.filter(row => row.key.toLowerCase() !== key.toLowerCase()), { key, value }]; }
function validateHeader(key, value) {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n\0]/.test(value)) throw new Error(`Invalid HTTP header: ${key || '(empty name)'}.`);
}
function validateUrl(source) {
  let url;
  try { url = new URL(source); } catch { throw new Error('Enter a complete HTTP or HTTPS URL, including http:// or https://.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS requests are supported.');
  return url;
}
async function readUpload(filePath, signal) {
  if (!filePath || !path.isAbsolute(filePath)) throw new Error('Choose a local file for the upload.');
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw new Error('The selected upload is not a file.');
  if (stats.size > FILE_LIMIT) throw new Error('Upload files must be 100 MB or smaller.');
  return fs.readFile(filePath, { signal });
}
async function prepareRequest(request, resolve, signal) {
  const url = validateUrl(resolve(request.url.trim()));
  let headers = request.headers.filter(row => row.enabled && row.key.trim()).map(row => ({ key: resolve(row.key).trim(), value: resolve(row.value) }));
  const credentialHeaders = new Set(['authorization', 'proxy-authorization', 'cookie', 'host', 'x-api-key', 'api-key', 'x-auth-token']);
  const credentialQueryKeys = new Set();
  const params = request.params.filter(row => row.enabled && row.key).map(row => ({ key: resolve(row.key), value: resolve(row.value) }));
  for (const key of new Set(params.map(row => row.key))) url.searchParams.delete(key);
  for (const row of params) url.searchParams.append(row.key, row.value);
  const auth = request.auth;
  if (auth.type === 'inherit') throw new Error('Inherited authorization must be resolved from the collection before sending.');
  if (auth.type === 'basic') headers = setHeader(headers, 'Authorization', `Basic ${Buffer.from(`${resolve(auth.username || '')}:${resolve(auth.password || '')}`).toString('base64')}`);
  if (auth.type === 'bearer') headers = setHeader(headers, 'Authorization', `Bearer ${resolve(auth.token || '')}`);
  if (auth.type === 'apikey') {
    const key = resolve(auth.key || ''); if (!key) throw new Error('Enter the API key name.');
    const value = resolve(auth.value || '');
    if (auth.in === 'query') { url.searchParams.set(key, value); credentialQueryKeys.add(key); }
    else { headers = setHeader(headers, key, value); credentialHeaders.add(key.toLowerCase()); }
  }
  if (url.username || url.password) {
    if (!getHeader(headers, 'authorization')) headers = setHeader(headers, 'Authorization', `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`);
    url.username = ''; url.password = '';
  }
  let body = null;
  if (request.body.mode === 'raw') {
    body = resolve(request.body.raw);
    const contentTypes = { json: 'application/json', xml: 'application/xml', html: 'text/html', javascript: 'application/javascript', text: 'text/plain' };
    if (!getHeader(headers, 'content-type')) headers = setHeader(headers, 'Content-Type', contentTypes[request.body.language]);
  } else if (request.body.mode === 'urlencoded') {
    const fields = new URLSearchParams();
    for (const field of request.body.fields.filter(row => row.enabled && row.key)) fields.append(resolve(field.key), resolve(field.value));
    body = fields.toString();
    if (!getHeader(headers, 'content-type')) headers = setHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded');
  } else if (request.body.mode === 'formdata') {
    body = new FormData();
    for (const field of request.body.fields.filter(row => row.enabled && row.key)) {
      const key = resolve(field.key);
      if (field.type === 'file') {
        const filePath = resolve(field.value), contentType = field.contentType ? resolve(field.contentType) : 'application/octet-stream';
        if (/[\r\n\0]/.test(contentType)) throw new Error('Invalid upload content type.');
        const fileName = field.fileName ? resolve(field.fileName) : path.basename(filePath);
        if (/[\r\n\0]/.test(fileName)) throw new Error('Invalid upload file name.');
        const file = new File([await readUpload(filePath, signal)], fileName, { type: contentType });
        body.append(key, file);
      } else body.append(key, resolve(field.value));
    }
    // Undici creates the boundary together with the body; a hand-entered boundary would not match.
    headers = headers.filter(row => !['content-type', 'content-length'].includes(row.key.toLowerCase()));
  } else if (request.body.mode === 'binary') {
    body = await readUpload(resolve(request.body.filePath || ''), signal);
    if (!getHeader(headers, 'content-type')) headers = setHeader(headers, 'Content-Type', 'application/octet-stream');
  }
  if (!getHeader(headers, 'user-agent')) headers = setHeader(headers, 'User-Agent', 'API-Manager/1.0.0');
  if (!getHeader(headers, 'accept-encoding')) headers = setHeader(headers, 'Accept-Encoding', 'gzip, deflate, br');
  headers.forEach(row => validateHeader(row.key, row.value));
  return { url, headers, body, method: request.method.toUpperCase(), credentialHeaders, credentialQueryKeys };
}
function decodeResponse(bytes, headers) {
  const contentType = getHeader(headers, 'content-type') || '';
  const textual = /^(text\/|application\/(?:.*\+)?(?:json|xml)|application\/(?:javascript|x-javascript|graphql|x-www-form-urlencoded))/i.test(contentType);
  const uncertain = !contentType;
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || 'utf-8';
  let text;
  try { text = new TextDecoder(charset).decode(bytes); } catch { text = bytes.toString('utf8'); }
  const invalidUtf8 = text.includes('\uFFFD') || bytes.includes(0);
  const binary = bytes.length > 0 && (!textual && (!uncertain || invalidUtf8));
  return { body: binary ? bytes.toString('base64') : text, binary };
}
async function collectResponse(body, headers, limit) {
  let stream = body;
  const encoding = getHeader(headers, 'content-encoding')?.toLowerCase().trim();
  const decoders = { gzip: zlib.createGunzip, 'x-gzip': zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress };
  const encodings = encoding ? encoding.split(',').map(value => value.trim()).filter(value => value !== 'identity') : [];
  if (encodings.length && encodings.every(value => decoders[value])) {
    const transforms = encodings.reverse().map(value => decoders[value]());
    stream = transforms.at(-1); pipeline(body, ...transforms, () => {});
  }
  const chunks = []; let size = 0, retained = 0, truncated = false;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (retained < limit) { const part = chunk.subarray(0, limit - retained); chunks.push(part); retained += part.length; }
      if (size > limit) { truncated = true; break; }
    }
  } finally { if (truncated) { stream.destroy(); discardResponse(body); } }
  return { bytes: Buffer.concat(chunks, retained), size, truncated };
}
class RequestEngine {
  constructor({ store } = {}) {
    this.store = store; this.jar = new CookieJar(); this.active = new Map(); this.cookieQueue = Promise.resolve(); this.cookieWarning = undefined;
  }
  async initialize() {
    if (!this.store) return;
    const loaded = await this.store.loadCookies(); this.cookieWarning = loaded.warning;
    if (loaded.value) {
      try { this.jar = await CookieJar.deserialize(loaded.value); }
      catch { this.cookieWarning = 'The saved cookie jar could not be restored. Requests will start with an empty cookie jar.'; }
    }
  }
  persistCookies() {
    if (!this.store) return Promise.resolve();
    const data = this.jar.serializeSync();
    const save = this.cookieQueue.then(() => this.store.saveCookies(data));
    this.cookieQueue = save.catch(() => {}); return save;
  }
  async getCookies() {
    const serialized = await this.jar.serialize(), now = Date.now();
    return serialized.cookies.filter(cookie => !cookie.expires || cookie.expires === 'Infinity' || Date.parse(cookie.expires) > now).map(cookie => ({
      key: cookie.key, value: cookie.value, domain: cookie.domain, path: cookie.path,
      secure: Boolean(cookie.secure), httpOnly: Boolean(cookie.httpOnly),
      ...(cookie.expires && cookie.expires !== 'Infinity' ? { expires: cookie.expires } : {})
    }));
  }
  async clearCookies(domain) {
    if (domain === undefined || domain === '') await this.jar.removeAllCookies();
    else {
      if (typeof domain !== 'string' || !/^[A-Za-z0-9.-]{1,253}$/.test(domain)) throw new Error('Invalid cookie domain.');
      const normalized = domain.replace(/^\./, '').toLowerCase();
      const cookies = await new Promise((resolve, reject) => this.jar.store.getAllCookies((error, value) => error ? reject(error) : resolve(value)));
      for (const cookie of cookies.filter(cookie => cookie.domain.replace(/^\./, '').toLowerCase() === normalized)) {
        await new Promise((resolve, reject) => this.jar.store.removeCookie(cookie.domain, cookie.path, cookie.key, error => error ? reject(error) : resolve()));
      }
    }
    await this.persistCookies();
  }
  cancel(requestId) { this.active.get(requestId)?.controller.abort(new Error('Request cancelled.')); }
  async send(payload) {
    validateSendPayload(payload);
    if (this.active.has(payload.requestId)) throw new Error('A request with this ID is already running.');
    if (payload.request.method.toUpperCase() === 'CONNECT') throw new Error('CONNECT tunneling is not supported by this HTTP client.');
    const controller = new AbortController(); let finished, releaseDynamics;
    const completion = new Promise(resolve => { finished = resolve; });
    this.active.set(payload.requestId, { controller, completion });
    const started = performance.now(); let timedOut = false;
    const timeout = payload.settings.timeout;
    const timer = timeout > 0 ? setTimeout(() => { timedOut = true; controller.abort(new Error(`Request timed out after ${timeout} ms.`)); }, timeout) : null;
    const dispatcher = new Agent({ connect: { rejectUnauthorized: payload.settings.verifySsl, timeout }, allowH2: false, ...(payload.request.auth.type === 'ntlm' ? { connections: 1, pipelining: 1 } : {}) });
    try {
      releaseDynamics = pinDynamics(payload.requestId, payload.variables);
      const resolve = resolveVariables(null, payload.variables, payload.requestId);
      let unsigned = await prepareRequest(payload.request, resolve, controller.signal);
      let prepared = await applyAdvancedAuth(unsigned, payload.request.auth, resolve), authEnabled = true, redirects = 0, authAttempts = 0;
      for (;;) {
        if (controller.signal.aborted) throw controller.signal.reason;
        let headers = [...prepared.headers];
        if (!getHeader(headers, 'cookie')) {
          const cookies = await this.jar.getCookieString(prepared.url.href);
          if (cookies) headers = setHeader(headers, 'Cookie', cookies);
        }
        const result = await httpRequest(prepared.url, {
          dispatcher, method: prepared.method, body: prepared.body,
          headers: headers.flatMap(row => [row.key, row.value]), responseHeaders: 'raw',
          signal: controller.signal, headersTimeout: timeout, bodyTimeout: timeout, maxRedirections: 0
        });
        const responseHeaders = headerRows(result.headers);
        try {
          for (const cookie of responseHeaders.filter(row => row.key.toLowerCase() === 'set-cookie')) await this.jar.setCookie(cookie.value, prepared.url.href, { ignoreError: true });
          await this.persistCookies();
        } catch (error) { discardResponse(result.body); throw error; }
        if (authEnabled && result.statusCode === 401) {
          let authenticated;
          try { authenticated = challengeAuth(payload.request.auth, prepared, responseHeaders, authAttempts + 1, resolve); }
          catch (error) { discardResponse(result.body); throw error; }
          if (authenticated) {
            // NTLM binds its challenge to the socket. Draining, rather than
            // destroying, this small challenge response preserves that connection.
            await result.body.dump({ limit: 1024 * 1024 });
            prepared = { ...prepared, headers: authenticated }; authAttempts++; continue;
          }
        }
        const location = getHeader(responseHeaders, 'location');
        if (payload.settings.followRedirects && REDIRECT_CODES.has(result.statusCode) && location) {
          discardResponse(result.body);
          if (redirects++ >= 10) throw new Error('Too many redirects (maximum 10).');
          const next = validateUrl(new URL(location, prepared.url).href);
          let nextHeaders = unsigned.headers;
          const crossingOrigin = next.origin !== prepared.url.origin;
          for (const key of prepared.credentialQueryKeys || []) next.searchParams.delete(key);
          if (crossingOrigin) { nextHeaders = nextHeaders.filter(row => !prepared.credentialHeaders.has(row.key.toLowerCase())); authEnabled = false; }
          else if (authEnabled && payload.request.auth.type === 'apikey' && payload.request.auth.in === 'query') next.searchParams.set(resolve(payload.request.auth.key), resolve(payload.request.auth.value || ''));
          // A redirect cannot introduce URL credentials without explicit user authorization.
          next.username = ''; next.password = '';
          let method = prepared.method, body = prepared.body;
          if ((result.statusCode === 303 && method !== 'HEAD') || ([301, 302].includes(result.statusCode) && method === 'POST')) {
            method = 'GET'; body = null; nextHeaders = nextHeaders.filter(row => !['content-type', 'content-length'].includes(row.key.toLowerCase()));
          }
          unsigned = { ...unsigned, url: next, method, body, headers: nextHeaders };
          prepared = authEnabled ? await applyAdvancedAuth(unsigned, payload.request.auth, resolve) : unsigned;
          authAttempts = 0; continue;
        }
        const collected = await collectResponse(result.body, responseHeaders, Math.floor(payload.settings.maxResponseMB * 1024 * 1024));
        const decoded = decodeResponse(collected.bytes, responseHeaders);
        return {
          status: result.statusCode, statusText: result.statusText || require('node:http').STATUS_CODES[result.statusCode] || '',
          headers: responseHeaders, ...decoded, duration: Math.round((performance.now() - started) * 100) / 100,
          size: collected.size, url: prepared.url.href, receivedAt: new Date().toISOString(), truncated: collected.truncated
        };
      }
    } catch (error) {
      if (controller.signal.aborted) throw new Error(timedOut ? `Request timed out after ${timeout} ms.` : 'Request cancelled.');
      const cause = error.cause?.message;
      throw new Error(cause && cause !== error.message ? `${error.message}: ${cause}` : error.message || 'The request failed.');
    } finally {
      releaseDynamics?.();
      if (timer) clearTimeout(timer);
      await dispatcher.destroy().catch(() => {});
      this.active.delete(payload.requestId); finished();
    }
  }
  async flush() { await this.cookieQueue; if (this.store) await this.store.flush(); }
  async shutdown() {
    const pending = [...this.active.values()]; pending.forEach(entry => entry.controller.abort(new Error('Application closing.')));
    await Promise.all(pending.map(entry => entry.completion)); await this.flush();
  }
}

module.exports = { RequestEngine, resolveVariables, prepareRequest, decodeResponse };
