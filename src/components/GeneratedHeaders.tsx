import { useMemo } from 'react';
import type { ApiRequest, Workspace } from '../types';
import { buildGeneratedHeaders } from '../lib/generated-headers';
import './GeneratedHeaders.css';

export function GeneratedHeaders({ workspace, request }: { workspace: Workspace; request: ApiRequest }) {
  const preview = useMemo(() => buildGeneratedHeaders(workspace, request), [workspace, request]);
  return <details className="generated-headers">
    <summary>Auto-generated headers <span>({preview.headers.length})</span></summary>
    <div className="generated-header-table" role="table" aria-label="Auto-generated request headers">
      <div className="generated-header-row heading" role="row"><span role="columnheader">HEADER</span><span role="columnheader">VALUE</span><span role="columnheader">SOURCE</span></div>
      {preview.headers.map(header => <div className={`generated-header-row ${header.status}`} role="row" key={header.key.toLowerCase()}><code role="cell">{header.key}</code><div role="cell"><code className="generated-header-value">{header.value}</code>{header.note && <small>{header.note}</small>}</div><span role="cell">{header.source}</span></div>)}
    </div>
    {preview.notes.map(note => <p key={note} className="generated-header-note">{note}</p>)}
  </details>;
}
