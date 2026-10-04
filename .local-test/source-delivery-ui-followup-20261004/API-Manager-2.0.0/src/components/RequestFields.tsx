import { Check, File, Plus, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import type { KeyValue } from '../types';
import { row } from '../lib/model';
import { bridge } from '../lib/bridge';
import { VariableInput } from './VariableInput';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  fileFields?: boolean;
  variables?: boolean;
  readOnly?: boolean;
  error?: (message: string) => void;
}

export function RequestFields({ rows, onChange, fileFields, variables, readOnly, error }: Props) {
  const focus = useRef<{ id: string; field: string } | null>(null);
  const update = (id: string, change: Partial<KeyValue>) => onChange(rows.map(item => item.id === id ? { ...item, ...change } : item));
  const add = (change: Partial<KeyValue>) => {
    const next = { ...row(), ...change };
    focus.current = { id: next.id, field: Object.keys(change)[0] };
    onChange([...rows, next]);
  };
  const restoreFocus = (input: HTMLInputElement | null, id: string, field: string) => {
    if (input && focus.current?.id === id && focus.current.field === field) {
      input.focus(); input.setSelectionRange(input.value.length, input.value.length); focus.current = null;
    }
  };
  const pick = async (id?: string) => {
    try {
      const file = await bridge.selectFile();
      if (file) id ? update(id, { value: file, type: 'file' }) : add({ value: file, type: 'file' });
    } catch (cause) { error?.(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className={`kv-table ${variables ? 'variables-table' : ''}`}>
    <div className="kv-row kv-heading"><span /><span>{variables ? 'VARIABLE' : 'KEY'}</span><span>VALUE</span><span>DESCRIPTION</span><span /></div>
    {rows.map(item => <div className={`kv-row ${!item.enabled ? 'disabled-row' : ''}`} key={item.id}>
      <button className={`check-button ${item.enabled ? 'checked' : ''}`} disabled={readOnly} title={item.enabled ? 'Disable row' : 'Enable row'} aria-label={item.enabled ? 'Disable row' : 'Enable row'} onClick={() => update(item.id, { enabled: !item.enabled })}>{item.enabled && <Check size={13} />}</button>
      <div className="kv-key"><VariableInput highlight={!readOnly && !variables} ref={input => restoreFocus(input, item.id, 'key')} aria-label={variables ? 'Variable name' : 'Key'} placeholder={variables ? 'Variable' : 'Key'} value={item.key} readOnly={readOnly} onChange={event => update(item.id, { key: event.target.value })} />{fileFields && <select aria-label="Field type" value={item.type || 'text'} onChange={event => update(item.id, { type: event.target.value as 'text' | 'file', value: '' })}><option value="text">Text</option><option value="file">File</option></select>}</div>
      <div className="kv-value"><VariableInput highlight={!readOnly} ref={input => restoreFocus(input, item.id, 'value')} aria-label="Value" value={item.value} placeholder={item.type === 'file' ? 'Select a file' : 'Value'} readOnly={readOnly || item.type === 'file'} onChange={event => update(item.id, { value: event.target.value })} />{item.type === 'file' && <button className="icon-button" title="Select file" aria-label="Select file" onClick={() => pick(item.id)}><File size={14} /></button>}</div>
      <input ref={input => restoreFocus(input, item.id, 'description')} aria-label="Description" value={item.description || ''} placeholder="Description" readOnly={readOnly} onChange={event => update(item.id, { description: event.target.value })} />
      {!readOnly && <button className="icon-button quiet" title="Delete row" aria-label="Delete row" onClick={() => onChange(rows.filter(value => value.id !== item.id))}><Trash2 size={13} /></button>}
    </div>)}
    {!readOnly && <div className="kv-row kv-placeholder">
      <span className="placeholder-plus"><Plus size={13} /></span>
      <input aria-label={variables ? 'Add variable name' : 'Add key'} placeholder={variables ? 'Add a variable' : 'Key'} value="" onChange={event => add({ key: event.target.value })} />
      <input aria-label="Add value" placeholder="Value" value="" onChange={event => add({ value: event.target.value })} />
      <input aria-label="Add description" placeholder="Description" value="" onChange={event => add({ description: event.target.value })} />
      <span />
    </div>}
    {!rows.length && readOnly && <div className="empty-inline">No values to display.</div>}
  </div>;
}
