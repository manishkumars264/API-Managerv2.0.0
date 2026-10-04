import type { ApiRequest, ApiResponse, ApiFolder, ScriptLog, ScriptResult, ScriptTest, Workspace, KeyValue } from '../types';
import { bridge } from './bridge';
import { requestVariables } from './variables';

function scopePath(workspace: Workspace, request: ApiRequest) {
  const collection = workspace.collections.find(c => c.id === request.collectionId);
  const find = (folders: ApiFolder[], parents: ApiFolder[] = []): ApiFolder[] | undefined => {
    for (const folder of folders) { const path = [...parents, folder]; if (folder.id === request.folderId || folder.requests.some(r => r.id === request.id)) return path; const child = find(folder.folders, path); if (child) return child; }
  };
  return { collection, folders: find(collection?.folders ?? []) ?? [] };
}
export function scriptPrograms(workspace: Workspace, request: ApiRequest, stage: 'pre-request' | 'post-response') {
  const { collection, folders } = scopePath(workspace, request);
  const field = stage === 'pre-request' ? 'preRequest' : 'postResponse';
  return [collection, ...folders, request].flatMap(scope => scope?.scripts?.[field]?.trim() ? [{ name: scope.name, source: scope.scripts[field] }] : []);
}
export function applyScriptResult(workspace: Workspace, request: ApiRequest, result: ScriptResult) {
  const next = structuredClone(workspace);
  next.globals = result.globals;
  const environment = next.environments.find(e => e.id === next.activeEnvironmentId);
  if (environment) environment.variables = result.environment;
  const collection = next.collections.find(c => c.id === request.collectionId);
  if (collection) collection.variables = result.collectionVariables;
  return { workspace: next, request: result.request };
}
/** Apply only script changes so edits in other tabs/scopes during a send survive. */
export function mergeScriptChanges(current: Workspace, before: Workspace, after: Workspace): void {
  const merge = (values: KeyValue[], old: KeyValue[], updated: KeyValue[]) => {
    const previous = new Map(old.map(row => [row.id, row]));
    const next = new Map(updated.map(row => [row.id, row]));
    const changed = new Set([...previous.keys(), ...next.keys()].filter(id => JSON.stringify(previous.get(id)) !== JSON.stringify(next.get(id))));
    const currentIds = new Set(values.map(row => row.id));
    return [...values.flatMap(row => !changed.has(row.id) ? [row] : next.has(row.id) ? [next.get(row.id)!] : []), ...updated.filter(row => changed.has(row.id) && !currentIds.has(row.id))];
  };
  current.globals = merge(current.globals, before.globals, after.globals);
  for (const environment of current.environments) {
    const old = before.environments.find(e => e.id === environment.id), updated = after.environments.find(e => e.id === environment.id);
    if (old && updated) environment.variables = merge(environment.variables, old.variables, updated.variables);
  }
  for (const collection of current.collections) {
    const old = before.collections.find(c => c.id === collection.id), updated = after.collections.find(c => c.id === collection.id);
    if (old && updated) collection.variables = merge(collection.variables, old.variables, updated.variables);
  }
}
export async function runScripts(workspace: Workspace, request: ApiRequest, stage: 'pre-request' | 'post-response', response?: ApiResponse, variables?: KeyValue[], requestId?: string) {
  let next = structuredClone(workspace), prepared = structuredClone(request);
  let effective = variables ?? requestVariables(next, prepared);
  const tests: ScriptTest[] = [], logs: ScriptLog[] = [];
  let error: string | undefined;
  for (const program of scriptPrograms(workspace, request, stage)) {
    const result = await bridge.runScript({ script: program.source, stage, request: prepared, response, globals: next.globals, environment: next.environments.find(e => e.id === next.activeEnvironmentId)?.variables ?? [], collectionVariables: next.collections.find(c => c.id === request.collectionId)?.variables ?? [], folderVariables: scopePath(next, request).folders.flatMap(folder => folder.variables ?? []), variables: effective, requestId });
    const applied = applyScriptResult(next, prepared, result); next = applied.workspace; prepared = applied.request; effective = result.variables;
    tests.push(...result.tests.slice(0, Math.max(0, 1000 - tests.length)).map(test => ({ ...test, name: `${program.name}: ${test.name}`.slice(0, 1000), ...(test.error ? { error: test.error.slice(0, 10000) } : {}) })));
    logs.push(...result.logs.slice(0, Math.max(0, 1000 - logs.length)).map(log => ({ ...log, message: `${program.name}: ${log.message}`.slice(0, 10000) })));
    if (result.error) { error = `${program.name}: ${result.error}`.slice(0, 10000); break; }
  }
  return { workspace: next, request: prepared, variables: effective, tests, logs, error };
}
