import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENT_COLORS, ACCENT_PALETTES, GREY_THEME, applyAccent, editorThemeName, normalizeAccent } from '../src/lib/appearance';

const stylesheet = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const luminance = (hex: string) => {
  const [red, green, blue] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return red * .2126 + green * .7152 + blue * .0722;
};
const contrast = (foreground: string, background: string) => {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + .05) / (low + .05);
};

describe('accent appearance', () => {
  it('recovers unknown stored choices to the default blue', () => {
    for (const value of [null, undefined, '', 'default', 'unknown', '__proto__', {}, 1]) expect(normalizeAccent(value)).toBe('blue');
    for (const color of ACCENT_COLORS) expect(normalizeAccent(color)).toBe(color);
  });

  it('changes only the accent attribute and preserves the existing theme', () => {
    const element = { dataset: { theme: 'light', accent: 'blue' } };
    expect(applyAccent('purple', element)).toBe('purple');
    expect(element.dataset).toEqual({ theme: 'light', accent: 'purple' });
    expect(applyAccent('invalid', element)).toBe('blue');
    expect(element.dataset.theme).toBe('light');
  });

  for (const color of ACCENT_COLORS) {
    for (const theme of ['dark', 'light', 'grey'] as const) {
      it(`${color} in ${theme} keeps white buttons and accent text readable`, () => {
        const palette = ACCENT_PALETTES[color][theme];
        expect(contrast('#ffffff', palette.button)).toBeGreaterThanOrEqual(4.5);
        expect(contrast('#ffffff', palette.hover)).toBeGreaterThanOrEqual(4.5);
        const backgrounds = theme === 'grey' ? [GREY_THEME.bg, GREY_THEME.surface, GREY_THEME.raised, GREY_THEME.hover, GREY_THEME.editor] : [theme === 'dark' ? '#202020' : '#ffffff'];
        for (const background of backgrounds) expect(contrast(palette.accent, background)).toBeGreaterThanOrEqual(4.5);
        if (theme === 'grey') {
          expect(palette.button).toBe(ACCENT_PALETTES[color].light.button);
          expect(palette.hover).toBe(ACCENT_PALETTES[color].light.hover);
        }
      });

      it(`${color} in ${theme} uses the tested palette in the rendered stylesheet`, () => {
        const selector = theme === 'dark' ? `:root[data-accent='${color}']` : `:root[data-theme='${theme}'][data-accent='${color}']`;
        const start = stylesheet.indexOf(selector);
        expect(start).toBeGreaterThanOrEqual(0);
        const block = stylesheet.slice(stylesheet.indexOf('{', start) + 1, stylesheet.indexOf('}', start));
        const palette = ACCENT_PALETTES[color][theme];
        for (const [token, value] of [['--orange', palette.accent], ['--orange-soft', palette.soft], ['--accent-button', palette.button], ['--accent-hover', palette.hover]]) expect(block).toContain(`${token}: ${value};`);
      });
    }
  }

  it('keeps grey neutral, lighter than dark, and clearly distinct from light', () => {
    expect(luminance(GREY_THEME.bg)).toBeGreaterThan(.5);
    expect(luminance(GREY_THEME.bg)).toBeLessThan(luminance('#f7f7f7') - .1);
    for (const foreground of [GREY_THEME.text, GREY_THEME.muted, GREY_THEME.soft, GREY_THEME.green, GREY_THEME.red, GREY_THEME.blue, GREY_THEME.yellow]) {
      for (const background of [GREY_THEME.bg, GREY_THEME.surface, GREY_THEME.raised, GREY_THEME.hover, GREY_THEME.editor]) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('maps persisted themes to matching editor appearances and recovers unknown values', () => {
    expect(editorThemeName('dark')).toBe('vs-dark');
    expect(editorThemeName('light')).toBe('vs');
    expect(editorThemeName('grey')).toBe('api-manager-grey');
    expect(editorThemeName(undefined)).toBe('vs-dark');
  });
});
