import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currentRelease } from '../src/lib/release-notes';
import { exportEnvironment, exportGlobals } from '../src/lib/import-export';

const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

describe('application release metadata', () => {
  it('keeps the package, lockfile root, and frontend current release in sync', () => {
    expect(packageInfo.version).toBe('2.0.0');
    expect(lock.version).toBe(packageInfo.version);
    expect(lock.packages[''].version).toBe(packageInfo.version);
    expect(currentRelease.version).toBe(packageInfo.version);
  });
  it('marks exported environments and globals with the current application version', () => {
    const environment = JSON.parse(exportEnvironment({ id: 'environment', name: 'Local', variables: [] }));
    const globals = JSON.parse(exportGlobals([]));
    expect(environment._postman_exported_using).toBe(`API Manager/${packageInfo.version}`);
    expect(globals._postman_exported_using).toBe(`API Manager/${packageInfo.version}`);
    expect(environment._postman_variable_scope).toBe('environment');
    expect(globals._postman_variable_scope).toBe('globals');
  });
});
