import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import './ResponseTooltip.css';
import './VariableInput.css';
import { useVariableContext } from './VariableContext';
import { editorThemeName, GREY_THEME } from '../lib/appearance';

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
monaco.editor.defineTheme('api-manager-grey', {
  base: 'vs', inherit: true, rules: [],
  colors: {
    'editor.background': GREY_THEME.editor, 'editor.foreground': GREY_THEME.text,
    'editorLineNumber.foreground': GREY_THEME.muted, 'editorLineNumber.activeForeground': GREY_THEME.text,
    'editor.lineHighlightBackground': '#bec4cc', 'editor.selectionBackground': '#a6bfd8',
    'editor.inactiveSelectionBackground': '#bbc8d6', 'editorCursor.foreground': GREY_THEME.text,
    'editorWidget.background': GREY_THEME.raised, 'editorWidget.foreground': GREY_THEME.text,
    'editorWidget.border': GREY_THEME.border, 'editorHoverWidget.background': GREY_THEME.raised,
    'editorHoverWidget.foreground': GREY_THEME.text, 'editorHoverWidget.border': GREY_THEME.border,
    'editorSuggestWidget.background': GREY_THEME.raised, 'editorSuggestWidget.foreground': GREY_THEME.text,
    'editorSuggestWidget.border': GREY_THEME.border, 'editorSuggestWidget.selectedBackground': '#a6bfd8',
    'input.background': GREY_THEME.raised, 'input.foreground': GREY_THEME.text, 'input.border': GREY_THEME.border,
    'dropdown.background': GREY_THEME.raised, 'dropdown.foreground': GREY_THEME.text, 'dropdown.border': GREY_THEME.border,
    'scrollbarSlider.background': '#63708033', 'scrollbarSlider.hoverBackground': '#63708055',
    'scrollbarSlider.activeBackground': '#63708077', 'editorOverviewRuler.border': GREY_THEME.border,
  },
});

