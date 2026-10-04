'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { dynamicSession, pinDynamics, forgetDynamics, clearDynamics } = require('../electron/dynamic-session.cjs');
const { resolveVariables } = require('../electron/request.cjs');
const { SUPPORTED_DYNAMIC_VARIABLES } = require('../shared/dynamic-variables.mjs');

test.after(clearDynamics);
test('all allowed Postman dynamic names resolve to cached string values without evaluation', () => {
  const requestId = randomUUID(), session = dynamicSession(requestId), dictionary = session.dictionary();
  assert.ok(SUPPORTED_DYNAMIC_VARIABLES.length > 50);
  for (const name of SUPPORTED_DYNAMIC_VARIABLES) {
    assert.equal(typeof dictionary[name], 'string', name);
    assert.equal(session.get(name), dictionary[name], name);
    assert.equal(resolveVariables(`{{ ${name} }}`, [], requestId), dictionary[name], name);
  }
  assert.throws(() => resolveVariables('{{$faker.internet.password()}}', [], requestId), /Unresolved variable/);
});
test('dynamic sessions reuse flight samples, accept known samples and release on cancellation', () => {
  const id = randomUUID(), value = dynamicSession(id).get('$randomUUID');
  assert.equal(dynamicSession(id).get('$randomUUID'), value);
  assert.notEqual(dynamicSession(randomUUID()).get('$randomUUID'), value);
  forgetDynamics(id); assert.notEqual(dynamicSession(id).get('$randomUUID'), value);
  const supplied = dynamicSession(randomUUID(), [{ id: randomUUID(), enabled: true, key: '$randomUUID', value: 'previous-sample', extra: { apiManagerScriptDynamic: true } }]);
  assert.equal(supplied.get('$randomUUID'), 'previous-sample');
  assert.equal(supplied.get('$unrecognized'), undefined);
  const explicit = dynamicSession(randomUUID(), [{ id: randomUUID(), enabled: true, key: '$randomUUID', value: 'saved-override' }]);
  assert.match(explicit.get('$randomUUID'), /^[0-9a-f-]{36}$/i);
});
test('active flight samples survive idle expiry and cache pressure, then expire after release', t => {
  clearDynamics(); let now = 1000; t.mock.method(Date, 'now', () => now);
  const id = randomUUID(), release = pinDynamics(id), original = dynamicSession(id).get('$randomUUID');
  now += 6 * 60 * 1000;
  for (let index = 0; index < 300; index++) dynamicSession(randomUUID()).get('$randomUUID');
  assert.equal(dynamicSession(id).get('$randomUUID'), original);
  release(); release(); now += 6 * 60 * 1000;
  assert.notEqual(dynamicSession(id).get('$randomUUID'), original);
});
test('all-active cache refuses excess concurrent operations rather than evicting active samples', () => {
  clearDynamics(); const releases = Array.from({ length: 256 }, () => pinDynamics(randomUUID()));
  assert.throws(() => pinDynamics(randomUUID()), /Too many simultaneous/);
  releases[0](); const next = pinDynamics(randomUUID()); next(); releases.forEach(release => release());
  clearDynamics();
});
