'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { captureRequest, sentRequestMetadata, MAX_CURL_BYTES } = require('../electron/sent-request.cjs');

test('oversized captured commands are omitted with an explicit note instead of saving an invalid truncated command', () => {
  const capture = captureRequest({ url: new URL('http://127.0.0.1/large'), method: 'POST', headers: [], body: "'".repeat(Math.floor(MAX_CURL_BYTES / 4) + 1) });
  const metadata = sentRequestMetadata(capture);
  assert.equal(metadata.sentCurl, undefined); assert.equal(metadata.requestUrl, 'http://127.0.0.1/large'); assert.match(metadata.sentCurlNote, /16 MB snapshot limit/);
});
test('native snapshots suppress cURL defaults when those headers were absent', () => {
  const metadata = sentRequestMetadata(captureRequest({ url: new URL('http://127.0.0.1/'), method: 'GET', headers: [], body: null }));
  for (const name of ['Accept:', 'User-Agent:', 'Expect:']) assert.ok(metadata.sentCurl.includes(`--header '${name}'`));
});