export interface CodeEditorHandle { find(): void; }
export interface CodeEditorProps { value: string; onChange?: (value: string) => void; language?: string; readOnly?: boolean; fontSize?: number; wordWrap?: boolean; editorKey?: string; editorRef?: Ref<CodeEditorHandle>; }
export function disposeEditors(tabId: string) {
  for (const model of monaco.editor.getModels()) if (model.uri.toString().startsWith(`api-manager://editor/${encodeURIComponent(tabId + ':')}`)) model.dispose();
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index); if (key?.startsWith(`api-manager-editor:${tabId}:`)) localStorage.removeItem(key);
  }
}
export function CodeEditor(props: CodeEditorProps) { return <EditorSession key={props.editorKey ?? 'editor'} {...props} />; }
function positionResponseFindTooltips(instance: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  const root = instance.getDomNode();
  if (!root || !root.closest('.response-body')) return { dispose() {} };
  // Monaco portals native control hovers beside the editor root inside this host.
  const container = instance.getContainerDomNode();
  let frame = 0, disposed = false;
  const modified = new Map<HTMLElement, { translate: string; marked: boolean; hovers: Map<HTMLElement, string | undefined> }>();
  const options: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] };
  const observer = new MutationObserver(schedule);
  const restore = (context: HTMLElement) => {
    const original = modified.get(context); if (!original) return;
    context.style.translate = original.translate;
    context.classList.toggle('api-manager-response-find-tooltip', original.marked);
    for (const [hover, marker] of original.hovers) {
      if (marker === undefined) delete hover.dataset.apiManagerFindTooltip;
      else hover.dataset.apiManagerFindTooltip = marker;
    }
    modified.delete(context);
  };
  const position = () => {
    frame = 0;
    const find = root.querySelector<HTMLElement>('.find-widget');
    observer.disconnect();
    try {
      if (!find || !find.classList.contains('visible')) { for (const context of modified.keys()) restore(context); return; }
      const findRect = find.getBoundingClientRect(), active = new Set<HTMLElement>();
      for (const hover of container.querySelectorAll<HTMLElement>('.monaco-hover.workbench-hover.compact')) {
        const context = hover.closest<HTMLElement>('.context-view');
        if (!context || !container.contains(context)) continue;
        if (!modified.has(context)) modified.set(context, { translate: context.style.translate, marked: context.classList.contains('api-manager-response-find-tooltip'), hovers: new Map() });
        const original = modified.get(context)!;
        if (!original.hovers.has(hover)) original.hovers.set(hover, hover.dataset.apiManagerFindTooltip);
        // Keep Monaco's native layout baseline, then move the popup below Find.
        context.style.translate = original.translate;
        const rect = hover.getBoundingClientRect();
        if (!rect.width || !rect.height) { restore(context); continue; }
        active.add(context);
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
        const top = Math.min(findRect.bottom + 8, Math.max(8, window.innerHeight - rect.height - 8));
        const offset = original.translate && original.translate !== 'none' ? original.translate.split(/\s+/) : [];
        context.style.translate = `calc(${offset[0] || '0px'} + ${left - rect.left}px) calc(${offset[1] || '0px'} + ${top - rect.top}px)`;
        context.classList.add('api-manager-response-find-tooltip');
        hover.dataset.apiManagerFindTooltip = 'true';
      }
      for (const context of modified.keys()) if (!active.has(context)) restore(context);
    } finally { if (!disposed) observer.observe(container, options); }
  };
  function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(position); }
  const resize = new ResizeObserver(schedule); resize.observe(root); observer.observe(container, options);
  window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
  return { dispose() { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); for (const context of modified.keys()) restore(context); resize.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); } };
}
function EditorSession({ value, onChange, language = 'json', readOnly = false, fontSize = 14, wordWrap = false, editorKey, editorRef }: CodeEditorProps) {
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const variableContext = useVariableContext();
  const variableContextRef = useRef(variableContext);
  variableContextRef.current = variableContext;
  const variableDecorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const pendingFind = useRef(false);
  const disposables = useRef<monaco.IDisposable[]>([]);
  const [theme, setTheme] = useState(() => editorThemeName(document.documentElement.dataset.theme));
  const key = editorKey ? `api-manager-editor:${editorKey}` : undefined;
  const decorateVariables = useCallback(() => {
    const instance = editor.current, model = instance?.getModel(), context = variableContextRef.current;
    if (!instance || !model) return;
    if (!context || readOnly || editorKey?.includes(':script:')) { variableDecorations.current?.clear(); return; }
    const escape = (text: string) => text.slice(0, 4096).replace(/[\\`*_\[\]()<>#+.!|~-]/g, '\\$&');
    const decorations = context.tokens(model.getValue()).map(token => {
      const details = token.details;
      const hover = [`**{{${escape(details.name)}}}**`, `**Scope:** ${details.source ? `${details.source.scope} · ${escape(details.source.name)}` : 'Unresolved'}`, `**Environment:** ${escape(details.environmentName || 'No environment selected')}`];
      if (details.value !== undefined) hover.push(`**Value:** ${escape(details.value || '(empty string)')}`);
      if (details.message) hover.push(escape(details.message));
      return { range: monaco.Range.fromPositions(model.getPositionAt(token.start), model.getPositionAt(token.end)), options: { inlineClassName: `monaco-variable-token variable-${details.status}`, hoverMessage: { value: hover.join('\n\n'), isTrusted: false, supportHtml: false }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } };
    });
    if (!variableDecorations.current) variableDecorations.current = instance.createDecorationsCollection(decorations);
    else variableDecorations.current.set(decorations);
  }, [readOnly, editorKey]);
  useEffect(() => { decorateVariables(); }, [value, variableContext, decorateVariables]);
  const find = useCallback(() => {
    const instance = editor.current;
    if (!instance) { pendingFind.current = true; return; }
    pendingFind.current = false;
    instance.focus();
    void instance.getAction('actions.find')?.run();
  }, []);
  useImperativeHandle(editorRef, () => ({ find }), [find]);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(editorThemeName(document.documentElement.dataset.theme)));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const mounted: OnMount = useCallback(instance => {
    editor.current = instance;
    if (readOnly && instance.getValue() !== value) instance.setValue(value);
    if (!readOnly) { decorateVariables(); disposables.current.push(instance.onDidChangeModelContent(decorateVariables)); }
    if (key) {
      try { const state = localStorage.getItem(key); if (state) instance.restoreViewState(JSON.parse(state)); } catch { /* view state is optional */ }
      const save = () => { try { localStorage.setItem(key, JSON.stringify(instance.saveViewState())); } catch { /* never block editing if storage is full */ } };
      disposables.current.push(instance.onDidScrollChange(save), instance.onDidChangeCursorPosition(save));
    }
    if (readOnly) disposables.current.push(positionResponseFindTooltips(instance));
    if (pendingFind.current) find();
  }, [key, find, readOnly, value, decorateVariables]);
  useEffect(() => () => {
    if (key && editor.current) {
      try { localStorage.setItem(key, JSON.stringify(editor.current.saveViewState())); } catch { /* optional state */ }
    }
    disposables.current.forEach(item => item.dispose());
    variableDecorations.current?.clear();
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
