import { Check, Globe2, Layers2, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Environment, KeyValue } from '../types';
import { row } from '../lib/model';
import { VariableInput } from './VariableInput';
import './EnvironmentQuickEdit.css';

export interface EnvironmentQuickEditProps { environment?: Environment; globals: KeyValue[]; onSave: (variables: KeyValue[]) => void | Promise<void>; onClose: () => void; }
export function EnvironmentQuickEdit({ environment, globals, onSave, onClose }: EnvironmentQuickEditProps) {
  const [rows, setRows] = useState(() => structuredClone(environment?.variables ?? globals));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const popup = useRef<HTMLDivElement>(null);
  const saveInProgress = useRef(false);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const focusName = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!focusName.current) return;
    nameInputs.current.get(focusName.current)?.focus();
    focusName.current = null;
  }, [rows]);
  const update = (id: string, change: Partial<KeyValue>) => setRows(previous => previous.map(row => row.id === id ? { ...row, ...change } : row));
  const addVariable = () => {
    if (saveInProgress.current) return;
    const variable = row();
    focusName.current = variable.id;
    setRows(previous => [...previous, variable]);
    setError('');
  };
  const save = async () => {
    if (saveInProgress.current) return;
    const variables = rows.filter(variable => variable.key.trim() || variable.value !== '');
    const unnamed = variables.find(variable => !variable.key.trim());
    if (unnamed) {
      setError('Enter a name for each variable that has a value. Empty rows are skipped when saving.');
      nameInputs.current.get(unnamed.id)?.focus();
      return;
    }
    saveInProgress.current = true;
    setSaving(true); setError('');
    try { await onSave(structuredClone(variables)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { saveInProgress.current = false; setSaving(false); }
  };
  const currentSave = useRef(save);
  currentSave.current = save;
  useEffect(() => {
    const dialog = popup.current?.closest('[role="dialog"]') ?? popup.current;
    const shortcut = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) void currentSave.current();
    };
    dialog?.addEventListener('keydown', shortcut, true);
    return () => { dialog?.removeEventListener('keydown', shortcut, true); };
  }, []);
  return <div ref={popup} className="environment-quick-edit">
    <div className="quick-environment-name">{environment ? <Layers2 size={18} /> : <Globe2 size={18} />}<div><strong>{environment?.name || 'Globals'}</strong><span>{environment ? 'Active environment' : 'No environment selected'}</span></div></div>
    <p className="quick-environment-intro">{environment ? 'Edit the values used by requests in this environment.' : 'Requests use global, collection, and folder values while no environment is selected. Edit global values below.'} Changes apply when you save.</p>
    <div className="quick-variable-list">
      <div className="quick-variable-heading"><span /><span>Variable</span><span>Value</span></div>
      {rows.map((row, index) => <div className={`quick-variable-row ${row.enabled ? '' : 'disabled'}`} key={row.id}><button type="button" className={`check-button ${row.enabled ? 'checked' : ''}`} disabled={saving} aria-label={`${row.enabled ? 'Disable' : 'Enable'} ${row.key || `variable ${index + 1}`}`} onClick={() => update(row.id, { enabled: !row.enabled })}>{row.enabled && <Check size={13} />}</button><input ref={input => { if (input) nameInputs.current.set(row.id, input); else nameInputs.current.delete(row.id); }} className="quick-variable-key" aria-label={`Variable name ${index + 1}`} title={row.description || row.key} placeholder="Variable name" disabled={saving} value={row.key} onChange={event => update(row.id, { key: event.target.value })} spellCheck={false} /><VariableInput aria-label={row.key ? `Value for ${row.key}` : `Value for variable ${index + 1}`} placeholder="Value" disabled={saving} value={row.value} onChange={event => update(row.id, { value: event.target.value })} spellCheck={false} /></div>)}
      {!rows.length && <div className="quick-variable-empty">No variables yet. Add a variable below.</div>}
    </div>
    <button className="text-button quick-add-variable" type="button" aria-label="Add environment variable" disabled={saving} onClick={addVariable}><Plus size={14} />Add variable</button>
    {error && <p className="quick-environment-error" role="alert">{error}</p>}
    <div className="modal-footer quick-environment-footer"><button className="button" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button></div>
  </div>;
}
export default EnvironmentQuickEdit;
