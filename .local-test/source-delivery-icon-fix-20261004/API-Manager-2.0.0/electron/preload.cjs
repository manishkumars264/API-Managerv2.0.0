'use strict';

const { contextBridge, ipcRenderer } = require('electron');
let pendingSaveToken;

// This is the entire renderer privilege surface. IPC objects and events never cross it.
contextBridge.exposeInMainWorld('apiManager', Object.freeze({
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  saveWorkspace: workspace => {
    const token = pendingSaveToken;
    pendingSaveToken = undefined;
    return ipcRenderer.invoke('workspace:save', workspace, token);
  },
  sendRequest: payload => ipcRenderer.invoke('request:send', payload),
  getSentRequest: requestId => ipcRenderer.invoke('request:sent', requestId),
  cancelRequest: requestId => ipcRenderer.invoke('request:cancel', requestId),
  runScript: payload => ipcRenderer.invoke('scripts:run', payload),
  acquireOAuthToken: (auth, variables, settings) => ipcRenderer.invoke('oauth:acquire', auth, variables, settings),
  importFiles: () => ipcRenderer.invoke('files:import'),
  saveFile: (name, content) => ipcRenderer.invoke('files:save', name, content),
  selectFile: () => ipcRenderer.invoke('files:select'),
  getCookies: () => ipcRenderer.invoke('cookies:list'),
  clearCookies: domain => ipcRenderer.invoke('cookies:clear', domain),
  openDataFolder: () => ipcRenderer.invoke('storage:open'),
  openBugReport: async () => {
    const result = await ipcRenderer.invoke('bugs:compose');
    if (!result.ok) throw new Error(result.error || 'Could not open your email app. Set a default email app and try again.');
  },
  onSaveRequested: callback => {
    if (typeof callback !== 'function') throw new TypeError('A save callback is required.');
    const listener = (_event, token) => { pendingSaveToken = typeof token === 'string' ? token : undefined; callback(); };
    ipcRenderer.on('workspace:save-requested', listener);
    return () => ipcRenderer.removeListener('workspace:save-requested', listener);
  }
}));
