import { Check, Variable } from 'lucide-react';
import { useState } from 'react';
import type { Environment, KeyValue } from '../types';
import { VariableInput } from './VariableInput';
import './EnvironmentQuickEdit.css';

export interface EnvironmentQuickEditProps { environment?: Environment; globals: KeyValue[]; onSave: (variables: KeyValue[]) => void | Promise<void>; onClose: () => void; }
export function EnvironmentQuickEdit({ environment, globals, onSave, onClose }: EnvironmentQuickEditProps) {
  const [rows, setRows] = useState(() => structuredClone(environment?.variables ?? globals));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const update = (id: string, change: Partial<KeyValue>) => setRows(previous => previous.map(row => row.id === id ? { ...row, ...change } : row));
  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try { await onSave(structuredClone(rows)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  return <div className="environment-quick-edit">
    <div className="quick-environment-name"><Variable size={18} /><div><strong>{environment?.name || 'Globals'}</strong><span>{environment ? 'Active environment' : 'No environment selected'}</span></div></div>
    <p className="quick-environment-intro">{environment ? 'Edit the values used by requests in this environment.' : 'Requests use global, collection, and folder values while no environment is selected. Edit global values below.'} Changes apply when you save.</p>
    <div className="quick-variable-list">
      <div className="quick-variable-heading"><span /><span>Variable</span><span>Value</span></div>
      {rows.map(row => <div className={`quick-variable-row ${row.enabled ? '' : 'disabled'}`} key={row.id}><button type="button" className={`check-button ${row.enabled ? 'checked' : ''}`} disabled={saving} aria-label={`${row.enabled ? 'Disable' : 'Enable'} ${row.key}`} onClick={() => update(row.id, { enabled: !row.enabled })}>{row.enabled && <Check size={13} />}</button><span className="quick-variable-key" title={row.description || row.key}>{row.key || '(unnamed)'}</span><VariableInput aria-label={`Value for ${row.key}`} disabled={saving} value={row.value} onChange={event => update(row.id, { value: event.target.value })} spellCheck={false} /></div>)}
      {!rows.length && <div className="quick-variable-empty">No variables to edit. Add variables in the Environments section.</div>}
    </div>
    {error && <p className="quick-environment-error" role="alert">{error}</p>}
    <div className="modal-footer quick-environment-footer"><button className="button" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button></div>
  </div>;
}
export default EnvironmentQuickEdit;
