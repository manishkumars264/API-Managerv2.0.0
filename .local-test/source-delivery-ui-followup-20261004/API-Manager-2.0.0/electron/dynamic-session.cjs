'use strict';

const { randomUUID } = require('node:crypto');
const sessions = new Map();
const MAX_SESSIONS = 256, EXPIRY_MS = 5 * 60 * 1000;

function dynamicSession(requestId, rows = []) {
  const { createDynamicResolver, SUPPORTED_DYNAMIC_VARIABLES } = require('../shared/dynamic-variables.mjs');
  const now = Date.now(), id = requestId || randomUUID();
  for (const [key, entry] of sessions) if (!entry.pins && now - entry.updated > EXPIRY_MS) sessions.delete(key);
  let entry = sessions.get(id);
  if (!entry) {
    while (sessions.size >= MAX_SESSIONS) {
      const idle = [...sessions].find(([, value]) => !value.pins);
      if (!idle) throw new Error('Too many simultaneous API operations (maximum 256).');
      sessions.delete(idle[0]);
    }
    const initial = Object.fromEntries(rows.filter(row => row.enabled && row.key.startsWith('$') && row.extra?.apiManagerScriptDynamic === true).map(row => [row.key, row.value]));
    entry = { updated: now, pins: 0, get: createDynamicResolver(initial) }; sessions.set(id, entry);
  } else { entry.updated = now; sessions.delete(id); sessions.set(id, entry); }
  return {
    get: entry.get, dictionary: () => Object.fromEntries(SUPPORTED_DYNAMIC_VARIABLES.map(name => [name, entry.get(name)])),
    pin: () => {
      entry.pins++; let released = false;
      return () => { if (!released) { released = true; entry.pins--; entry.updated = Date.now(); } };
    }
  };
}
function pinDynamics(requestId, rows) { return dynamicSession(requestId, rows).pin(); }
function forgetDynamics(requestId) { sessions.delete(requestId); }
function clearDynamics() { sessions.clear(); }
module.exports = { dynamicSession, pinDynamics, forgetDynamics, clearDynamics };
