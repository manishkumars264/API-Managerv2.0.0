import type { ApiCollection, ApiFolder, ApiRequest, KeyValue, RequestAuth, Workspace } from '../types';
import { createDynamicResolver } from '../../shared/dynamic-variables.mjs';
export { SUPPORTED_DYNAMIC_VARIABLES, DYNAMIC_VARIABLE_GROUPS } from '../../shared/dynamic-variables.mjs';

/** Exact names, enabled values, recursive references, and explicit unresolved errors. */
export function resolveVariables(text: string, rows: KeyValue[]): string {
  return createVariableResolver(rows)(text);
}

/** Reuse across URL, headers, body, and auth to keep a send/export's dynamic values stable. */
export function createVariableResolver(rows: KeyValue[], initialDynamics: Record<string, string> = {}): (text: string) => string {
  const values = new Map(rows.filter(v => v.enabled && v.key).map(v => [v.key, String(v.value)]));
  const dynamic = createDynamicResolver(initialDynamics);
  const resolve = (input: string, chain: string[]): string => input.replace(/\{\{([^{}]+)\}\}/g, (token, rawName: string) => {
    const name = rawName.trim();
    if (chain.includes(name)) throw new Error(`Circular variable reference: ${[...chain, name].join(' → ')}`);
    if (chain.length >= 30) throw new Error('Variable references exceed the maximum nesting depth (30).');
    const value = values.get(name) ?? dynamic(name);
    if (value === undefined) throw new Error(`Unresolved variable: ${token}`);
    return resolve(value, [...chain, name]);
  });
  return text => resolve(text, []);
}

type Location = { collection: ApiCollection; folders: ApiFolder[]; request?: ApiRequest };

function findFolders(folders: ApiFolder[], request: ApiRequest, ancestors: ApiFolder[] = []): ApiFolder[] | undefined {
  for (const folder of folders) {
    const path = [...ancestors, folder];
    if (folder.id === request.folderId || folder.requests.some(r => r.id === request.id)) return path;
    const nested = findFolders(folder.folders, request, path);
    if (nested) return nested;
  }
  return undefined;
}

function locate(workspace: Workspace, request: ApiRequest): Location | undefined {
  const candidates = request.collectionId ? workspace.collections.filter(c => c.id === request.collectionId) : workspace.collections;
  for (const collection of candidates) {
    const folders = findFolders(collection.folders, request);
    const direct = collection.requests.find(r => r.id === request.id);
    if (folders || direct || collection.id === request.collectionId) return { collection, folders: folders ?? [], request: direct ?? folders?.at(-1)?.requests.find(r => r.id === request.id) };
  }
  return undefined;
}

/** Global < collection < parent folder < child folder < active environment. */
export function requestVariables(workspace: Workspace, request: ApiRequest): KeyValue[] {
  const location = locate(workspace, request);
  const environment = workspace.environments.find(e => e.id === workspace.activeEnvironmentId);
  const scopes = [workspace.globals, location?.collection.variables ?? [], ...(location?.folders.map(f => f.variables ?? []) ?? []), environment?.variables ?? []];
  const merged = new Map<string, KeyValue>();
  for (const scope of scopes) for (const variable of scope) if (variable.enabled && variable.key) merged.set(variable.key, variable);
  return [...merged.values()];
}

export function effectiveAuth(workspace: Workspace, request: ApiRequest): RequestAuth {
  if (request.auth.type !== 'inherit') return request.auth;
  const location = locate(workspace, request);
  for (const folder of [...(location?.folders ?? [])].reverse()) {
    if (folder.auth && folder.auth.type !== 'inherit') return folder.auth;
  }
  if (location?.collection.auth && location.collection.auth.type !== 'inherit') return location.collection.auth;
  return { type: 'none' };
}

export function findRequest(workspace: Workspace, id: string): ApiRequest | undefined {
  const findInFolders = (folders: ApiFolder[]): ApiRequest | undefined => {
    for (const folder of folders) {
      const found = folder.requests.find(r => r.id === id) ?? findInFolders(folder.folders);
      if (found) return found;
    }
    return undefined;
  };
  for (const collection of workspace.collections) {
    const found = collection.requests.find(r => r.id === id) ?? findInFolders(collection.folders);
    if (found) return found;
  }
  return undefined;
}

export function updateCollectionRequest(workspace: Workspace, request: ApiRequest): Workspace {
  const updateFolders = (folders: ApiFolder[]): ApiFolder[] => folders.map(folder => ({ ...folder,
    requests: folder.requests.map(r => r.id === request.id ? { ...request, folderId: folder.id } : r), folders: updateFolders(folder.folders),
  }));
  return { ...workspace, collections: workspace.collections.map(collection => ({ ...collection,
    requests: collection.requests.map(r => r.id === request.id ? { ...request, collectionId: collection.id, folderId: undefined } : r), folders: updateFolders(collection.folders),
  })) };
}

export function removeCollectionRequest(workspace: Workspace, id: string): Workspace {
  const removeFolders = (folders: ApiFolder[]): ApiFolder[] => folders.map(folder => ({ ...folder, requests: folder.requests.filter(r => r.id !== id), folders: removeFolders(folder.folders) }));
  return { ...workspace, collections: workspace.collections.map(collection => ({ ...collection, requests: collection.requests.filter(r => r.id !== id), folders: removeFolders(collection.folders) })) };
}
