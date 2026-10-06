import { describe, expect, it } from 'vitest';
import { clampConsoleHeight, consoleHeightBounds, DEFAULT_CONSOLE_HEIGHT, readConsoleHeight } from '../src/lib/console-height';

describe('console height preferences and available workspace', () => {
  it('rejects corrupt or unreasonable stored sizes', () => {
    for (const value of [null, '', 'NaN', 'Infinity', '-20', '50', '10001', '{"height":270}']) expect(readConsoleHeight(value)).toBe(DEFAULT_CONSOLE_HEIGHT);
    expect(readConsoleHeight('385')).toBe(385);
  });
  it('keeps at least 360 pixels of workspace and caps large consoles at 65% of the viewport', () => {
    expect(consoleHeightBounds(720, 606)).toEqual({ min: 90, max: 246 });
    expect(consoleHeightBounds(1440, 1326)).toEqual({ min: 90, max: 936 });
  });
  it('fits small windows without pushing the console beyond its available space', () => {
    expect(consoleHeightBounds(300, 180)).toEqual({ min: 90, max: 90 });
    expect(consoleHeightBounds(80, 60)).toEqual({ min: 60, max: 60 });
    expect(consoleHeightBounds(0, 0)).toEqual({ min: 0, max: 0 });
  });
  it('clamps display height while allowing the saved preference to return in a larger window', () => {
    const saved = readConsoleHeight('500');
    expect(clampConsoleHeight(saved, consoleHeightBounds(720, 606))).toBe(246);
    expect(clampConsoleHeight(saved, consoleHeightBounds(1080, 966))).toBe(500);
    expect(clampConsoleHeight(-10, { min: 90, max: 300 })).toBe(90);
  });
});
