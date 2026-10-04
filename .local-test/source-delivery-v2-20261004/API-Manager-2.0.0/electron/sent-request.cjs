'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const diagnostics = require('node:diagnostics_channel');
const { FormData } = require('undici');

const INLINE_BODY_LIMIT = 2 * 1024 * 1024;
const MAX_CURL_BYTES = 16 * 1024 * 1024;
const currentCapture = new AsyncLocalStorage();
const requests = new WeakMap();
const quote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
const formQuote = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const expectsPayload = method => ['PUT', 'POST', 'PATCH', 'QUERY', 'PROPFIND', 'PROPPATCH'].includes(method);

// These documented Undici events observe the existing transport; they never
// regenerate variables, signatures, cookies, or multipart boundaries.
diagnostics.channel('undici:request:create').subscribe(({ request }) => {
  const capture = currentCapture.getStore(); if (!capture) return;
  try { capture.request = request; requests.set(request, capture); } catch { capture.captureIssue = true; }
});
diagnostics.channel('undici:client:sendHeaders').subscribe(({ request, headers }) => {
  const capture = requests.get(request); if (!capture) return;
  try {
    capture.headersWritten = true;
    capture.url = new URL(request.path, request.origin).href;
    capture.headers = String(headers).split('\r\n').slice(1).filter(Boolean).map(line => {
      const colon = line.indexOf(':'); return { key: line.slice(0, colon), value: line.slice(colon + 1).replace(/^ /, '') };
    });
  } catch { capture.captureIssue = true; }
});
diagnostics.channel('undici:request:bodyChunkSent').subscribe(({ request, chunk }) => {
  const capture = requests.get(request); if (!capture) return;
  try {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    capture.bytesSent += bytes.length;
    if (capture.bytesSent <= INLINE_BODY_LIMIT) capture.chunks.push(Buffer.from(bytes));
    else { capture.chunks = []; capture.inlineOverflow = true; }
  } catch { capture.captureIssue = true; }
});
diagnostics.channel('undici:request:bodySent').subscribe(({ request }) => {
  const capture = requests.get(request); if (capture) capture.bodyComplete = true;
});

function captureRequest(prepared, details = {}) {
  const url = new URL(prepared.url); url.hash = '';
  return { prepared, details, url: url.href, headers: prepared.headers.map(row => ({ ...row })), headersWritten: false, chunks: [], bytesSent: 0, bodyComplete: false, inlineOverflow: false, captureIssue: false };
}
function withRequestCapture(capture, run) { return currentCapture.run(capture, run); }

function sentRequestMetadata(capture) {
  if (!capture) return null;
  const { prepared, details } = capture, notes = [];
  let headers = capture.headers.map(row => ({ ...row }));
  const parts = ['curl', '--http1.1', '--globoff', '--path-as-is', `--request ${quote(prepared.method)}`, `--url ${quote(capture.url)}`];
  if (details.verifySsl === false) parts.push('--insecure');
  if (!capture.headersWritten) notes.push('Request was prepared, but no HTTP headers were transmitted.');
  else if (!capture.bodyComplete && prepared.body !== null) notes.push('The request body did not finish transmitting; this command contains the prepared body.');
  if (details.redirects || details.authAttempts) notes.push(`Captured the final HTTP attempt after ${details.redirects || 0} redirect(s) and ${details.authAttempts || 0} authentication challenge(s).`);
  if (details.authType === 'ntlm') notes.push('The captured NTLM handshake header is bound to the original connection and cannot be replayed independently.');
  if (capture.captureIssue) notes.push('Some native transport details could not be captured.');

  let prefix = '', hasBody = capture.request ? capture.request.body !== null : prepared.body !== null;
  const descriptor = prepared.curlBody || { mode: 'none' };
  let bytes;
  if (hasBody && capture.bodyComplete && !capture.inlineOverflow && !capture.captureIssue) bytes = Buffer.concat(capture.chunks, capture.bytesSent);
  else if (typeof prepared.body === 'string') bytes = Buffer.from(prepared.body);
  const multipart = prepared.body instanceof FormData;
  if (hasBody && bytes) {
    const text = bytes.toString('utf8');
    if (!text.startsWith('@') && !bytes.includes(0) && Buffer.from(text).equals(bytes)) parts.push(`--data-binary ${quote(text)}`);
    else { prefix = `printf '%s' ${quote(bytes.toString('base64'))} | base64 --decode | \\\n`; parts.push('--data-binary @-'); notes.push('Body bytes are embedded as base64; this command requires a POSIX shell with base64.'); }
  } else if (hasBody && descriptor.mode === 'binary') {
    parts.push(`--data-binary ${quote(`@${descriptor.filePath}`)}`);
    notes.push('Body exceeds the inline capture limit or did not finish transmitting. This command rereads the resolved local file; keep its contents unchanged.');
  } else if (hasBody && descriptor.mode === 'formdata') {
    headers = headers.filter(row => !['content-type', 'content-length'].includes(row.key.toLowerCase()));
    for (const field of descriptor.fields) {
      if (field.type === 'file') parts.push(`--form ${quote(`${field.key}=@${formQuote(field.value)};type=${field.contentType};filename=${formQuote(field.fileName)}`)}`);
      else parts.push(`--form-string ${quote(`${field.key}=${field.value}`)}`);
    }
    notes.push('Multipart body exceeds the 2 MB inline capture limit or did not finish transmitting. This command rebuilds the resolved fields with a new boundary and rereads local files; keep their contents unchanged.');
  } else if (hasBody) { hasBody = false; notes.push('Request body could not be included in the captured command.'); }

  // Undici publishes its serialized header prefix before adding the body framing.
  // All supported bodies have a known byte length, including our buffered files.
  if (capture.headersWritten && (!multipart || bytes) && !headers.some(row => ['content-length', 'transfer-encoding'].includes(row.key.toLowerCase()))) {
    const length = capture.request?.contentLength ?? (bytes ? bytes.length : Buffer.isBuffer(prepared.body) ? prepared.body.length : hasBody ? undefined : expectsPayload(prepared.method) ? 0 : undefined);
    if (length !== undefined && length !== null && (length !== 0 || expectsPayload(prepared.method))) headers.push({ key: 'content-length', value: String(length) });
  }
  // cURL's default Accept header is absent from native Undici requests.
  if (!headers.some(row => row.key.toLowerCase() === 'accept')) parts.push(`--header ${quote('Accept:')}`);
  if (!headers.some(row => row.key.toLowerCase() === 'user-agent')) parts.push(`--header ${quote('User-Agent:')}`);
  if (!headers.some(row => row.key.toLowerCase() === 'expect')) parts.push(`--header ${quote('Expect:')}`);
  for (const row of headers) parts.push(`--header ${quote(row.value === '' ? `${row.key};` : `${row.key}: ${row.value}`)}`);
  const sentCurl = prefix + parts.join(' \\\n  '), metadata = { requestUrl: capture.url };
  if (Buffer.byteLength(sentCurl) <= MAX_CURL_BYTES) metadata.sentCurl = sentCurl;
  else notes.push('The captured cURL exceeds the 16 MB snapshot limit and was omitted; the request itself was sent normally.');
  if (notes.length) metadata.sentCurlNote = notes.join(' ');
  return metadata;
}

module.exports = { captureRequest, withRequestCapture, sentRequestMetadata, MAX_CURL_BYTES };
