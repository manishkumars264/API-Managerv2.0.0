import { ArrowDownToLine, Code2, Plus } from 'lucide-react';
import './EmptyWorkspace.css';

export function EmptyWorkspace({ onNew, onImport }: { onNew: () => void; onImport: () => void }) {
  return <section className="workspace-empty" aria-label="Empty workspace">
    <span className="workspace-empty-icon"><Code2 size={32} /></span>
    <h2>Start with an API request</h2>
    <p>Open a saved API or import a cURL command, then send it to see the response.</p>
    <div><button className="button primary" onClick={onNew}><Plus size={14} />New request</button><button className="button" onClick={onImport}><ArrowDownToLine size={14} />Import cURL</button></div>
  </section>;
}
