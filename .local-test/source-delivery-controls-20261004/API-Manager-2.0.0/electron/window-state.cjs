'use strict';

function validateWindowState(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || typeof value.maximized !== 'boolean') throw new Error('Invalid saved window layout.');
  for (const key of ['x', 'y']) if (!Number.isFinite(value[key]) || Math.abs(value[key]) > 65536) throw new Error('Invalid saved window position.');
  for (const key of ['width', 'height']) if (!Number.isFinite(value[key]) || value[key] < 100 || value[key] > 16384) throw new Error('Invalid saved window size.');
  return value;
}
function visibleWindowBounds(value, displays) {
  if (!value) return {};
  validateWindowState(value);
  const width = Math.max(1000, value.width), height = Math.max(650, value.height);
  const visible = displays.some(display => {
    const area = display.workArea;
    return Math.min(value.x + width, area.x + area.width) - Math.max(value.x, area.x) >= 100 &&
      Math.min(value.y + height, area.y + area.height) - Math.max(value.y, area.y) >= 100;
  });
  return { width, height, ...(visible ? { x: value.x, y: value.y } : {}) };
}
module.exports = { validateWindowState, visibleWindowBounds };
