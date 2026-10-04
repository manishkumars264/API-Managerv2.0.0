export const CONSOLE_HEIGHT_STORAGE_KEY = 'api-manager-console-height';
export const DEFAULT_CONSOLE_HEIGHT = 270;
const MIN_CONSOLE_HEIGHT = 90;
const MIN_WORKSPACE_HEIGHT = 360;

export interface ConsoleHeightBounds { min: number; max: number; }

export function readConsoleHeight(value: string | null): number {
  if (!value?.trim()) return DEFAULT_CONSOLE_HEIGHT;
  const height = Number(value);
  return Number.isFinite(height) && height >= MIN_CONSOLE_HEIGHT && height <= 10000 ? Math.round(height) : DEFAULT_CONSOLE_HEIGHT;
}

/** Reserve the request workspace first; small windows still retain a usable console. */
export function consoleHeightBounds(viewportHeight: number, availableHeight: number): ConsoleHeightBounds {
  const viewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const available = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0;
  const min = Math.floor(Math.min(MIN_CONSOLE_HEIGHT, available));
  const max = Math.floor(Math.max(min, Math.min(viewport * .65, available - MIN_WORKSPACE_HEIGHT)));
  return { min, max };
}

export function clampConsoleHeight(height: number, bounds: ConsoleHeightBounds): number {
  return Math.max(bounds.min, Math.min(Number.isFinite(height) ? Math.round(height) : DEFAULT_CONSOLE_HEIGHT, bounds.max));
}
