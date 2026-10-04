import { Check, Globe2, Layers2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Environment, KeyValue } from '../types';
import { row } from '../lib/model';
import { VariableInput } from './VariableInput';
import './EnvironmentQuickEdit.css';

export interface EnvironmentQuickEditProps { environment?: Environment; globals: KeyValue[]; onSave: (variables: KeyValue[]) => void | Promise<void>; onClose: () => void; }
export function EnvironmentQuickEdit({ environment, globals, onSave, onClose }: EnvironmentQuickEditProps) {
  const [rows, setRows] = useState(() => [...structuredClone(environment?.variables ?? globals), { ...row(), enabled: false }]);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const popup = useRef<HTMLDivElement>(null);
  const saveInProgress = useRef(false);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const update = (id: string, change: Partial<KeyValue>) => {
    if (saveInProgress.current) return;
    setRows(previous => {
      const updated = previous.map((variable, index) => {
        if (variable.id !== id) return variable;
        const next = { ...variable, ...change };
        if (index === previous.length - 1 && (next.key !== '' || next.value !== '')) next.enabled = true;
        return next;
      });
      const last = updated[updated.length - 1];
      return last.key !== '' || last.value !== '' ? [...updated, { ...row(), enabled: false }] : updated;
    });
    setError('');
  };
  const deleteVariable = (id: string) => {
    if (saveInProgress.current) return;
    setRows(previous => previous.filter(variable => variable.id !== id));
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
      <div className="quick-variable-heading"><span /><span>Variable</span><span>Value</span><span /></div>
      {rows.map((variable, index) => {
        const placeholder = index === rows.length - 1;
        return <div className={`quick-variable-row ${variable.enabled ? '' : 'disabled'} ${placeholder ? 'placeholder' : ''}`} key={variable.id}><button type="button" className={`check-button ${variable.enabled ? 'checked' : ''}`} disabled={saving || placeholder} aria-label={`${variable.enabled ? 'Disable' : 'Enable'} ${variable.key || `variable ${index + 1}`}`} aria-pressed={variable.enabled} onClick={() => update(variable.id, { enabled: !variable.enabled })}>{variable.enabled && <Check size={13} />}</button><input ref={input => { if (input) nameInputs.current.set(variable.id, input); else nameInputs.current.delete(variable.id); }} className="quick-variable-key" aria-label={placeholder ? 'Add variable name' : `Variable name ${index + 1}`} title={variable.description || variable.key} placeholder="Variable name" disabled={saving} value={variable.key} onChange={event => update(variable.id, { key: event.target.value })} spellCheck={false} /><VariableInput aria-label={placeholder ? 'Add variable value' : variable.key ? `Value for ${variable.key}` : `Value for variable ${index + 1}`} placeholder="Value" disabled={saving} value={variable.value} onChange={event => update(variable.id, { value: event.target.value })} spellCheck={false} />{placeholder ? <span className="quick-variable-action-placeholder" /> : <button type="button" className="quick-variable-delete" aria-label={`Delete variable ${variable.key || index + 1}`} title="Delete variable" disabled={saving} onClick={() => deleteVariable(variable.id)}><Trash2 size={14} aria-hidden="true" /></button>}</div>;
      })}
    </div>
    {error && <p className="quick-environment-error" role="alert">{error}</p>}
    <div className="modal-footer quick-environment-footer"><button className="button" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button></div>
  </div>;
}
export default EnvironmentQuickEdit;
