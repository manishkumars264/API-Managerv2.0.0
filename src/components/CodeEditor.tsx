import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

// Bundle the editor and workers locally. Never load code or fonts from a CDN.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

export interface CodeEditorProps { value: string; onChange?: (value: string) => void; language?: string; readOnly?: boolean; fontSize?: number; wordWrap?: boolean; editorKey?: string; }
export function disposeEditors(tabId: string) {
  for (const model of monaco.editor.getModels()) if (model.uri.toString().startsWith(`api-manager://editor/${encodeURIComponent(tabId + ':')}`)) model.dispose();
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index); if (key?.startsWith(`api-manager-editor:${tabId}:`)) localStorage.removeItem(key);
  }
}
export function CodeEditor(props: CodeEditorProps) { return <EditorSession key={props.editorKey ?? 'editor'} {...props} />; }
function EditorSession({ value, onChange, language = 'json', readOnly = false, fontSize = 14, wordWrap = false, editorKey }: CodeEditorProps) {
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const disposables = useRef<monaco.IDisposable[]>([]);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark');
  const key = editorKey ? `api-manager-editor:${editorKey}` : undefined;
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const mounted: OnMount = useCallback(instance => {
    editor.current = instance;
    if (key) {
      try { const state = localStorage.getItem(key); if (state) instance.restoreViewState(JSON.parse(state)); } catch { /* view state is optional */ }
      const save = () => { try { localStorage.setItem(key, JSON.stringify(instance.saveViewState())); } catch { /* never block editing if storage is full */ } };
      disposables.current = [instance.onDidScrollChange(save), instance.onDidChangeCursorPosition(save)];
    }
  }, [key]);
  useEffect(() => () => {
    if (key && editor.current) {
      try { localStorage.setItem(key, JSON.stringify(editor.current.saveViewState())); } catch { /* optional state */ }
    }
    disposables.current.forEach(item => item.dispose());
  }, [key]);
  return <Editor path={editorKey ? `api-manager://editor/${encodeURIComponent(editorKey)}` : undefined} keepCurrentModel={!!editorKey} height="100%" value={value} language={language === 'text' ? 'plaintext' : language} theme={theme} onMount={mounted} onChange={next => onChange?.(next ?? '')} loading={<div className="editor-loading">Opening editor…</div>} options={{
    readOnly, fontSize, wordWrap: wordWrap ? 'on' : 'off', automaticLayout: true, minimap: { enabled: false },
    scrollBeyondLastLine: false, padding: { top: 14, bottom: 14 }, lineNumbersMinChars: 3,
    renderLineHighlight: readOnly ? 'none' : 'line', folding: true, tabSize: 2,
    fontFamily: 'Consolas, "Cascadia Code", monospace', ariaLabel: readOnly ? 'Response body editor' : 'Request body editor',
    fixedOverflowWidgets: true, contextmenu: true, find: { addExtraSpaceOnTop: false },
    unicodeHighlight: { ambiguousCharacters: false },
  }} />;
}
export default CodeEditor;
