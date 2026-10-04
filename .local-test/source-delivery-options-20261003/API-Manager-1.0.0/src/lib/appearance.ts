export type AccentColor = 'blue' | 'red' | 'orange' | 'green' | 'purple';

export interface AccentTokens {
  accent: string;
  soft: string;
  button: string;
  hover: string;
}

export interface AccentPalette {
  label: string;
  dark: AccentTokens;
  light: AccentTokens;
}

export const DEFAULT_ACCENT: AccentColor = 'blue';

export const ACCENT_PALETTES: Record<AccentColor, AccentPalette> = {
  blue: {
    label: 'Blue',
    dark: { accent: '#4b94d4', soft: '#4b94d41c', button: '#337ab7', hover: '#28679c' },
    light: { accent: '#337ab7', soft: '#337ab712', button: '#337ab7', hover: '#28679c' },
  },
  red: {
    label: 'Red',
    dark: { accent: '#ed7a83', soft: '#ed7a831c', button: '#bc3f4b', hover: '#a5323e' },
    light: { accent: '#bc3f4b', soft: '#bc3f4b12', button: '#bc3f4b', hover: '#a5323e' },
  },
  orange: {
    label: 'Orange',
    dark: { accent: '#ec935a', soft: '#ec935a1c', button: '#b94f1d', hover: '#a34216' },
    light: { accent: '#b94f1d', soft: '#b94f1d12', button: '#b94f1d', hover: '#a34216' },
  },
  green: {
    label: 'Green',
    dark: { accent: '#63bd8c', soft: '#63bd8c1c', button: '#277b50', hover: '#206641' },
    light: { accent: '#277b50', soft: '#277b5012', button: '#277b50', hover: '#206641' },
  },
  purple: {
    label: 'Purple',
    dark: { accent: '#b192e6', soft: '#b192e61c', button: '#7951b7', hover: '#66419e' },
    light: { accent: '#7951b7', soft: '#7951b712', button: '#7951b7', hover: '#66419e' },
  },
};

export const ACCENT_COLORS = Object.keys(ACCENT_PALETTES) as AccentColor[];

export function normalizeAccent(value: unknown): AccentColor {
  return typeof value === 'string' && Object.hasOwn(ACCENT_PALETTES, value) ? value as AccentColor : DEFAULT_ACCENT;
}

export function applyAccent(value: unknown, element?: Pick<HTMLElement, 'dataset'>): AccentColor {
  const accent = normalizeAccent(value);
  const target = element ?? (typeof document === 'undefined' ? undefined : document.documentElement);
  if (target) target.dataset.accent = accent;
  return accent;
}
