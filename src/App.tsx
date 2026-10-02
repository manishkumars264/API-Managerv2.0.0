import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, CircleHelp, Code2, Copy, Download, FileJson2, FolderOpen, HardDrive, Loader2, MoreHorizontal, Plus, Save, Search, Send, Settings2, ShieldCheck, Trash2, WrapText, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { ApiCollection, ApiFolder, ApiRequest, CookieEntry, Environment, HistoryEntry, KeyValue, RequestAuth, RequestScripts, RequestTab, Workspace } from './types';
import { initialWorkspace, newRequest, newTab, row, uid } from './lib/model';
import { bridge } from './lib/bridge';
import { importData, exportCollection, exportEnvironment, exportWorkspace, exportGlobals } from './lib/import-export';
import { exportCurl } from './lib/curl';
import { effectiveAuth, requestVariables } from './lib/variables';
import { beautify, configureSoap, responseDocument } from './lib/format';
import { mergeScriptChanges, runScripts } from './lib/scripts';
import { ConsolePanel } from './components/Console';
import { CodeEditor, disposeEditors } from './components/CodeEditor';
import { RequestFields } from './components/RequestFields';
import { Sidebar } from './components/Sidebar';
import { AuthEditor } from './components/AuthEditor';
import './styles.css';

type Modal = { kind: 'import' } | { kind: 'save'; request: ApiRequest; tabId?: string; move?: boolean } | { kind: 'settings' } | { kind: 'cookies' } | { kind: 'collection'; collectionId: string; folderId?: string } | { kind: 'name'; title: string; value: string; label?: string; submit: (name: string) => void } | { kind: 'confirm'; title: string; message: string; action: () => void };
type Notice = { id: string; text: string; error: boolean };
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const clone = <T,>(value: T): T => structuredClone(value);
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const fileName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'response';
const folderList = (folders: ApiFolder[], prefix = ''): { id: string; name: string }[] => folders.flatMap(folder => [{ id: folder.id, name: prefix + folder.name }, ...folderList(folder.folders, prefix + folder.name + ' / ')]);
function paramsFromUrl(url: string): KeyValue[] {
  const query = url.split('#')[0].split('?').slice(1).join('?');
  return query ? [...new URLSearchParams(query)].map(([key, value]) => row(key, value)) : [];
}
function urlWithParams(url: string, params: KeyValue[]) {
  const index = url.indexOf('#'); const hash = index === -1 ? '' : url.slice(index); const base = (index === -1 ? url : url.slice(0, index)).split('?')[0];
  const encode = (text: string) => text.split(/(\{\{[^{}]+\}\})/g).map(part => /^\{\{[^{}]+\}\}$/.test(part) ? part : encodeURIComponent(part)).join('');
  const query = params.filter(item => item.enabled && item.key).map(item => `${encode(item.key)}=${encode(item.value)}`).join('&');
  return `${base}${query ? `?${query}` : ''}${hash}`;
}
function findFolder(folders: ApiFolder[], id?: string): ApiFolder | undefined {
  for (const folder of folders) { if (folder.id === id) return folder; const child = findFolder(folder.folders, id); if (child) return child; }
}
function allRequests(collection: ApiCollection): ApiRequest[] {
  const flatten = (folders: ApiFolder[]): ApiRequest[] => folders.flatMap(folder => [...folder.requests, ...flatten(folder.folders)]);
  return [...collection.requests, ...flatten(collection.folders)];
}
function removeRequest(workspace: Workspace, id: string) {
  const remove = (node: { requests: ApiRequest[]; folders: ApiFolder[] }) => { node.requests = node.requests.filter(request => request.id !== id); node.folders.forEach(remove); };
  workspace.collections.forEach(remove);
}
function removeFolder(folders: ApiFolder[], id: string): ApiFolder[] { return folders.filter(folder => folder.id !== id).map(folder => ({ ...folder, folders: removeFolder(folder.folders, id) })); }
function prettyBody(body: string, language = 'json') { try { return beautify(body, language); } catch { return body; } }
function withoutPreservedAuth(extra?: Record<string, unknown>) {
  if (!extra) return extra;
  const next = clone(extra);
  if (next.postman && typeof next.postman === 'object') delete (next.postman as Record<string, unknown>).auth;
  return next;
}
function responseLanguage(tab: RequestTab): string {
  const contentType = tab.response?.headers.find(header => header.key.toLowerCase() === 'content-type')?.value || '';
  if (/json/i.test(contentType) || /^[\[{]/.test(tab.response?.body.trim() || '')) return 'json';
  if (/html/i.test(contentType)) return 'html';
  if (/xml/i.test(contentType)) return 'xml';
  return 'text';
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const latest = useRef(workspace);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [storagePath, setStoragePath] = useState('');
  const [saveStatus, setSaveStatus] = useState('Loading local workspace…');
  const [modal, setModal] = useState<Modal | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const flights = useRef(new Map<string, string>());
  const runSnapshots = useRef(new Map<string, HistoryEntry>());
  const [pendingRuns, setPendingRuns] = useState<HistoryEntry[]>([]);
  const [selectedEnvironment, setSelectedEnvironment] = useState<string | null>(() => localStorage.getItem('api-manager-selected-environment') || null);
  const [menu, setMenu] = useState<'workspace' | 'request' | 'copy' | 'download' | null>(null);
  const [wrap, setWrap] = useState(() => localStorage.getItem('api-manager-wrap') !== 'false');
  const [consoleOpen, setConsoleOpen] = useState(() => localStorage.getItem('api-manager-console-open') === 'true');
  const [requestHeight, setRequestHeight] = useState(() => Number(localStorage.getItem('api-manager-request-height')) || 300);
  const tabsRef = useRef<HTMLDivElement>(null);
  const notify = useCallback((text: string, error = false) => {
    const id = uid(); setNotices(previous => [...previous.slice(-3), { id, text, error }]);
    if (!error) setTimeout(() => setNotices(previous => previous.filter(notice => notice.id !== id)), 4500);
  }, []);
  const mutate = useCallback((fn: (next: Workspace) => void) => {
    const next = clone(latest.current); fn(next); latest.current = next; setWorkspace(next);
  }, []);
  latest.current = workspace;
  const persist = useCallback((value: Workspace) => {
    setSaveStatus('Saving…');
    const task = bridge.saveWorkspace(clone(value));
    task.then(() => setSaveStatus('All changes saved locally')).catch(error => { setSaveStatus('Could not save workspace'); notify(`Your changes could not be saved: ${messageOf(error)}`, true); });
    return task;
  }, [notify]);
  const load = useCallback(() => {
    setLoadError(false); setSaveStatus('Loading local workspace…');
    void bridge.loadWorkspace().then(result => {
      const loaded = result.workspace || initialWorkspace();
      if (!loaded.tabs.length) { const tab = newTab(); loaded.tabs = [tab]; loaded.activeTabId = tab.id; }
      if (!loaded.tabs.some(tab => tab.id === loaded.activeTabId)) loaded.activeTabId = loaded.tabs[0].id;
      latest.current = loaded; setWorkspace(loaded); setStoragePath(result.storagePath); setReady(true); setSaveStatus('All changes saved locally');
      setSelectedEnvironment(previous => previous === 'globals' || loaded.environments.some(item => item.id === previous) ? previous : loaded.sidebarView === 'environments' ? loaded.activeEnvironmentId || 'globals' : null);
      if (result.warning) notify(result.warning, true);
    }).catch(error => { notify(`Could not load your workspace: ${messageOf(error)}`, true); setSaveStatus('Workspace could not be loaded'); setLoadError(true); });
  }, [notify]);
  useEffect(() => {
    load();
    return bridge.onSaveRequested(() => { void persist(latest.current); });
  }, [load, persist]);
  useEffect(() => { if (ready) localStorage.setItem('api-manager-selected-environment', selectedEnvironment || ''); }, [selectedEnvironment, ready]);
  useEffect(() => { localStorage.setItem('api-manager-console-open', String(consoleOpen)); }, [consoleOpen]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { void persist(workspace); }, 350);
    return () => clearTimeout(timer);
  }, [workspace, ready, persist]);
  useEffect(() => { document.documentElement.dataset.theme = workspace.settings.theme; }, [workspace.settings.theme]);
  const current = workspace.tabs.find(tab => tab.id === workspace.activeTabId) || workspace.tabs[0];
  const request = current?.request;
  const patchRequest = useCallback((change: Partial<ApiRequest>) => mutate(next => { const tab = next.tabs.find(item => item.id === next.activeTabId); if (tab) { tab.request = { ...tab.request, ...change }; tab.dirty = true; } }), [mutate]);
  const patchTab = (change: Partial<RequestTab>) => mutate(next => { const tab = next.tabs.find(item => item.id === next.activeTabId); if (tab) Object.assign(tab, change); });
  const updateRun = useCallback((tabId: string, entry?: HistoryEntry) => {
    if (entry) runSnapshots.current.set(tabId, clone(entry)); else runSnapshots.current.delete(tabId);
    setPendingRuns([...runSnapshots.current.values()]);
  }, []);
  const addTab = useCallback((value?: ApiRequest, duplicate = false) => {
    const request = value ? clone(value) : newRequest();
    if (duplicate) { request.id = uid(); request.name = `${request.name} copy`; }
    mutate(next => {
      const existing = !duplicate && value && next.tabs.find(tab => tab.request.id === value.id);
      if (existing) next.activeTabId = existing.id;
      else { const tab = newTab(request); if (duplicate) tab.dirty = true; next.tabs.push(tab); next.activeTabId = tab.id; }
    });
    setSelectedEnvironment(null);
  }, [mutate]);
  const closeTab = (tab: RequestTab) => {
    const close = () => {
      const flight = flights.current.get(tab.id); if (flight) {
        flights.current.delete(tab.id); void bridge.cancelRequest(flight).catch(error => notify(messageOf(error), true));
        const snapshot = clone(runSnapshots.current.get(tab.id) || { id: flight, request: tab.request, timestamp: new Date().toISOString() });
        mutate(next => { next.history.unshift({ ...snapshot, error: 'Request cancelled when its tab was closed.' }); next.history = next.history.slice(0, 200); });
        updateRun(tab.id);
      }
      mutate(next => { const index = next.tabs.findIndex(item => item.id === tab.id); next.tabs = next.tabs.filter(item => item.id !== tab.id); if (!next.tabs.length) next.tabs.push(newTab()); if (next.activeTabId === tab.id) next.activeTabId = next.tabs[Math.max(0, index - 1)]?.id || next.tabs[0].id; });
      setTimeout(() => disposeEditors(tab.id), 0);
      setBusy(previous => { const next = { ...previous }; delete next[tab.id]; return next; });
    };
    if (tab.dirty) setModal({ kind: 'confirm', title: 'Close this request?', message: 'Changes in this tab have not been saved to a collection. Closing the tab will discard this draft.', action: close }); else close();
  };
  const saveRequest = useCallback(() => {
    const ws = latest.current; const tab = ws.tabs.find(item => item.id === ws.activeTabId); if (!tab) return;
    const collection = ws.collections.find(item => item.id === tab.request.collectionId);
    if (!collection || !allRequests(collection).some(item => item.id === tab.request.id)) { setModal({ kind: 'save', request: clone(tab.request), tabId: tab.id }); return; }
    mutate(next => {
      const active = next.tabs.find(item => item.id === tab.id)!;
      const target = next.collections.find(item => item.id === active.request.collectionId)!;
      const saved = allRequests(target).find(item => item.id === active.request.id)!;
      Object.assign(saved, clone(active.request)); active.dirty = false;
    });
    notify('Request saved to collection.');
  }, [mutate, notify]);
  const sendRequest = useCallback(async (tabId?: string) => {
    const ws = clone(latest.current); const tab = ws.tabs.find(item => item.id === (tabId || ws.activeTabId)); if (!tab || flights.current.has(tab.id)) return;
    if (!tab.request.url.trim()) { notify('Enter a request URL before sending.', true); return; }
    const requestId = uid(); let executedRequest = clone(tab.request);
    let scriptResults: NonNullable<RequestTab['scriptResults']> = { tests: [], logs: [] };
    flights.current.set(tab.id, requestId); setBusy(previous => ({ ...previous, [tab.id]: true }));
    const startedAt = new Date().toISOString();
    updateRun(tab.id, { id: requestId, request: clone(tab.request), timestamp: startedAt });
    mutate(next => { const target = next.tabs.find(item => item.id === tab.id); if (target) { delete target.response; delete target.scriptResults; } });
    try {
      const pre = await runScripts(ws, tab.request, 'pre-request', undefined, undefined, requestId);
      if (flights.current.get(tab.id) !== requestId) return;
      executedRequest = pre.request;
      scriptResults = { tests: pre.tests.slice(0, 1000), logs: pre.logs.slice(0, 1000), ...(pre.error ? { error: pre.error.slice(0, 10000) } : {}) };
      updateRun(tab.id, { id: requestId, request: executedRequest, timestamp: startedAt, scriptResults });
      mutate(next => { mergeScriptChanges(next, ws, pre.workspace); const target = next.tabs.find(item => item.id === tab.id); if (target) target.scriptResults = clone(scriptResults); });
      if (pre.error) throw new Error(`Pre-request script failed: ${pre.error}`);
      const payloadRequest = { ...executedRequest, auth: effectiveAuth(pre.workspace, executedRequest) };
      const response = await bridge.sendRequest({ request: payloadRequest, variables: pre.variables, settings: ws.settings, requestId });
      if (flights.current.get(tab.id) !== requestId) return;
      // Show the network response immediately, even while response tests are running.
      mutate(next => { const target = next.tabs.find(item => item.id === tab.id); if (target) target.response = response; });
      updateRun(tab.id, { id: requestId, request: executedRequest, timestamp: startedAt, response, scriptResults });
      const post = await runScripts(pre.workspace, executedRequest, 'post-response', response, pre.variables, requestId);
      if (flights.current.get(tab.id) !== requestId) return;
      scriptResults = { tests: [...pre.tests, ...post.tests].slice(0, 1000), logs: [...pre.logs, ...post.logs].slice(0, 1000), ...(post.error ? { error: post.error.slice(0, 10000) } : {}) };
      mutate(next => {
        mergeScriptChanges(next, pre.workspace, post.workspace);
        const target = next.tabs.find(item => item.id === tab.id); if (target) { target.response = response; target.scriptResults = clone(scriptResults); }
        next.history.unshift({ id: requestId, request: clone(executedRequest), response, timestamp: response.receivedAt, scriptResults: clone(scriptResults), ...(post.error ? { error: `Post-response script: ${post.error}`.slice(0, 10000) } : {}) }); next.history = next.history.slice(0, 200);
      });
      if (post.error) notify(`Post-response script failed: ${post.error}`, true);
      if (response.truncated) notify('Response reached your size limit. Increase the limit in Settings to receive a larger body.', true);
    } catch (cause) {
      if (flights.current.get(tab.id) !== requestId) return;
      const error = messageOf(cause); notify(error, true);
      scriptResults.error = error.slice(0, 10000);
      mutate(next => { const target = next.tabs.find(item => item.id === tab.id); if (target) target.scriptResults = clone(scriptResults); next.history.unshift({ id: requestId, request: clone(executedRequest), ...(target?.response ? { response: target.response } : {}), timestamp: new Date().toISOString(), error: error.slice(0, 10000), scriptResults: clone(scriptResults) }); next.history = next.history.slice(0, 200); });
    } finally {
      if (flights.current.get(tab.id) === requestId) { flights.current.delete(tab.id); updateRun(tab.id); setBusy(previous => ({ ...previous, [tab.id]: false })); }
    }
  }, [mutate, notify, updateRun]);
  const openHistory = useCallback((entry: HistoryEntry, run = false) => {
    const replay = clone(entry.request); replay.id = uid();
    const tab = { ...newTab(replay), historyId: entry.id, ...(entry.response ? { response: clone(entry.response) } : {}), ...(entry.scriptResults ? { scriptResults: clone(entry.scriptResults) } : {}) };
    mutate(next => { next.tabs.push(tab); next.activeTabId = tab.id; }); setSelectedEnvironment(null);
    if (run) void sendRequest(tab.id);
  }, [mutate, sendRequest]);
  const cancelRequest = async () => {
    if (!current) return; const requestId = flights.current.get(current.id); if (!requestId) return;
    flights.current.delete(current.id); setBusy(previous => ({ ...previous, [current.id]: false }));
    const snapshot = clone(runSnapshots.current.get(current.id) || { id: requestId, request: current.request, timestamp: new Date().toISOString() });
    mutate(next => { next.history.unshift({ ...snapshot, error: 'Request cancelled.' }); next.history = next.history.slice(0, 200); });
    updateRun(current.id);
    try { await bridge.cancelRequest(requestId); notify('Request cancelled.'); } catch (error) { notify(messageOf(error), true); }
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setModal(null); setMenu(null); }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (modal) { if (['n', 's', 'Enter'].includes(event.key.toLowerCase()) || event.key === 'Enter') event.preventDefault(); return; }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); addTab(); }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); saveRequest(); }
      if (event.key === 'Enter') { event.preventDefault(); void sendRequest(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [addTab, saveRequest, sendRequest, modal]);
  useEffect(() => { tabsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [workspace.activeTabId]);
  const download = async (name: string, content: string) => { try { if (await bridge.saveFile(name, content)) notify(`${name} saved.`); } catch (error) { notify(messageOf(error), true); } };
  const copy = async (content: string, label = 'Copied to clipboard.') => { try { await navigator.clipboard.writeText(content); notify(label); } catch (error) { notify(`Could not copy: ${messageOf(error)}`, true); } };
  const copyCurl = (request: ApiRequest) => {
    try { void copy(exportCurl({ ...request, auth: effectiveAuth(workspace, request) }, requestVariables(workspace, request)), 'cURL copied.'); }
    catch (error) { notify(`Could not generate cURL: ${messageOf(error)}`, true); }
  };
  const importContent = (sources: { name: string; content: string }[]) => {
    try {
      const results = sources.map(source => importData(source.content, source.name));
      const complete = results.find(result => result.workspace);
      if (complete?.workspace) {
        if (sources.length !== 1) { notify('Import a workspace backup on its own.', true); return false; }
        const value = clone(complete.workspace);
        setModal({ kind: 'confirm', title: 'Restore this workspace?', message: 'This replaces your current collections, environments, tabs, and history. Export a workspace backup first if you want to keep the current workspace.', action: () => { flights.current.forEach(id => { void bridge.cancelRequest(id); }); flights.current.clear(); runSnapshots.current.clear(); setPendingRuns([]); setBusy({}); latest.current = value; setWorkspace(value); setSelectedEnvironment(null); notify('Workspace restored.'); } });
        return false;
      }
      mutate(next => {
        results.forEach(result => {
          next.collections.push(...result.collections); next.environments.push(...result.environments);
          if (result.globals) { const incoming = new Set(result.globals.map(value => value.key)); next.globals = [...next.globals.filter(value => !incoming.has(value.key)), ...result.globals]; }
          if (result.tabs?.length) { next.tabs.push(...result.tabs); next.activeTabId = result.tabs[result.tabs.length - 1].id; }
        });
      });
      const count = results.reduce((count, result) => count + result.collections.length + result.environments.length + (result.tabs?.length || 0) + (result.globals ? 1 : 0), 0);
      notify(`Imported ${count} ${count === 1 ? 'item' : 'items'}.`);
      results.flatMap(result => result.warnings).forEach(warning => notify(warning, true));
      return true;
    } catch (error) { notify(`Import failed: ${messageOf(error)}`, true); return false; }
  };
  const saveToCollection = (value: ApiRequest, collectionId: string, folderId: string | undefined, tabId?: string, moving = false) => {
    mutate(next => {
      removeRequest(next, value.id);
      const request = { ...clone(value), collectionId, folderId };
      const collection = next.collections.find(item => item.id === collectionId)!;
      (findFolder(collection.folders, folderId) || collection).requests.push(request);
      next.tabs.forEach(tab => {
        if (tab.id === tabId || tab.request.id === value.id) {
          if (moving && tab.dirty) { tab.request.collectionId = collectionId; tab.request.folderId = folderId; }
          else { tab.request = clone(request); tab.dirty = false; }
        }
      });
    });
    notify('Request saved to collection.'); setModal(null);
  };
  const action = (key: string, id?: string, collectionId?: string) => {
    setMenu(null);
    const collection = workspace.collections.find(item => item.id === (collectionId || id));
    const folder = findFolder(collection?.folders || [], id);
    const savedRequest = workspace.collections.flatMap(allRequests).find(item => item.id === id);
    const nameDialog = (title: string, value: string, submit: (name: string) => void) => setModal({ kind: 'name', title, value, submit });
    if (key === 'settings') setModal({ kind: 'settings' });
    if (key === 'cookies') setModal({ kind: 'cookies' });
    if (key === 'new-collection') nameDialog('Create collection', '', name => { mutate(next => next.collections.push({ id: uid(), name, description: '', folders: [], requests: [], variables: [], auth: { type: 'none' } })); notify('Collection created.'); });
    if (key === 'new-environment') nameDialog('Create environment', '', name => { const environment: Environment = { id: uid(), name, variables: [] }; mutate(next => { next.environments.push(environment); next.sidebarView = 'environments'; }); setSelectedEnvironment(environment.id); });
    if (key === 'rename-collection' && collection) nameDialog('Rename collection', collection.name, name => mutate(next => { next.collections.find(item => item.id === collection.id)!.name = name; }));
    if (key === 'rename-folder' && folder && collection) nameDialog('Rename folder', folder.name, name => mutate(next => { findFolder(next.collections.find(item => item.id === collection.id)!.folders, folder.id)!.name = name; }));
    if (key === 'rename-request' && savedRequest) nameDialog('Rename request', savedRequest.name, name => mutate(next => { next.collections.forEach(item => allRequests(item).forEach(request => { if (request.id === savedRequest.id) request.name = name; })); next.tabs.forEach(tab => { if (tab.request.id === savedRequest.id) tab.request.name = name; }); }));
    if ((key === 'new-folder' || key === 'new-folder-child') && collection) nameDialog('Create folder', '', name => mutate(next => { const target = next.collections.find(item => item.id === collection.id)!; (key === 'new-folder-child' ? findFolder(target.folders, id)! : target).folders.push({ id: uid(), name, folders: [], requests: [] }); }));
    if ((key === 'new-request-collection' || key === 'new-request-folder') && collection) { const request = newRequest(); request.collectionId = collection.id; if (key === 'new-request-folder') request.folderId = id; addTab(request); setModal({ kind: 'save', request, tabId: undefined }); }
    if ((key === 'edit-collection' || key === 'edit-folder') && collection) setModal({ kind: 'collection', collectionId: collection.id, folderId: key === 'edit-folder' ? id : undefined });
    if (key === 'move-request' && savedRequest) setModal({ kind: 'save', request: clone(savedRequest), move: true });
    if (key === 'export-collection' && collection) void download(`${fileName(collection.name)}.postman_collection.json`, exportCollection(collection));
    if (key === 'export-workspace') void download('API-Manager.workspace.json', exportWorkspace(workspace));
    if (key === 'delete-request' && savedRequest) setModal({ kind: 'confirm', title: 'Delete request?', message: `“${savedRequest.name}” will be removed from its collection. Any open tab will remain as an unsaved draft.`, action: () => mutate(next => { removeRequest(next, savedRequest.id); next.tabs.forEach(tab => { if (tab.request.id === savedRequest.id) { delete tab.request.collectionId; delete tab.request.folderId; tab.dirty = true; } }); }) });
    if (key === 'delete-collection' && collection) setModal({ kind: 'confirm', title: 'Delete collection?', message: `“${collection.name}” and all its folders and saved requests will be deleted. Open requests remain as drafts.`, action: () => mutate(next => { next.collections = next.collections.filter(item => item.id !== collection.id); next.tabs.forEach(tab => { if (tab.request.collectionId === collection.id) { delete tab.request.collectionId; delete tab.request.folderId; tab.dirty = true; } }); }) });
    if (key === 'delete-folder' && folder && collection) {
      const requestIds = new Set([...folder.requests, ...allRequests({ ...collection, requests: [], folders: folder.folders })].map(request => request.id));
      setModal({ kind: 'confirm', title: 'Delete folder?', message: `“${folder.name}” and its saved requests will be deleted. Open requests remain as drafts.`, action: () => mutate(next => { const target = next.collections.find(item => item.id === collection.id)!; target.folders = removeFolder(target.folders, folder.id); next.tabs.forEach(tab => { if (requestIds.has(tab.request.id)) { delete tab.request.collectionId; delete tab.request.folderId; tab.dirty = true; } }); }) });
    }
    if (key === 'clear-history') setModal({ kind: 'confirm', title: 'Clear request history?', message: 'This removes the request history from this computer. Your saved collections and open tabs are kept.', action: () => mutate(next => { next.history = []; }) });
  };
  const resize = (event: React.PointerEvent, target: 'sidebar' | 'request') => {
    event.preventDefault(); const start = target === 'sidebar' ? event.clientX : event.clientY; const initial = target === 'sidebar' ? workspace.sidebarWidth : requestHeight;
    const move = (event: PointerEvent) => { const amount = initial + (target === 'sidebar' ? event.clientX : event.clientY) - start; if (target === 'sidebar') mutate(next => { next.sidebarWidth = Math.max(240, Math.min(480, amount)); }); else setRequestHeight(Math.max(155, Math.min(Math.max(155, window.innerHeight - 360), amount))); };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); document.body.classList.remove('resizing'); };
    document.body.classList.add('resizing'); window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  };
  useEffect(() => { localStorage.setItem('api-manager-request-height', String(requestHeight)); }, [requestHeight]);
  const environment = workspace.environments.find(item => item.id === selectedEnvironment);
  const responseMode = current?.responseTab.startsWith('Body:') ? current.responseTab.slice(5) : 'Pretty';
  const responseTab = current?.responseTab.startsWith('Body:') ? 'Body' : current?.responseTab || 'Body';
  const response = current?.response;
  const responseText = response ? responseMode === 'Raw' ? response.body : prettyBody(response.body, responseLanguage(current)) : '';
  const bodyWithHeaders = response ? `HTTP ${response.status} ${response.statusText}\r\n${response.headers.map(header => `${header.key}: ${header.value}`).join('\r\n')}\r\n\r\n${response.body}` : '';
  const saveResponse = (headers: boolean) => {
    if (!response || !request) return;
    void download(`${fileName(request.name)}${headers ? '.with-headers' : ''}.json`, responseDocument(response, headers)); setMenu(null);
  };
  if (!ready) return <div className="boot-screen"><div className="brand-icon"><Code2 size={30} /></div><h1>API Manager</h1><p>{saveStatus}</p>{notices.map(notice => <p className="error-text" key={notice.id}>{notice.text}</p>)}{loadError ? <button className="button primary" onClick={load}>Retry loading workspace</button> : <Loader2 size={22} className="spinner" />}</div>;

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-icon"><Code2 size={19} /></span><strong>API Manager</strong><span className="local-badge"><HardDrive size={11} /> LOCAL</span></div><div className="header-middle"><ShieldCheck size={13} /><span>Your APIs. Your workspace.</span></div><div className="header-actions"><button className="icon-button" title="Keyboard shortcuts and supported features" aria-label="Help" onClick={() => notify('Ctrl+N: new tab · Ctrl+S: save request · Ctrl+Enter: send · Ctrl+F in editors: find. REST/SOAP, Postman imports, all listed auth schemes, isolated pre-request and post-response scripts, globals and dynamic variables. Console keeps the latest 200 runs. Collection runners and GraphQL schema tools are not included.', true)}><CircleHelp size={17} /></button><button className="icon-button" title="Settings" aria-label="Application settings" onClick={() => action('settings')}><Settings2 size={17} /></button></div></header>
    <div className="workspace-toolbar"><div className="workspace-label"><FolderOpen size={15} /><strong>My workspace</strong><span className="quiet-text">/ Personal</span></div><button className="button small" onClick={() => addTab()}><Plus size={13} />New</button><button className="button small" onClick={() => setModal({ kind: 'import' })}><ArrowDownToLine size={13} />Import</button><div className="workspace-menu"><button className="icon-button" title="Workspace actions" aria-label="Workspace actions" onClick={() => setMenu(menu === 'workspace' ? null : 'workspace')}><MoreHorizontal size={18} /></button>{menu === 'workspace' && <div className="context-menu"><button onClick={() => action('export-workspace')}><Download size={14} /> Export workspace backup</button><button onClick={() => action('cookies')}>Manage cookies</button><button onClick={() => { setMenu(null); void persist(workspace); }}>Save workspace now</button><button onClick={() => { setMenu(null); void bridge.openDataFolder().catch(error => notify(messageOf(error), true)); }}><FolderOpen size={14} /> Open data folder</button></div>}</div><div className="toolbar-spacer" /><div className="environment-selector"><VariableIcon /><select aria-label="Active environment" value={workspace.activeEnvironmentId || ''} onChange={event => mutate(next => { next.activeEnvironmentId = event.target.value || null; })}><option value="">No environment</option>{workspace.environments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="icon-button" title="Edit active environment" aria-label="Edit active environment" onClick={() => { mutate(next => { next.sidebarView = 'environments'; }); setSelectedEnvironment(workspace.activeEnvironmentId || 'globals'); }}><Settings2 size={14} /></button></div></div>
    <div className="workspace-body"><Sidebar workspace={workspace} selectedEnvironment={selectedEnvironment} onView={view => { mutate(next => { next.sidebarView = view; }); if (view !== 'environments') setSelectedEnvironment(null); else setSelectedEnvironment(workspace.activeEnvironmentId || 'globals'); }} onOpen={addTab} onOpenHistory={openHistory} onNew={() => addTab()} onEnvironment={setSelectedEnvironment} onAction={action} /><div className="sidebar-resizer" onPointerDown={event => resize(event, 'sidebar')} />
      <main className="main-panel"><div className="request-tabs" ref={tabsRef} role="tablist" onWheel={event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { event.currentTarget.scrollLeft += event.deltaY; } }}>{workspace.tabs.map(tab => <div className={`request-tab ${tab.id === workspace.activeTabId && !selectedEnvironment ? 'active' : ''}`} key={tab.id}><button role="tab" aria-selected={tab.id === workspace.activeTabId && !selectedEnvironment} onClick={() => { mutate(next => { next.activeTabId = tab.id; }); setSelectedEnvironment(null); }} title={`${tab.request.method} ${tab.request.url || tab.request.name}`}><span className={`method-badge ${tab.request.method.toLowerCase()}`}>{tab.request.method}</span><span className="ellipsis">{tab.request.name}</span>{tab.dirty && <span className="dirty-dot" title="Unsaved collection changes" />}</button><button className="tab-close" aria-label={`Close ${tab.request.name}`} onClick={() => closeTab(tab)}><X size={12} /></button></div>)}<button className="new-tab icon-button" title="New request (Ctrl+N)" aria-label="New request tab" onClick={() => addTab()}><Plus size={17} /></button></div>
        {selectedEnvironment ? <EnvironmentPanel key={selectedEnvironment} environment={environment} globals={workspace.globals} selectedId={selectedEnvironment} activeId={workspace.activeEnvironmentId} onChange={variables => mutate(next => { if (selectedEnvironment === 'globals') next.globals = variables; else next.environments.find(item => item.id === selectedEnvironment)!.variables = variables; })} onActivate={() => mutate(next => { next.activeEnvironmentId = selectedEnvironment === workspace.activeEnvironmentId ? null : selectedEnvironment; })} onRename={() => environment && setModal({ kind: 'name', title: 'Rename environment', value: environment.name, submit: name => mutate(next => { next.environments.find(item => item.id === environment.id)!.name = name; }) })} onExport={() => void download(`${fileName(environment?.name || 'Globals')}.postman_environment.json`, environment ? exportEnvironment(environment) : exportGlobals(workspace.globals))} onDelete={() => environment && setModal({ kind: 'confirm', title: 'Delete environment?', message: `“${environment.name}” and all its variables will be deleted.`, action: () => { mutate(next => { next.environments = next.environments.filter(item => item.id !== environment.id); if (next.activeEnvironmentId === environment.id) next.activeEnvironmentId = null; }); setSelectedEnvironment('globals'); } })} error={text => notify(text, true)} /> : current && request && <div className="request-workspace">
          <div className="request-title"><div className="request-breadcrumb"><span>{workspace.collections.find(item => item.id === request.collectionId)?.name || 'Scratch pad'}</span><ChevronDown className="breadcrumb-divider" size={12} /><strong>{request.name}</strong>{current.dirty && <span className="draft-label">Draft</span>}</div><button className="button small" title="Save request (Ctrl+S)" onClick={saveRequest}><Save size={14} />Save</button><div className="request-menu"><button className="icon-button" title="Request actions" aria-label="Request actions" onClick={() => setMenu(menu === 'request' ? null : 'request')}><MoreHorizontal size={18} /></button>{menu === 'request' && <div className="context-menu"><button onClick={() => { setMenu(null); setModal({ kind: 'save', request: { ...clone(request), id: uid(), name: `${request.name} copy` } }); }}>Save as…</button><button onClick={() => { setMenu(null); addTab(request, true); }}>Duplicate tab</button><button onClick={() => { setMenu(null); copyCurl(request); }}><Code2 size={14} /> Copy as cURL</button><button onClick={() => { setMenu(null); setModal({ kind: 'name', title: 'Rename request', value: request.name, submit: name => patchRequest({ name }) }); }}>Rename request</button></div>}</div></div>
          {current.historyId && <div className="history-replay-banner"><ClockIcon /><span>Saved run from {new Date(workspace.history.find(entry => entry.id === current.historyId)?.timestamp || response?.receivedAt || Date.now()).toLocaleString()}</span><button className="button small" disabled={busy[current.id]} onClick={() => void sendRequest(current.id)}><Send size={12} />Run again</button></div>}
          <div className="url-bar"><select className="protocol-select" aria-label="Request protocol" value={request.soap ? 'SOAP' : 'REST'} onChange={event => { try { if (event.target.value === 'SOAP') { patchRequest(configureSoap(request, '1.1', '')); patchTab({ editorTab: 'Body' }); } else patchRequest({ soap: undefined }); } catch (error) { notify(messageOf(error), true); } }}><option>REST</option><option>SOAP</option></select><select className={`method-select ${request.method.toLowerCase()}`} aria-label="Request method" value={request.method} onChange={event => patchRequest({ method: event.target.value })}>{!methods.includes(request.method) && <option>{request.method}</option>}{methods.map(method => <option key={method}>{method}</option>)}</select><input aria-label="Request URL" placeholder="Enter URL or paste a cURL command" value={request.url} spellCheck={false} onChange={event => patchRequest({ url: event.target.value, params: paramsFromUrl(event.target.value) })} onPaste={event => { const text = event.clipboardData.getData('text'); if (/^\s*curl\s/i.test(text)) { event.preventDefault(); importContent([{ name: 'cURL request', content: text }]); } }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void sendRequest(); } }} /><button key={busy[current.id] ? `${current.id}:cancel` : `${current.id}:send`} className={`send-button ${busy[current.id] ? 'cancel' : ''}`} onClick={() => busy[current.id] ? void cancelRequest() : void sendRequest()}>{busy[current.id] ? <><Loader2 size={15} className="spinner" />Cancel</> : <>Send<Send size={14} /></>}</button></div>
          <section className="request-editor" style={{ height: consoleOpen ? Math.min(requestHeight, Math.max(155, window.innerHeight - 600)) : requestHeight }}><div className="editor-tabs">{['Params', 'Authorization', 'Headers', 'Body', 'Pre-request', 'Post-response', 'Settings', 'Description'].map(name => <button className={current.editorTab === name ? 'active' : ''} key={name} onClick={() => patchTab({ editorTab: name })}>{name}{name === 'Headers' && request.headers.filter(value => value.enabled && value.key).length > 0 && <span className="tab-count">{request.headers.filter(value => value.enabled && value.key).length}</span>}{name === 'Params' && request.params.filter(value => value.enabled && value.key).length > 0 && <span className="active-dot" />}{name === 'Body' && request.body.mode !== 'none' && <span className="active-dot" />}{(name === 'Pre-request' && request.scripts?.preRequest || name === 'Post-response' && request.scripts?.postResponse) && <span className="active-dot" />}</button>)}<div className="toolbar-spacer" /><button className="icon-button" aria-label="Copy request as cURL" title="Copy request as cURL" onClick={() => copyCurl(request)}><Code2 size={16} /></button></div>
            <div className="editor-content">
              {current.editorTab === 'Params' && <><div className="section-caption"><span>Query parameters</span><small>Use <code>{'{{variable}}'}</code> for environment values.</small></div><RequestFields rows={request.params} onChange={params => patchRequest({ params, url: urlWithParams(request.url, params) })} /><p className="table-hint">Enabled parameters are included in the URL. Uncheck a parameter to keep it without sending it.</p></>}
              {current.editorTab === 'Headers' && <><div className="section-caption"><span>Request headers</span><small>Content-Type is set automatically for JSON and form bodies.</small></div><RequestFields rows={request.headers} onChange={headers => patchRequest({ headers })} /></>}
              {current.editorTab === 'Authorization' && <AuthEditor key={`${current.id}:auth`} value={request.auth} onChange={auth => mutate(next => { const target = next.tabs.find(tab => tab.id === current.id); if (target) { target.request.auth = auth; target.request.extra = withoutPreservedAuth(target.request.extra); target.dirty = true; } })} inherited={effectiveAuth(workspace, { ...request, auth: { type: 'inherit' } }).type} workspace={workspace} request={request} notify={notify} />}
              {(current.editorTab === 'Pre-request' || current.editorTab === 'Post-response') && <ScriptEditor editorKey={`${current.id}:script:${current.editorTab}`} stage={current.editorTab} source={current.editorTab === 'Pre-request' ? request.scripts?.preRequest || '' : request.scripts?.postResponse || ''} onChange={source => patchRequest({ scripts: { preRequest: request.scripts?.preRequest || '', postResponse: request.scripts?.postResponse || '', [current.editorTab === 'Pre-request' ? 'preRequest' : 'postResponse']: source } })} wordWrap={wrap} />}
              {current.editorTab === 'Body' && <div className="body-editor">{request.soap && <div className="soap-controls"><label>SOAP version<select aria-label="SOAP version" value={request.soap.version} onChange={event => { try { patchRequest(configureSoap(request, event.target.value as '1.1' | '1.2', request.soap!.action)); } catch (error) { notify(messageOf(error), true); } }}><option value="1.1">1.1</option><option value="1.2">1.2</option></select></label><label className="soap-action">Action<input aria-label="SOAP action" placeholder="urn:example:GetData or {{soap_action}}" value={request.soap.action} onChange={event => { try { patchRequest(configureSoap(request, request.soap!.version, event.target.value)); } catch (error) { notify(messageOf(error), true); } }} /></label></div>}<div className="body-controls">{(['none', 'formdata', 'urlencoded', 'raw', 'binary'] as const).map(mode => <label key={mode}><input type="radio" name="body-mode" checked={request.body.mode === mode} onChange={() => patchRequest({ body: { ...request.body, mode } })} />{({ none: 'none', formdata: 'form-data', urlencoded: 'x-www-form-urlencoded', raw: 'raw', binary: 'binary' })[mode]}</label>)}{request.body.mode === 'raw' && <><select aria-label="Body language" value={request.body.language} onChange={event => patchRequest({ body: { ...request.body, language: event.target.value as ApiRequest['body']['language'] } })}><option value="json">JSON</option><option value="text">Text</option><option value="xml">XML</option><option value="html">HTML</option><option value="javascript">JavaScript</option></select><button className="text-button" aria-label="Beautify request body" disabled={!['json', 'xml'].includes(request.body.language)} onClick={() => { try { patchRequest({ body: { ...request.body, raw: beautify(request.body.raw, request.body.language) } }); } catch (error) { notify(messageOf(error), true); } }}>Beautify</button><button className={`text-button ${wrap ? 'enabled' : ''}`} aria-label="Toggle request word wrap" aria-pressed={wrap} onClick={() => { localStorage.setItem('api-manager-wrap', String(!wrap)); setWrap(!wrap); }}><WrapText size={13} />{wrap ? 'Unwrap' : 'Wrap'}</button></>}</div>{request.body.mode === 'none' && <div className="body-empty"><Code2 size={24} /><p>This request has no body.</p><small>Select a body type to send data with your request.</small></div>}{request.body.mode === 'raw' && <CodeEditor editorKey={`${current.id}:request-body`} value={request.body.raw} onChange={raw => patchRequest({ body: { ...request.body, raw } })} language={request.body.language} fontSize={13} wordWrap={wrap} />}{(request.body.mode === 'formdata' || request.body.mode === 'urlencoded') && <RequestFields rows={request.body.fields} fileFields={request.body.mode === 'formdata'} onChange={fields => patchRequest({ body: { ...request.body, fields } })} error={text => notify(text, true)} />}{request.body.mode === 'binary' && <div className="binary-panel"><FileJson2 size={26} /><strong>Send a local file as the request body</strong><button className="button" onClick={() => void bridge.selectFile().then(filePath => { if (filePath) patchRequest({ body: { ...request.body, filePath } }); }).catch(error => notify(messageOf(error), true))}><FolderOpen size={14} />Select file</button>{request.body.filePath && <code>{request.body.filePath}</code>}</div>}</div>}
              {current.editorTab === 'Settings' && <div className="request-settings"><p>Requests use your workspace settings. These settings apply to every tab.</p><SettingsFields settings={workspace.settings} onChange={settings => mutate(next => { next.settings = settings; })} /></div>}
              {current.editorTab === 'Description' && <textarea className="description-editor" aria-label="Request description" placeholder="Add notes about this request. Describe parameters, authentication, or expected responses…" value={request.description} onChange={event => patchRequest({ description: event.target.value })} />}
            </div>
          </section><div className="panel-resizer" onPointerDown={event => resize(event, 'request')}><span /></div>
          <section className="response-panel"><div className="response-heading"><div className="editor-tabs response-tabs">{['Body', 'Headers', 'Cookies', 'Test results'].map(name => <button className={responseTab === name ? 'active' : ''} key={name} onClick={() => patchTab({ responseTab: name === 'Body' ? `Body:${responseMode}` : name })}>{name}{name === 'Headers' && response && <span className="tab-count">{response.headers.length}</span>}{name === 'Test results' && !!current.scriptResults?.tests.length && <span className="tab-count">{current.scriptResults.tests.filter(test => test.passed).length}/{current.scriptResults.tests.length}</span>}</button>)}</div><div className="response-metrics">{response ? <><span className={`status ${response.status < 400 ? 'success' : 'failure'}`} title="HTTP status">{response.status} {response.statusText}</span><span title="Request duration">{Math.round(response.duration)} ms</span><span title="Response body size">{response.size < 1024 ? `${response.size} B` : response.size < 1024 * 1024 ? `${(response.size / 1024).toFixed(1)} KB` : `${(response.size / 1024 / 1024).toFixed(2)} MB`}</span></> : <span className="quiet-text">Response</span>}</div></div>
            {responseTab === 'Test results' ? <ScriptResults results={current.scriptResults} /> : responseTab === 'Cookies' ? <CookiePanel notify={notify} /> : response ? <>{response.truncated && <div className="response-warning">This response is truncated at your configured size limit.</div>}{response.binary && <div className="response-warning">Binary content is shown as base64. JSON download saves the base64 value.</div>}{responseTab === 'Headers' ? <div className="response-headers"><div className="section-caption"><span>Response headers</span><button className="text-button" onClick={() => void copy(response.headers.map(header => `${header.key}: ${header.value}`).join('\r\n'))}><Copy size={12} />Copy headers</button></div><RequestFields rows={response.headers} readOnly onChange={() => {}} /></div> : <><div className="response-controls"><div className="segmented">{['Pretty', 'Raw', 'Preview'].map(mode => <button className={responseMode === mode ? 'active' : ''} key={mode} onClick={() => patchTab({ responseTab: `Body:${mode}` })}>{mode}</button>)}</div><span className="response-language">{responseLanguage(current).toUpperCase()}</span><button className="text-button" aria-label="Beautify response body" disabled={!["json", "xml"].includes(responseLanguage(current))} onClick={() => { try { beautify(response.body, responseLanguage(current)); patchTab({ responseTab: "Body:Pretty" }); } catch (error) { notify(messageOf(error), true); } }}>Beautify</button><div className="toolbar-spacer" /><button className={`icon-button ${wrap ? 'enabled' : ''}`} title="Toggle word wrap" aria-label="Toggle response word wrap" aria-pressed={wrap} onClick={() => { localStorage.setItem('api-manager-wrap', String(!wrap)); setWrap(!wrap); }}><WrapText size={16} /></button><div className="zoom-controls"><button className="icon-button" title="Zoom out response" aria-label="Zoom out response" disabled={current.responseZoom <= 10} onClick={() => patchTab({ responseZoom: Math.max(10, current.responseZoom - 2) })}><ZoomOut size={16} /></button><button className="zoom-value" title="Reset response zoom" onClick={() => patchTab({ responseZoom: 14 })}>{Math.round(current.responseZoom / 14 * 100)}%</button><button className="icon-button" title="Zoom in response" aria-label="Zoom in response" disabled={current.responseZoom >= 32} onClick={() => patchTab({ responseZoom: Math.min(32, current.responseZoom + 2) })}><ZoomIn size={16} /></button></div><div className="response-action"><button className="icon-button" title="Copy response" aria-label="Copy response options" onClick={() => setMenu(menu === 'copy' ? null : 'copy')}><Copy size={15} /><ChevronDown size={10} /></button>{menu === 'copy' && <div className="context-menu"><button onClick={() => { setMenu(null); void copy(response.body, 'Response body copied.'); }}>Copy body</button><button onClick={() => { setMenu(null); void copy(bodyWithHeaders, 'Response body and headers copied.'); }}>Copy body with headers</button></div>}</div><div className="response-action"><button className="icon-button" title="Save response as JSON" aria-label="Save response options" onClick={() => setMenu(menu === 'download' ? null : 'download')}><Download size={16} /><ChevronDown size={10} /></button>{menu === 'download' && <div className="context-menu"><button onClick={() => saveResponse(false)}>Save body (.json)</button><button onClick={() => saveResponse(true)}>Save body with headers (.json)</button><p>Non-JSON bodies are saved as JSON strings.</p></div>}</div></div><div className="response-body">{responseMode === 'Preview' ? <ResponsePreview body={response.body} language={responseLanguage(current)} fontSize={current.responseZoom} /> : <CodeEditor editorKey={`${current.id}:response:${responseMode}`} value={responseText} language={responseMode === 'Raw' ? 'text' : responseLanguage(current)} readOnly fontSize={current.responseZoom} wordWrap={wrap} />}</div><div className="response-footer"><span><Search size={11} />Ctrl+F to find in response</span><span title={response.receivedAt}>{new Date(response.receivedAt).toLocaleTimeString()}<span className="metric-divider">·</span>{response.headers.length} headers</span></div></>}</> : <div className="response-empty">{busy[current.id] ? <><Loader2 size={35} className="spinner" /><h3>Sending your request…</h3><p>Waiting for the server to respond.</p><button className="text-button" onClick={() => void cancelRequest()}>Cancel request</button></> : <><div className="response-illustration"><ArrowUpRight size={35} /><span /><span /></div><h3>Ready when you are</h3><p>Enter a URL and click Send to see the response.</p><span className="shortcut-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to send</span></>}</div>}
          </section>
        </div>}
      </main>
    </div>{consoleOpen && <ConsolePanel history={workspace.history} pending={pendingRuns} onOpen={openHistory} onClose={() => setConsoleOpen(false)} />}<footer className="status-bar"><button className={`console-toggle ${consoleOpen ? "active" : ""}`} aria-label="Console" aria-pressed={consoleOpen} onClick={() => setConsoleOpen(!consoleOpen)}><Code2 size={12} />Console</button><span><span className={saveStatus === 'Could not save workspace' ? 'error-dot' : 'local-dot'} />{saveStatus}</span><span>{workspace.collections.length} collections<span className="metric-divider">·</span>{workspace.environments.length} environments</span><span><HardDrive size={11} />Local workspace</span></footer>
    {menu && <div className="menu-dismiss" onClick={() => setMenu(null)} />}
    <div className="notice-stack" aria-live="polite">{notices.map(notice => <div className={`notice ${notice.error ? 'error' : ''}`} key={notice.id}>{notice.error ? <CircleHelp size={17} /> : <Check size={17} />}<span>{notice.text}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotices(previous => previous.filter(item => item.id !== notice.id))}><X size={14} /></button></div>)}</div>
    {modal && <ModalFrame title={modal.kind === 'import' ? 'Import into your workspace' : modal.kind === 'save' ? modal.move ? 'Move request' : 'Save request' : modal.kind === 'settings' ? 'Settings' : modal.kind === 'cookies' ? 'Cookie manager' : modal.kind === 'collection' ? modal.folderId ? 'Folder settings' : 'Collection settings' : modal.title} onClose={() => setModal(null)} wide={modal.kind === 'collection' || modal.kind === 'settings' || modal.kind === 'cookies'}>
      {modal.kind === 'name' && <NameDialog key={modal.title} value={modal.value} label={modal.label} onSubmit={name => { modal.submit(name); setModal(null); }} onCancel={() => setModal(null)} />}
      {modal.kind === 'confirm' && <><p className="confirm-message">{modal.message}</p><div className="modal-footer"><button className="button" onClick={() => setModal(null)}>Cancel</button><button className="button danger-fill" onClick={() => { modal.action(); setModal(null); }}>Confirm</button></div></>}
      {modal.kind === 'import' && <ImportDialog onImport={importContent} onClose={() => setModal(null)} error={text => notify(text, true)} />}
      {modal.kind === 'save' && <SaveDialog request={modal.request} collections={workspace.collections} move={modal.move} onCreateCollection={name => { const id = uid(); mutate(next => next.collections.push({ id, name, description: '', folders: [], requests: [], variables: [], auth: { type: 'none' } })); return id; }} onSave={(request, collectionId, folderId) => saveToCollection(request, collectionId, folderId, modal.tabId, modal.move)} onCancel={() => setModal(null)} />}
      {modal.kind === 'settings' && <div className="settings-dialog"><SettingsFields settings={workspace.settings} onChange={settings => mutate(next => { next.settings = settings; })} /><div className="settings-section"><h4>Appearance</h4><label className="setting-row"><span>Theme</span><select aria-label="Application theme" value={workspace.settings.theme} onChange={event => mutate(next => { next.settings.theme = event.target.value as 'dark' | 'light'; })}><option value="dark">Dark</option><option value="light">Light</option></select></label></div><div className="settings-section"><h4>Local storage</h4><p>Your workspace, requests, environments, tabs, response history, and cookies stay on this computer. Variable values are stored as plain text, so keep this device secure.</p><code className="storage-path">{storagePath}</code><button className="button small" onClick={() => void bridge.openDataFolder().catch(error => notify(messageOf(error), true))}><FolderOpen size={14} />Open data folder</button><button className="button small" onClick={() => action('export-workspace')}><Download size={14} />Export backup</button></div><div className="modal-footer"><span className="quiet-text">Changes save automatically.</span><button className="button primary" onClick={() => setModal(null)}>Done</button></div></div>}
      {modal.kind === 'cookies' && <CookiePanel notify={notify} />}
      {modal.kind === 'collection' && <CollectionSettings workspace={workspace} collectionId={modal.collectionId} folderId={modal.folderId} notify={notify} onChange={(variables, auth, description, clearAuth, scripts) => mutate(next => { const collection = next.collections.find(item => item.id === modal.collectionId)!; const node = modal.folderId ? findFolder(collection.folders, modal.folderId)! : collection; node.variables = variables; node.auth = auth; if (scripts) node.scripts = scripts; if (clearAuth) node.extra = withoutPreservedAuth(node.extra); if ('description' in node && description !== undefined) node.description = description; })} onClose={() => setModal(null)} />}
    </ModalFrame>}
  </div>;
}

