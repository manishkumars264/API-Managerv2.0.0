import type { DesktopBridge, Workspace } from '../types';

// The browser preview is useful for developing the interface. Native networking
// and filesystem dialogs are available only in the packaged desktop application.
const previewKey = 'api-manager-preview-workspace-v1';
const desktopOnly = async (): Promise<never> => { throw new Error('Open the API Manager desktop app to send requests or use local file dialogs.'); };
const preview: DesktopBridge = {
  async loadWorkspace() {
    let workspace: Workspace | null = null;
    let warning: string | undefined;
    try { const saved = localStorage.getItem(previewKey); if (saved) workspace = JSON.parse(saved); }
    catch { warning = 'The browser preview workspace could not be read.'; }
    return { workspace, warning, storagePath: 'Browser preview storage — use the desktop app for local files' };
  },
  async saveWorkspace(workspace) { localStorage.setItem(previewKey, JSON.stringify(workspace)); },
  sendRequest: desktopOnly,
  async getSentRequest() { return null; },
  runScript: desktopOnly,
  acquireOAuthToken: desktopOnly,
  async cancelRequest() {},
  importFiles: desktopOnly,
  saveFile: desktopOnly,
  selectFile: desktopOnly,
  async getCookies() { return []; },
  clearCookies: desktopOnly,
  openDataFolder: desktopOnly,
  async openBugReport() { throw new Error('Open the API Manager desktop app to draft a bug report in your email app.'); },
  onSaveRequested() { return () => {}; },
};
export const bridge: DesktopBridge = window.apiManager ?? preview;
