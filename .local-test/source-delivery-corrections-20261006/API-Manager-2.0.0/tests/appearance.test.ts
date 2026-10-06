import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENT_COLORS, ACCENT_PALETTES, GREY_EDITOR_HIGHLIGHTS, GREY_EDITOR_RULES, GREY_THEME, applyAccent, editorThemeName, normalizeAccent } from '../src/lib/appearance';

const stylesheet = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const luminance = (hex: string) => {
  const [red, green, blue] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return red * .2126 + green * .7152 + blue * .0722;
};
const contrast = (foreground: string, background: string) => {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + .05) / (low + .05);
};

// Alpha highlights tint the surface behind a variable; test the visible result.
const blend = (foreground: string, background: string) => {
  const alpha = parseInt(foreground.slice(7, 9), 16) / 255;
  return '#' + [1, 3, 5].map(offset => Math.round(parseInt(foreground.slice(offset, offset + 2), 16) * alpha + parseInt(background.slice(offset, offset + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('');
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
    // Mid-grey stays clearly between the near-black and near-white themes.
    expect(luminance(GREY_THEME.bg)).toBeGreaterThan(.25);
    expect(luminance(GREY_THEME.bg)).toBeLessThan(.4);
    for (const value of [GREY_THEME.bg, GREY_THEME.surface, GREY_THEME.raised, GREY_THEME.hover, GREY_THEME.editor]) {
      expect(value.slice(1, 3)).toBe(value.slice(3, 5));
      expect(value.slice(3, 5)).toBe(value.slice(5, 7));
    }
    for (const foreground of [GREY_THEME.text, GREY_THEME.muted, GREY_THEME.soft, GREY_THEME.green, GREY_THEME.red, GREY_THEME.blue, GREY_THEME.yellow, GREY_THEME.purple, GREY_THEME.pink]) {
      for (const background of [GREY_THEME.bg, GREY_THEME.surface, GREY_THEME.raised, GREY_THEME.hover, GREY_THEME.editor]) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps syntax readable on grey editors, selections, current lines and search matches', () => {
    for (const rule of GREY_EDITOR_RULES) {
      if (!('foreground' in rule) || !rule.foreground) continue;
      for (const background of [GREY_THEME.editor, ...Object.values(GREY_EDITOR_HIGHLIGHTS)]) {
        expect(contrast(`#${rule.foreground}`, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps grey variables readable on tinted surfaces, including missing-variable errors', () => {
    const backgrounds = [GREY_THEME.bg, GREY_THEME.surface, GREY_THEME.raised, GREY_THEME.hover, GREY_THEME.editor, ...Object.values(GREY_EDITOR_HIGHLIGHTS)];
    for (const background of backgrounds) {
      for (const color of ACCENT_COLORS) {
        const palette = ACCENT_PALETTES[color].grey;
        expect(contrast(palette.accent, blend(palette.soft, background))).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(GREY_THEME.red, blend('#ba454518', background))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('maps persisted themes to matching editor appearances and recovers unknown values', () => {
    expect(editorThemeName('dark')).toBe('vs-dark');
    expect(editorThemeName('light')).toBe('vs');
    expect(editorThemeName('grey')).toBe('api-manager-grey');
    expect(editorThemeName(undefined)).toBe('vs-dark');
  });
});