function VariableIcon() { return <span className="variable-symbol">{'{ }'}</span>; }
function ClockIcon() { return <span className="history-clock">↺</span>; }
function ScriptEditor({ editorKey, stage, source, onChange, wordWrap }: { editorKey: string; stage: string; source: string; onChange: (source: string) => void; wordWrap: boolean }) {
  const [showExamples, setShowExamples] = useState(false);
  const examples = stage === 'Pre-request' ? [
    { name: 'Set an environment value', source: 'pm.environment.set("timestamp", Date.now().toString());' },
    { name: 'Set a global value', source: 'pm.globals.set("api_version", "v1");' },
    { name: 'Add a request header', source: 'pm.request.headers.upsert({ key: "X-Request-ID", value: pm.variables.replaceIn("{{$guid}}") });' },
    { name: 'Log resolved variables', source: 'console.log("Base URL:", pm.variables.get("base_url"));' },
  ] : [
    { name: 'Status code is 200', source: 'pm.test("Status code is 200", () => {\n  pm.response.to.have.status(200);\n});' },
    { name: 'Validate response JSON', source: 'pm.test("Response is JSON", () => {\n  pm.expect(pm.response.json()).to.be.an("object");\n});' },
    { name: 'Save a response token', source: 'const data = pm.response.json();\nif (data.token) pm.environment.set("token", data.token);' },
    { name: 'Log the response', source: 'console.log("Response:", pm.response.code, pm.response.text());' },
  ];
  return <div className="script-editor"><div className="script-toolbar"><span><Code2 size={13} />JavaScript</span><small>{stage === 'Pre-request' ? 'Runs before the request is sent.' : 'Runs after the response arrives.'}</small><button className="text-button" onClick={() => setShowExamples(!showExamples)}>{showExamples ? 'Hide snippets' : 'Snippets'}</button></div><div className="script-main"><CodeEditor editorKey={editorKey} value={source} onChange={onChange} language="javascript" fontSize={13} wordWrap={wordWrap} />{showExamples && <aside className="script-snippets"><strong>Insert a snippet</strong>{examples.map(example => <button key={example.name} onClick={() => onChange(`${source}${source.trim() ? '\n\n' : ''}${example.source}`)}>{example.name}<Plus size={12} /></button>)}</aside>}</div><div className="script-caption">Scripts run in order: collection → parent folders → request. Environment/global changes save locally. Use the Console to see logs.</div></div>;
}
function ScriptResults({ results }: { results?: RequestTab['scriptResults'] }) {
  return <div className="script-results"><div className="section-caption"><span>Test results</span><small>{results?.tests.length ? `${results.tests.filter(test => test.passed).length} passed · ${results.tests.filter(test => !test.passed).length} failed` : 'No tests ran'}</small></div>{results?.error && <div className="script-error"><strong>Script error</strong><pre>{results.error}</pre></div>}{results?.tests.map((test, index) => <div className={`test-result ${test.passed ? 'passed' : 'failed'}`} key={`${index}:${test.name}`}><span className="test-label">{test.passed ? 'PASS' : 'FAIL'}</span><div><strong>{test.name}</strong>{test.error && <pre>{test.error}</pre>}</div></div>)}{!results?.tests.length && !results?.error && <div className="body-empty"><Check size={27} /><p>No test results yet.</p><small>Add <code>pm.test()</code> in Post-response and send your request.</small></div>}{!!results?.logs.length && <div className="script-log-summary">{results.logs.length} console {results.logs.length === 1 ? 'message' : 'messages'}. Open Console to inspect them.</div>}</div>;
}
function ModalFrame({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const oldFocus = document.activeElement as HTMLElement | null;
    const element = ref.current;
    (element?.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])') || element?.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !element) return;
      const fields = [...element.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(item => item.offsetParent !== null);
      const first = fields[0]; const last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    element?.addEventListener('keydown', trap); return () => { element?.removeEventListener('keydown', trap); oldFocus?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal ${wide ? 'wide' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div><div className="modal-content">{children}</div></div></div>;
}
function NameDialog({ value, label = 'Name', onSubmit, onCancel }: { value: string; label?: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(value);
  return <form onSubmit={event => { event.preventDefault(); if (name.trim()) onSubmit(name.trim()); }}><label className="form-label">{label}<input aria-label={label} autoFocus maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder="Enter a name" /></label><div className="modal-footer"><button type="button" className="button" onClick={onCancel}>Cancel</button><button type="submit" className="button primary" disabled={!name.trim()}>Save</button></div></form>;
}
function SaveDialog({ request, collections, move, onCreateCollection, onSave, onCancel }: { request: ApiRequest; collections: ApiCollection[]; move?: boolean; onCreateCollection: (name: string) => string; onSave: (request: ApiRequest, collectionId: string, folderId?: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(request.name);
  const [collectionId, setCollectionId] = useState(request.collectionId && collections.some(item => item.id === request.collectionId) ? request.collectionId : collections[0]?.id || '');
  const [folderId, setFolderId] = useState(request.folderId || '');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(!collections.length);
  const collection = collections.find(item => item.id === collectionId);
  return <form onSubmit={event => { event.preventDefault(); if (name.trim() && collectionId) onSave({ ...request, name: name.trim() }, collectionId, folderId || undefined); }}><label className="form-label">Request name<input aria-label="Request name" autoFocus value={name} maxLength={200} onChange={event => setName(event.target.value)} /></label><label className="form-label">Collection<select aria-label="Save collection" value={collectionId} onChange={event => { setCollectionId(event.target.value); setFolderId(''); }}><option value="" disabled>Select a collection</option>{collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{collection && <label className="form-label">Folder<select aria-label="Save folder" value={folderId} onChange={event => setFolderId(event.target.value)}><option value="">Collection root</option>{folderList(collection.folders).map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}{creating ? <div className="inline-create"><input aria-label="New collection name" placeholder="New collection name" value={newName} onChange={event => setNewName(event.target.value)} /><button type="button" className="button small" disabled={!newName.trim()} onClick={() => { const id = onCreateCollection(newName.trim()); setCollectionId(id); setFolderId(''); setCreating(false); }}>Create</button></div> : <button className="text-button" type="button" onClick={() => setCreating(true)}><Plus size={13} />Create a collection</button>}<div className="modal-footer"><button type="button" className="button" onClick={onCancel}>Cancel</button><button type="submit" className="button primary" disabled={!name.trim() || !collectionId}>{move ? 'Move' : 'Save'}</button></div></form>;
}
function ImportDialog({ onImport, onClose, error }: { onImport: (sources: { name: string; content: string }[]) => boolean; onClose: () => void; error: (text: string) => void }) {
  const [text, setText] = useState(''); const [loading, setLoading] = useState(false);
  const files = async () => { setLoading(true); try { const sources = await bridge.importFiles(); if (sources.length && onImport(sources)) onClose(); } catch (cause) { error(messageOf(cause)); } finally { setLoading(false); } };
  return <><p className="dialog-intro">Bring your requests with you. Import Postman collections, environments, globals, a workspace backup, or a cURL command.</p><button className="import-drop-zone" onClick={() => void files()} disabled={loading}><ArrowDownToLine size={27} /><strong>{loading ? 'Reading files…' : 'Choose files to import'}</strong><span>Postman v2 / v2.1 JSON · Environment JSON · Workspace JSON</span></button><div className="or-divider">or paste text</div><textarea className="import-text" aria-label="Import cURL or JSON" spellCheck={false} placeholder={'curl --request GET \'https://api.example.com/users\'\n\nOr paste a collection or environment JSON…'} value={text} onChange={event => setText(event.target.value)} /><p className="small-note">Scripts run in an isolated sandbox when you send requests. Unsupported metadata is preserved for export.</p><div className="modal-footer"><button className="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={!text.trim() || loading} onClick={() => { if (onImport([{ name: 'Pasted import', content: text }])) onClose(); }}>Import text</button></div></>;
}
function SettingsFields({ settings, onChange }: { settings: Workspace['settings']; onChange: (settings: Workspace['settings']) => void }) {
  return <div className="settings-fields"><label className="setting-row"><span>Request timeout<small>Maximum wait time in milliseconds (0 means no timeout).</small></span><input aria-label="Request timeout" type="number" min={0} max={3600000} value={settings.timeout} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0 && value <= 3600000) onChange({ ...settings, timeout: value }); }} /></label><label className="setting-row"><span>Maximum response size<small>Limit the response body in MB (1–100).</small></span><input aria-label="Maximum response MB" type="number" min={1} max={100} value={settings.maxResponseMB} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 1 && value <= 100) onChange({ ...settings, maxResponseMB: value }); }} /></label><label className="setting-row"><span>Follow redirects<small>Automatically follow HTTP redirects.</small></span><input type="checkbox" role="switch" aria-label="Follow redirects" checked={settings.followRedirects} onChange={event => onChange({ ...settings, followRedirects: event.target.checked })} /></label><label className="setting-row"><span>SSL certificate verification<small>Verify the server certificate for HTTPS requests.</small></span><input type="checkbox" role="switch" aria-label="Verify SSL" checked={settings.verifySsl} onChange={event => onChange({ ...settings, verifySsl: event.target.checked })} /></label></div>;
}
function EnvironmentPanel({ environment, globals, selectedId, activeId, onChange, onActivate, onRename, onExport, onDelete, error }: { environment?: Environment; globals: KeyValue[]; selectedId: string; activeId: string | null; onChange: (rows: KeyValue[]) => void; onActivate: () => void; onRename: () => void; onExport: () => void; onDelete: () => void; error: (text: string) => void }) {
  return <section className="environment-panel"><div className="environment-heading"><div><div className="eyebrow">{selectedId === 'globals' ? 'WORKSPACE VARIABLES' : 'ENVIRONMENT'}</div><h1>{environment?.name || 'Globals'}</h1></div><div className="environment-actions">{environment && <><button className={`button ${activeId === environment.id ? 'active-button' : ''}`} onClick={onActivate}>{activeId === environment.id ? <><Check size={14} />Active</> : 'Set active'}</button><button className="button" onClick={onRename}>Rename</button><button className="icon-button danger" title="Delete environment" aria-label="Delete environment" onClick={onDelete}><Trash2 size={15} /></button></>}<button className="button" onClick={onExport}><Download size={14} />Export</button></div></div><p className="environment-intro">{selectedId === 'globals' ? 'Global variables are available in every request. Environment values override globals.' : 'Use this environment to switch between development, staging, and production.'} Reference values with <code>{'{{variable}}'}</code> in URLs, headers, authorization, or request bodies.</p><div className="environment-caption"><span>Variables</span><span className="local-badge"><HardDrive size={11} />LOCAL VALUES</span></div><RequestFields rows={environment?.variables || globals} onChange={onChange} variables error={error} /><div className="environment-note"><ShieldCheck size={16} /><span>Values are saved automatically on this computer. They are included when you export this environment.</span></div></section>;
}
function CollectionSettings({ workspace, collectionId, folderId, onChange, onClose, notify }: { workspace: Workspace; collectionId: string; folderId?: string; onChange: (variables: KeyValue[], auth: RequestAuth, description?: string, clearAuth?: boolean, scripts?: RequestScripts) => void; onClose: () => void; notify: (text: string, error?: boolean) => void }) {
  const [tab, setTab] = useState('Variables'); const collection = workspace.collections.find(item => item.id === collectionId)!; const folder = findFolder(collection.folders, folderId); const node = folder || collection;
  const contextRequest = { ...newRequest(node.name), collectionId, folderId };
  return <><div className="collection-settings-name"><FolderOpen size={17} /><strong>{node.name}</strong></div><div className="editor-tabs">{['Variables', 'Authorization', 'Pre-request', 'Post-response', ...(!folder ? ['Description'] : [])].map(name => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}</div><div className="collection-settings-content">{tab === 'Variables' && <><p className="dialog-intro">These values are available to requests inside this {folder ? 'folder' : 'collection'}. Environment values take precedence.</p><RequestFields rows={node.variables || []} onChange={variables => onChange(variables, node.auth || { type: 'inherit' })} variables /></>}{tab === 'Authorization' && <AuthEditor value={node.auth || { type: 'inherit' }} allowInherit={!!folder} workspace={workspace} request={contextRequest} notify={notify} onChange={auth => onChange(node.variables || [], auth, undefined, true)} />}{(tab === 'Pre-request' || tab === 'Post-response') && <ScriptEditor editorKey={`${node.id}:script:${tab}`} stage={tab} source={tab === 'Pre-request' ? node.scripts?.preRequest || '' : node.scripts?.postResponse || ''} onChange={source => onChange(node.variables || [], node.auth || { type: 'inherit' }, undefined, false, { preRequest: node.scripts?.preRequest || '', postResponse: node.scripts?.postResponse || '', [tab === 'Pre-request' ? 'preRequest' : 'postResponse']: source })} wordWrap />}{tab === 'Description' && <textarea className="description-editor" aria-label="Collection description" value={collection.description} onChange={event => onChange(collection.variables, collection.auth, event.target.value)} placeholder="Describe this collection…" />}</div><div className="modal-footer"><span className="quiet-text">Changes save automatically.</span><button className="button primary" onClick={onClose}>Done</button></div></>;
}
function CookiePanel({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [cookies, setCookies] = useState<CookieEntry[]>([]); const [loading, setLoading] = useState(true); const [confirm, setConfirm] = useState(false);
  const refresh = useCallback(async () => { setLoading(true); try { setCookies(await bridge.getCookies()); } catch (error) { notify(messageOf(error), true); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { void refresh(); }, [refresh]);
  return <div className="cookie-panel"><div className="section-caption"><span>Local cookie jar</span><div><button className="text-button" onClick={() => void refresh()}>Refresh</button><button className="text-button danger" disabled={!cookies.length} onClick={() => setConfirm(true)}>Clear cookies</button></div></div>{confirm && <div className="cookie-confirm"><span>Delete all saved cookies?</span><button className="button small" onClick={() => setConfirm(false)}>Cancel</button><button className="button small danger-fill" onClick={() => void bridge.clearCookies().then(() => { setConfirm(false); void refresh(); notify('Cookie jar cleared.'); }).catch(error => notify(messageOf(error), true))}>Delete all</button></div>}<p className="table-hint">Server cookies are stored locally and sent with matching requests. This shows cookies across all domains.</p>{loading ? <div className="body-empty"><Loader2 className="spinner" size={22} /></div> : cookies.length ? <div className="cookie-table"><table><thead><tr><th>Name</th><th>Value</th><th>Domain</th><th>Path</th><th>Secure</th><th>HttpOnly</th><th>Expires</th></tr></thead><tbody>{cookies.map((cookie, index) => <tr key={`${cookie.domain}:${cookie.path}:${cookie.key}:${index}`}><td>{cookie.key}</td><td className="cookie-value" title={cookie.value}>{cookie.value}</td><td>{cookie.domain}</td><td>{cookie.path}</td><td>{cookie.secure ? 'Yes' : 'No'}</td><td>{cookie.httpOnly ? 'Yes' : 'No'}</td><td>{cookie.expires || 'Session'}</td></tr>)}</tbody></table></div> : <div className="body-empty"><ShieldCheck size={26} /><p>No cookies stored yet.</p><small>Cookies from server responses will appear here.</small></div>}</div>;
}
function ResponsePreview({ body, language, fontSize }: { body: string; language: string; fontSize: number }) {
  if (language === 'html') {
    // Template fragments are inert: response HTML is never inserted into the application document.
    const template = document.createElement('template'); template.innerHTML = body;
    template.content.querySelectorAll('script,meta,base,link,iframe,frame,object,embed,form,video,audio,source,track,noscript,template,svg,math').forEach(element => element.remove());
    template.content.querySelectorAll('*').forEach(element => {
      [...element.attributes].forEach(attribute => {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || ['href', 'xlink:href', 'action', 'formaction', 'srcdoc', 'target', 'ping', 'srcset', 'poster'].includes(name) || name === 'src' && !attribute.value.startsWith('data:')) element.removeAttribute(attribute.name);
      });
    });
    return <div className="html-preview"><div className="preview-note">Safe preview · scripts, external resources, and navigation are disabled.</div><iframe title="Safe HTML response preview" sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>body{font:${fontSize}px system-ui;padding:16px;background:white;color:#222}a{pointer-events:none}img{max-width:100%}</style>${template.innerHTML}`} /></div>;
  }
  return <pre className="text-preview" style={{ fontSize }}>{prettyBody(body, language)}</pre>;
}
