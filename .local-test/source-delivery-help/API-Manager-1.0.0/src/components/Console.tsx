import { ChevronDown, ChevronRight, ExternalLink, Play, Search, TerminalSquare, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { HistoryEntry } from '../types';
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
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('api-manager-console-hidden') || '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string').slice(0, 10000) : []; } catch { return []; }
  });
  useEffect(() => { localStorage.setItem('api-manager-console-hidden', JSON.stringify(hidden)); }, [hidden]);
  const needle = query.toLowerCase();
  const hiddenIds = new Set(hidden);
  const entries = [...pending, ...history].filter(entry => !hiddenIds.has(entry.id) && (!needle || [entry.request.method, entry.request.name, entry.request.url, entry.error, entry.response?.status].join(' ').toLowerCase().includes(needle) || entry.scriptResults?.logs.some(log => log.message.toLowerCase().includes(needle))));
  return <section className="console-panel" aria-label="API console">
    <header className="console-heading"><TerminalSquare size={15} /><strong>Console</strong><span className="console-count">{entries.length}</span><label className="console-search"><Search size={13} /><input aria-label="Filter console" placeholder="Filter requests and logs" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="icon-button" aria-label="Clear console" title="Clear console display (keeps history)" onClick={() => { setHidden([...pending, ...history].map(entry => entry.id).slice(0, 10000)); setExpanded(null); }}><Trash2 size={14} /></button><button className="icon-button" aria-label="Close console" title="Close console" onClick={onClose}><X size={16} /></button></header>
    <div className="console-list">
      {entries.map(entry => {
        const isPending = pending.some(run => run.id === entry.id), open = expanded === entry.id;
        const failed = !!entry.error || !!entry.scriptResults?.error || (entry.response?.status ?? 0) >= 400;
        return <article className={`console-entry ${failed ? 'console-error' : ''}`} key={entry.id}>
          <div className="console-run-row"><button className="console-run-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} console run ${entry.request.name}`} aria-expanded={open} onClick={() => setExpanded(open ? null : entry.id)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span className={`method-badge ${entry.request.method.toLowerCase()}`}>{entry.request.method}</span><span className="console-run-url" title={entry.request.url}>{entry.request.url || entry.request.name}</span><span className="console-run-status">{isPending ? 'Sending…' : entry.error ? 'Error' : entry.response ? `${entry.response.status} ${entry.response.statusText}` : 'Stopped'}</span>{entry.response && <span className="console-duration">{Math.round(entry.response.duration)} ms</span>}</button>{!isPending && <><button className="icon-button" aria-label={`Open console run ${entry.request.name}`} title="Open saved request and response" onClick={() => onOpen(entry, false)}><ExternalLink size={13} /></button><button className="icon-button" aria-label={`Run again ${entry.request.name}`} title="Run again" onClick={() => onOpen(entry, true)}><Play size={13} /></button></>}</div>
          {entry.scriptResults?.logs.slice(0, open ? 1000 : 3).map((log, index) => <div className={`console-log console-log-${log.level}`} key={index}><span>{log.level}</span><pre>{log.message}</pre></div>)}
          {!open && (entry.scriptResults?.logs.length ?? 0) > 3 && <button className="console-more-logs" onClick={() => setExpanded(entry.id)}>Show {entry.scriptResults!.logs.length - 3} more messages</button>}
          {entry.error && <div className="console-run-error">{entry.error}</div>}
          {entry.scriptResults?.error && <div className="console-run-error">Script: {entry.scriptResults.error}</div>}
          {open && <div className="console-details"><div><h4>Request snapshot</h4><pre>{entry.request.method} {entry.request.url}{'\n'}{entry.request.headers.filter(header => header.enabled).map(header => `${header.key}: ${header.value}`).join('\n')}{'\n\n'}{clipped(entry.request.body.mode === 'raw' ? entry.request.body.raw : entry.request.body.mode === 'binary' ? entry.request.body.filePath || '' : entry.request.body.fields.filter(field => field.enabled).map(field => `${field.key}: ${field.value}`).join('\n'))}</pre><small>Authorization: {entry.request.auth.type} · Values are resolved when sending.</small></div>{entry.response && <div><h4>Response</h4><pre>HTTP {entry.response.status} {entry.response.statusText}{'\n'}{entry.response.headers.map(header => `${header.key}: ${header.value}`).join('\n')}{'\n\n'}{clipped(entry.response.body)}</pre>{entry.response.body.length > 100000 && <small>Console preview shows the first 100,000 characters. Open this run to inspect its saved body.</small>}{entry.response.truncated && <small>Body was truncated at the configured response limit.</small>}</div>}{entry.scriptResults?.tests.length ? <div><h4>Test results</h4>{entry.scriptResults.tests.map((result, index) => <p className={result.passed ? 'console-test-pass' : 'console-test-fail'} key={index}>{result.passed ? 'PASS' : 'FAIL'} {result.name}{result.error ? ` — ${result.error}` : ''}</p>)}</div> : null}</div>}
        </article>;
      })}
      {!entries.length && <div className="console-empty"><TerminalSquare size={24} /><span>{query ? 'No matching requests or logs.' : 'Send a request to see activity here.'}</span></div>}
    </div>
  </section>;
}
