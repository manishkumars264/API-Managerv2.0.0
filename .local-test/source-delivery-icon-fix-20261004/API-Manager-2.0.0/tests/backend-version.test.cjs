'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { APP_VERSION } = require('../shared/app-version.cjs');
const { bugReportMailto, openBugReportDraft } = require('../electron/bug-report.cjs');
const { prepareRequest } = require('../electron/request.cjs');

test('native release metadata and default bug drafts use the package version', async () => {
  assert.equal(APP_VERSION, require('../package.json').version);
  assert.equal(APP_VERSION, '2.0.0');
  const draft = new URL(bugReportMailto());
  assert.equal(draft.searchParams.get('subject'), `API Manager v${APP_VERSION} - Issue found`);
  assert.match(draft.searchParams.get('body'), /Application version: API Manager v2\.0\.0/);
  let opened;
  await openBugReportDraft({ openExternal: async url => { opened = url; } });
  assert.equal(opened, draft.href);
});

test('native default user-agent follows the app version and preserves an explicit user-agent', async () => {
  const request = { method: 'GET', url: 'https://example.test', params: [], headers: [], auth: { type: 'none' }, body: { mode: 'none', raw: '', language: 'json', fields: [] } };
  const prepared = await prepareRequest(request, value => value);
  assert.equal(prepared.headers.find(row => row.key.toLowerCase() === 'user-agent').value, `API-Manager/${APP_VERSION}`);
  request.headers = [{ key: 'User-Agent', value: 'Custom client', enabled: true }];
  const custom = await prepareRequest(request, value => value);
  assert.equal(custom.headers.find(row => row.key.toLowerCase() === 'user-agent').value, 'Custom client');
});
