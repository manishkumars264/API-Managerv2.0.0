'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bugReportMailto, openBugReportDraft } = require('../electron/bug-report.cjs');

test('bug report opens only a fixed recipient email draft with encoded subject and template', async () => {
  const opened = [];
  await openBugReportDraft({ openExternal: async url => { opened.push(url); } }, '2.0.0');
  assert.equal(opened.length, 1);
  const url = new URL(opened[0]);
  assert.equal(url.protocol, 'mailto:'); assert.equal(url.pathname, 'manishkumars264@gmail.com');
  assert.equal(url.searchParams.get('subject'), 'API Manager v2.0.0 - Issue found');
  const body = url.searchParams.get('body');
  assert.match(body, /Summary \/ description:/); assert.match(body, /1\.\r\n2\.\r\n3\./);
  assert.match(body, /Expected result \(optional\)/); assert.match(body, /Actual result \(optional\)/);
  assert.match(body, /Screenshots \/ videos: Please attach/); assert.match(body, /Application version: API Manager v2\.0\.0/);
  assert.equal(opened[0], bugReportMailto('2.0.0')); assert.match(opened[0], /%0D%0A/);
  assert.deepEqual([...url.searchParams.keys()], ['subject', 'body']);
});
test('unavailable mail association gives a useful error without exposing native details', async () => {
  await assert.rejects(openBugReportDraft({ openExternal: async () => { throw new Error('Native file association missing'); } }, '2.0.0'), /Set a default email app, or email manishkumars264@gmail\.com/);
});
