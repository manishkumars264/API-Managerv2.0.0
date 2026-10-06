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
  grey: AccentTokens;
}

export const DEFAULT_ACCENT: AccentColor = 'blue';

export const ACCENT_PALETTES: Record<AccentColor, AccentPalette> = {
  blue: {
    label: 'Blue',
    dark: { accent: '#4b94d4', soft: '#4b94d41c', button: '#337ab7', hover: '#28679c' },
    light: { accent: '#337ab7', soft: '#337ab712', button: '#337ab7', hover: '#28679c' },
    grey: { accent: '#092a45', soft: '#092a4512', button: '#337ab7', hover: '#28679c' },
  },
  red: {
    label: 'Red',
    dark: { accent: '#ed7a83', soft: '#ed7a831c', button: '#bc3f4b', hover: '#a5323e' },
    light: { accent: '#bc3f4b', soft: '#bc3f4b12', button: '#bc3f4b', hover: '#a5323e' },
    grey: { accent: '#501019', soft: '#50101912', button: '#bc3f4b', hover: '#a5323e' },
  },
  orange: {
    label: 'Orange',
    dark: { accent: '#ec935a', soft: '#ec935a1c', button: '#b94f1d', hover: '#a34216' },
    light: { accent: '#b94f1d', soft: '#b94f1d12', button: '#b94f1d', hover: '#a34216' },
    grey: { accent: '#481903', soft: '#48190312', button: '#b94f1d', hover: '#a34216' },
  },
  green: {
    label: 'Green',
    dark: { accent: '#63bd8c', soft: '#63bd8c1c', button: '#277b50', hover: '#206641' },
    light: { accent: '#277b50', soft: '#277b5012', button: '#277b50', hover: '#206641' },
    grey: { accent: '#092f1a', soft: '#092f1a12', button: '#277b50', hover: '#206641' },
  },
  purple: {
    label: 'Purple',
    dark: { accent: '#b192e6', soft: '#b192e61c', button: '#7951b7', hover: '#66419e' },
    light: { accent: '#7951b7', soft: '#7951b712', button: '#7951b7', hover: '#66419e' },
    grey: { accent: '#301c4a', soft: '#301c4a12', button: '#7951b7', hover: '#66419e' },
  },
};

export const ACCENT_COLORS = Object.keys(ACCENT_PALETTES) as AccentColor[];

/** Neutral medium-grey surfaces; accent buttons retain their existing colors. */
export const GREY_THEME = {
  bg: '#9e9e9e', surface: '#a8a8a8', raised: '#b4b4b4', hover: '#999999', editor: '#aaaaaa',
  border: '#747474', borderSubtle: '#8d8d8d', text: '#202020', muted: '#303030', soft: '#2e2e2e',
  green: '#092f1a', red: '#501019', blue: '#092a45', yellow: '#422c02', purple: '#301c4a', pink: '#4b1f3a',
} as const;

/** Editor highlights stay distinct without changing the readability of syntax. */
export const GREY_EDITOR_HIGHLIGHTS = {
  line: '#b2b2b2', selection: '#b6c4d1', inactiveSelection: '#b4b4b4', search: '#d4b15e',
} as const;

// A complete palette avoids inheriting light-theme syntax colors with weak grey contrast.
export const GREY_EDITOR_RULES = [
  { token: '', foreground: GREY_THEME.text.slice(1), background: GREY_THEME.editor.slice(1) },
  { token: 'invalid', foreground: GREY_THEME.red.slice(1) },
  { token: 'emphasis', fontStyle: 'italic' },
  { token: 'strong', fontStyle: 'bold' },
  ...[
    ['comment', GREY_THEME.muted], ['annotation', GREY_THEME.muted], ['delimiter', GREY_THEME.text],
    ['operator', GREY_THEME.text], ['variable', GREY_THEME.blue], ['constant', GREY_THEME.red],
    ['number', GREY_THEME.green], ['regexp', GREY_THEME.red], ['type', GREY_THEME.green],
    ['tag', GREY_THEME.red], ['meta', GREY_THEME.purple], ['metatag', GREY_THEME.purple],
    ['key', GREY_THEME.yellow], ['string', GREY_THEME.red], ['string.key.json', GREY_THEME.red],
    ['string.value.json', GREY_THEME.blue], ['attribute.name', GREY_THEME.red],
    ['attribute.value', GREY_THEME.blue], ['attribute.value.number', GREY_THEME.green],
    ['attribute.value.unit', GREY_THEME.green], ['keyword', GREY_THEME.blue],
    ['keyword.flow', GREY_THEME.purple], ['predefined', GREY_THEME.purple],
  ].map(([token, foreground]) => ({ token, foreground: foreground.slice(1) })),
];

export function editorThemeName(theme: unknown): 'vs' | 'vs-dark' | 'api-manager-grey' {
  return theme === 'grey' ? 'api-manager-grey' : theme === 'light' ? 'vs' : 'vs-dark';
}

export function normalizeAccent(value: unknown): AccentColor {
  return typeof value === 'string' && Object.hasOwn(ACCENT_PALETTES, value) ? value as AccentColor : DEFAULT_ACCENT;
}

export function applyAccent(value: unknown, element?: Pick<HTMLElement, 'dataset'>): AccentColor {
  const accent = normalizeAccent(value);
  const target = element ?? (typeof document === 'undefined' ? undefined : document.documentElement);
  if (target) target.dataset.accent = accent;
  return accent;
}
