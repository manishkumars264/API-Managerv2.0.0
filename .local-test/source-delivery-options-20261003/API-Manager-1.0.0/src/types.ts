export interface KeyValue { id: string; key: string; value: string; enabled: boolean; description?: string; type?: 'text' | 'file'; contentType?: string; fileName?: string; extra?: Record<string, unknown>; }
export type BodyMode = 'none' | 'raw' | 'urlencoded' | 'formdata' | 'binary';
export interface RequestAuth { type: 'none' | 'inherit' | 'basic' | 'bearer' | 'apikey' | 'digest' | 'oauth1' | 'oauth2' | 'hawk' | 'awsv4' | 'ntlm' | 'edgegrid' | 'jwt' | 'asap'; username?: string; password?: string; token?: string; key?: string; value?: string; in?: 'header' | 'query'; fields?: Record<string, string>; }
export interface RequestScripts { preRequest: string; postResponse: string; }
export interface ApiRequest {
  id: string; name: string; method: string; url: string; params: KeyValue[]; headers: KeyValue[];
  body: { mode: BodyMode; raw: string; language: 'json' | 'text' | 'xml' | 'html' | 'javascript'; fields: KeyValue[]; filePath?: string };
  auth: RequestAuth; description: string; collectionId?: string; folderId?: string;
  soap?: { version: '1.1' | '1.2'; action: string };
  scripts?: RequestScripts;
  /** Retains unsupported Postman metadata for import/export round trips. */
  extra?: Record<string, unknown>;
}
export interface ApiFolder { id: string; name: string; folders: ApiFolder[]; requests: ApiRequest[]; auth?: RequestAuth; variables?: KeyValue[]; scripts?: RequestScripts; extra?: Record<string, unknown>; }
export interface ApiCollection { id: string; name: string; description: string; folders: ApiFolder[]; requests: ApiRequest[]; variables: KeyValue[]; auth: RequestAuth; scripts?: RequestScripts; extra?: Record<string, unknown>; }
export interface Environment { id: string; name: string; variables: KeyValue[]; extra?: Record<string, unknown>; }
export interface ApiResponse { status: number; statusText: string; headers: KeyValue[]; body: string; duration: number; size: number; url: string; receivedAt: string; binary?: boolean; truncated?: boolean; }
export interface RequestTab { id: string; request: ApiRequest; response?: ApiResponse; dirty: boolean; editorTab: string; responseTab: string; responseZoom: number; historyId?: string; scriptResults?: { tests: ScriptTest[]; logs: ScriptLog[]; error?: string }; }
export interface ScriptTest { name: string; passed: boolean; error?: string; }
export interface ScriptLog { level: string; message: string; }
export interface ScriptPayload { script: string; stage: 'pre-request' | 'post-response'; request: ApiRequest; response?: ApiResponse; environment: KeyValue[]; globals: KeyValue[]; collectionVariables: KeyValue[]; folderVariables?: KeyValue[]; variables: KeyValue[]; requestId?: string; }
export interface ScriptResult { request: ApiRequest; environment: KeyValue[]; globals: KeyValue[]; collectionVariables: KeyValue[]; variables: KeyValue[]; tests: ScriptTest[]; logs: ScriptLog[]; error?: string; }
export interface HistoryEntry { id: string; request: ApiRequest; response?: ApiResponse; timestamp: string; error?: string; scriptResults?: { tests: ScriptTest[]; logs: ScriptLog[]; error?: string }; }
export interface Settings { theme: 'dark' | 'light'; timeout: number; followRedirects: boolean; verifySsl: boolean; maxResponseMB: number; }
export interface Workspace {
  version: 1; collections: ApiCollection[]; environments: Environment[]; globals: KeyValue[];
  activeEnvironmentId: string | null; tabs: RequestTab[]; activeTabId: string; history: HistoryEntry[];
  settings: Settings; sidebarView: 'collections' | 'environments' | 'history'; sidebarWidth: number;
}
export interface SendPayload { request: ApiRequest; variables: KeyValue[]; settings: Settings; requestId: string; }
export interface CookieEntry { key: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; expires?: string; }
export interface DesktopBridge {
  loadWorkspace(): Promise<{ workspace: Workspace | null; warning?: string; storagePath: string }>;
  saveWorkspace(workspace: Workspace): Promise<void>;
  sendRequest(payload: SendPayload): Promise<ApiResponse>;
  cancelRequest(requestId: string): Promise<void>;
  runScript(payload: ScriptPayload): Promise<ScriptResult>;
  acquireOAuthToken(auth: RequestAuth, variables: KeyValue[], settings: Settings): Promise<{ accessToken: string; refreshToken?: string; tokenType?: string; expiresIn?: number }>;
  importFiles(): Promise<{ name: string; content: string }[]>;
  saveFile(name: string, content: string): Promise<boolean>;
  selectFile(): Promise<string | null>;
  getCookies(): Promise<CookieEntry[]>;
  clearCookies(domain?: string): Promise<void>;
  openDataFolder(): Promise<void>;
  openBugReport(): Promise<void>;
  onSaveRequested(callback: () => void): () => void;
}
declare global { interface Window { apiManager?: DesktopBridge; } }
