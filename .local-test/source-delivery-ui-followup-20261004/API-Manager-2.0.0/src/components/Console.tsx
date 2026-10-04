import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Play, Search, TerminalSquare, Trash2, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { HistoryEntry } from '../types';
import { clampConsoleHeight, consoleHeightBounds, CONSOLE_HEIGHT_STORAGE_KEY, DEFAULT_CONSOLE_HEIGHT, readConsoleHeight } from '../lib/console-height';
import { newestConsoleEntries, newestScriptLogs } from '../lib/console-order';
import './Console.css';

interface Props {
  history: HistoryEntry[];
  pending?: HistoryEntry[];
  onOpen: (entry: HistoryEntry, run: boolean) => void;
  onClose: () => void;
}
const clipped = (text: string) => text.slice(0, 100000);

/** A local activity viewer. Clearing it never changes retained run history. */
export function ConsolePanel({ history, pending = [], onOpen, onClose }: Props) {
  const panel = useRef<HTMLElement>(null);
  const listId = useId();
  const [preferredHeight, setPreferredHeight] = useState(() => { try { return readConsoleHeight(localStorage.getItem(CONSOLE_HEIGHT_STORAGE_KEY)); } catch { return DEFAULT_CONSOLE_HEIGHT; } });
  const [bounds, setBounds] = useState(() => consoleHeightBounds(window.innerHeight, Math.max(0, window.innerHeight - 120)));
  const height = clampConsoleHeight(preferredHeight, bounds);
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  useEffect(() => { try { localStorage.setItem(CONSOLE_HEIGHT_STORAGE_KEY, String(preferredHeight)); } catch { /* Resizing remains available if local storage is full. */ } }, [preferredHeight]);
  useLayoutEffect(() => {
    const element = panel.current, shell = element?.parentElement;
    if (!element || !shell) return;
    const siblings = Array.from(shell.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child !== element && !child.classList.contains('workspace-body') && !['absolute', 'fixed'].includes(getComputedStyle(child).position));
    const measure = () => {
      const shellHeight = shell.getBoundingClientRect().height;
      if (!shellHeight) return;
      const occupied = siblings.reduce((total, sibling) => total + sibling.getBoundingClientRect().height, 0);
      const next = consoleHeightBounds(Math.min(window.innerHeight, shellHeight), Math.max(0, shellHeight - occupied));
      setBounds(current => current.min === next.min && current.max === next.max ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(shell); siblings.forEach(sibling => observer.observe(sibling));
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height }; setResizing(true);
  };
  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); setPreferredHeight(clampConsoleHeight(current.startHeight + current.startY - event.clientY, bounds));
  };
  const endResize = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null; setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyResize = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 50 : 20;
    const next = event.key === 'ArrowUp' ? height + step : event.key === 'ArrowDown' ? height - step : event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : undefined;
    if (next === undefined) return;
    event.preventDefault(); setPreferredHeight(clampConsoleHeight(next, bounds));
  };
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<{ id: string; error?: string } | null>(null);
  const copyCurl = async (id: string, curl: string) => {
    try { await navigator.clipboard.writeText(curl); setCopyStatus({ id }); }
    catch { setCopyStatus({ id, error: 'Could not copy the cURL. Select the command and copy it manually.' }); }
  };
  const [hidden, setHidden] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('api-manager-console-hidden') || '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string').slice(0, 10000) : []; } catch { return []; }
  });
  useEffect(() => { localStorage.setItem('api-manager-console-hidden', JSON.stringify(hidden)); }, [hidden]);
  const needle = query.toLowerCase();
  const hiddenIds = new Set(hidden);
  const entries = newestConsoleEntries([...pending, ...history]).filter(entry => !hiddenIds.has(entry.id) && (!needle || [entry.request.method, entry.request.name, entry.request.url, entry.requestUrl, entry.response?.requestUrl, entry.error, entry.response?.status].join(' ').toLowerCase().includes(needle) || entry.scriptResults?.logs.some(log => log.message.toLowerCase().includes(needle))));
  return <section ref={panel} className={`console-panel${resizing ? ' console-resizing' : ''}`} aria-label="API console" style={{ height, minHeight: bounds.min, maxHeight: bounds.max }}>
    <div className="console-resizer" role="separator" aria-label="Resize console" aria-orientation="horizontal" aria-controls={listId} aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={height} aria-valuetext={`${height} pixels high`} tabIndex={0} title="Drag to resize console. Arrow keys resize; Home and End set minimum and maximum height." onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize} onKeyDown={keyResize} />
    <header className="console-heading"><TerminalSquare size={15} /><strong>Console</strong><span className="console-count">{entries.length}</span><label className="console-search"><Search size={13} /><input aria-label="Filter console" placeholder="Filter requests and logs" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="icon-button" aria-label="Clear console" title="Clear console display (keeps history)" onClick={() => { setHidden([...pending, ...history].map(entry => entry.id).slice(0, 10000)); setExpanded(null); }}><Trash2 size={14} /></button><button className="icon-button" aria-label="Close console" title="Close console" onClick={onClose}><X size={16} /></button></header>
    <div id={listId} className="console-list">
      {entries.map(entry => {
        const isPending = pending.some(run => run.id === entry.id), open = expanded === entry.id;
        const failed = !!entry.error || !!entry.scriptResults?.error || (entry.response?.status ?? 0) >= 400;
        const requestUrl = entry.requestUrl || entry.response?.requestUrl || entry.request.url;
        const sentCurl = entry.sentCurl || entry.response?.sentCurl;
        const sentCurlNote = entry.sentCurlNote || entry.response?.sentCurlNote;
        const logs = newestScriptLogs(entry.scriptResults?.logs ?? []);
        return <article className={`console-entry ${failed ? 'console-error' : ''}`} key={entry.id}>
          <div className="console-run-row"><button className="console-run-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} console run ${entry.request.name}`} aria-expanded={open} onClick={() => setExpanded(open ? null : entry.id)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span className={`method-badge ${entry.request.method.toLowerCase()}`}>{entry.request.method}</span><span className="console-run-url" title={requestUrl}>{requestUrl || entry.request.name}</span><span className="console-run-status">{isPending ? 'Sending…' : entry.error ? 'Error' : entry.response ? `${entry.response.status} ${entry.response.statusText}` : 'Stopped'}</span>{entry.response && <span className="console-duration">{Math.round(entry.response.duration)} ms</span>}</button>{!isPending && <><button className="icon-button" aria-label={`Open console run ${entry.request.name}`} title="Open saved request and response" onClick={() => onOpen(entry, false)}><ExternalLink size={13} /></button><button className="icon-button" aria-label={`Run again ${entry.request.name}`} title="Run again" onClick={() => onOpen(entry, true)}><Play size={13} /></button></>}</div>
          {logs.slice(0, open ? 1000 : 3).map((log, index) => <div className={`console-log console-log-${log.level}`} key={index}><span>{log.level}</span><pre>{log.message}</pre></div>)}
          {!open && (entry.scriptResults?.logs.length ?? 0) > 3 && <button className="console-more-logs" onClick={() => setExpanded(entry.id)}>Show {entry.scriptResults!.logs.length - 3} more messages</button>}
          {entry.error && <div className="console-run-error">{entry.error}</div>}
          {entry.scriptResults?.error && <div className="console-run-error">Script: {entry.scriptResults.error}</div>}
          {open && <div className="console-details"><div><h4 className="console-request-heading"><span>{sentCurl ? 'Request cURL' : 'Request snapshot'}</span>{sentCurl && <button className="text-button" aria-label={`Copy cURL for ${entry.request.name}`} onClick={() => void copyCurl(entry.id, sentCurl)}>{copyStatus?.id === entry.id && !copyStatus.error ? <Check size={12} /> : <Copy size={12} />}{copyStatus?.id === entry.id && !copyStatus.error ? 'Copied' : 'Copy cURL'}</button>}</h4>{sentCurl ? <><pre className="console-curl">{clipped(sentCurl)}</pre>{sentCurl.length > 100000 && <small>Preview shows the first 100,000 characters. Copy cURL copies the complete captured command.</small>}</> : <pre>{entry.request.method} {entry.request.url}{'\n'}{entry.request.headers.filter(header => header.enabled).map(header => `${header.key}: ${header.value}`).join('\n')}{'\n\n'}{clipped(entry.request.body.mode === 'raw' ? entry.request.body.raw : entry.request.body.mode === 'binary' ? entry.request.body.filePath || '' : entry.request.body.fields.filter(field => field.enabled).map(field => `${field.key}: ${field.value}`).join('\n'))}</pre>}{sentCurlNote && <small className="console-curl-note">{sentCurlNote}</small>}{!sentCurl && !sentCurlNote && <small>{isPending ? 'The captured cURL appears when the request finishes.' : 'A native cURL snapshot was not captured for this run.'}</small>}{copyStatus?.id === entry.id && <small className={copyStatus.error ? 'console-test-fail' : 'console-test-pass'} role="status">{copyStatus.error || 'cURL copied.'}</small>}</div>{entry.response && <div><h4>Response</h4><pre>HTTP {entry.response.status} {entry.response.statusText}{'\n'}{entry.response.headers.map(header => `${header.key}: ${header.value}`).join('\n')}{'\n\n'}{clipped(entry.response.body)}</pre>{entry.response.body.length > 100000 && <small>Console preview shows the first 100,000 characters. Open this run to inspect its saved body.</small>}{entry.response.truncated && <small>Body was truncated at the configured response limit.</small>}</div>}{entry.scriptResults?.tests.length ? <div><h4>Test results</h4>{entry.scriptResults.tests.map((result, index) => <p className={result.passed ? 'console-test-pass' : 'console-test-fail'} key={index}>{result.passed ? 'PASS' : 'FAIL'} {result.name}{result.error ? ` — ${result.error}` : ''}</p>)}</div> : null}</div>}
        </article>;
      })}
      {!entries.length && <div className="console-empty"><TerminalSquare size={24} /><span>{query ? 'No matching requests or logs.' : 'Send a request to see activity here.'}</span></div>}
    </div>
  </section>;
}
