import type { ApiFolder, ApiRequest, KeyValue, Workspace } from '../types';
import { requestVariables, SUPPORTED_DYNAMIC_VARIABLES } from './variables';

export type VariableStatus = 'resolved' | 'dynamic' | 'missing' | 'error';
export interface VariableSource { scope: 'Global' | 'Collection' | 'Folder' | 'Environment' | 'Dynamic'; name: string; }
export interface VariableDetails { name: string; status: VariableStatus; source?: VariableSource; value?: string; rawValue?: string; message?: string; environmentName?: string; }
export interface VariableToken { start: number; end: number; expression: string; details: VariableDetails; }
export interface VariableContextValue { describe(name: string): VariableDetails; tokens(value: string): VariableToken[]; }
const dynamicNames = new Set(SUPPORTED_DYNAMIC_VARIABLES);

/** Reads Send's effective rows without invoking dynamic generators. */
export function buildVariableContext(workspace: Workspace, request?: ApiRequest): VariableContextValue {
  const environment = workspace.environments.find(item => item.id === workspace.activeEnvironmentId);
  const rows = request ? requestVariables(workspace, request) : [...workspace.globals, ...(environment?.variables ?? [])].filter(item => item.enabled && item.key);
  const values = new Map(rows.map(item => [item.key, item]));
  const sources = new Map<KeyValue, VariableSource>();
  workspace.globals.forEach(item => sources.set(item, { scope: 'Global', name: 'Globals' }));
  const folders = (items: ApiFolder[], parents: string[]) => items.forEach(folder => {
    const path = [...parents, folder.name];
    folder.variables?.forEach(item => sources.set(item, { scope: 'Folder', name: path.join(' / ') }));
    folders(folder.folders, path);
  });
  workspace.collections.forEach(collection => {
    collection.variables.forEach(item => sources.set(item, { scope: 'Collection', name: collection.name }));
    folders(collection.folders, [collection.name]);
  });
  environment?.variables.forEach(item => sources.set(item, { scope: 'Environment', name: environment.name }));
  const cache = new Map<string, VariableDetails>();
  const resolve = (name: string, chain: string[]): { value: string; dynamic: boolean } => {
    if (chain.includes(name)) throw new Error(`Circular variable reference: ${[...chain, name].join(' → ')}`);
    if (chain.length >= 30) throw new Error('Variable references exceed the maximum nesting depth (30).');
    const item = values.get(name);
    if (!item) {
      if (dynamicNames.has(name)) return { value: `{{${name}}}`, dynamic: true };
      throw new Error(`Unresolved variable: {{${name}}}`);
    }
    let dynamic = false;
    const value = item.value.replace(/\{\{([^{}]+)\}\}/g, (_expression, rawName: string) => {
      const result = resolve(rawName.trim(), [...chain, name]); dynamic ||= result.dynamic; return result.value;
    });
    return { value, dynamic };
  };
  const describe = (rawName: string): VariableDetails => {
    const name = rawName.trim(), previous = cache.get(name); if (previous) return previous;
    const item = values.get(name);
    let details: VariableDetails;
    if (!item && dynamicNames.has(name)) details = { name, status: 'dynamic', source: { scope: 'Dynamic', name: 'Built-in variable' }, message: 'Generated when sent', environmentName: environment?.name };
    else if (!item) details = { name, status: 'missing', message: 'This variable is not defined in the current request context.', environmentName: environment?.name };
    else {
      try {
        const result = resolve(name, []);
        details = { name, status: result.dynamic ? 'dynamic' : 'resolved', source: sources.get(item), value: result.value, rawValue: item.value, message: result.dynamic ? 'Includes dynamic values generated when sent' : undefined, environmentName: environment?.name };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        details = { name, status: message.startsWith('Unresolved variable:') ? 'missing' : 'error', source: sources.get(item), rawValue: item.value, message, environmentName: environment?.name };
      }
    }
    cache.set(name, details); return details;
  };
  return { describe, tokens(value) {
    const tokens: VariableToken[] = [];
    for (const match of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
      tokens.push({ start: match.index!, end: match.index! + match[0].length, expression: match[0], details: describe(match[1]) });
      if (tokens.length >= 2000) break;
    }
    return tokens;
  } };
}
