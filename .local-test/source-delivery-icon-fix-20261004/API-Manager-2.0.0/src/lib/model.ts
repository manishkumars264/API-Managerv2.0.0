import type { ApiRequest, KeyValue, Workspace } from '../types';
export const uid = () => crypto.randomUUID();
export const row = (key = '', value = ''): KeyValue => ({ id: uid(), key, value, enabled: true });
export const newRequest = (name = 'Untitled request'): ApiRequest => ({ id: uid(), name, method: 'GET', url: '', params: [], headers: [], body: { mode: 'none', raw: '', language: 'json', fields: [] }, auth: { type: 'none' }, description: '' });
export const newTab = (request = newRequest()) => ({ id: uid(), request, dirty: false, editorTab: 'Params', responseTab: 'Body', responseZoom: 14 });
export function initialWorkspace(): Workspace {
  const tab = newTab();
  return { version: 1, collections: [], environments: [], globals: [], activeEnvironmentId: null, tabs: [tab], activeTabId: tab.id, history: [], settings: { theme: 'dark', timeout: 30000, followRedirects: true, verifySsl: true, maxResponseMB: 20 }, sidebarView: 'collections', sidebarWidth: 268 };
}
