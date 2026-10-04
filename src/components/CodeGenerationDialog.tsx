import { useMemo, useState } from 'react';
import type { ApiRequest, KeyValue } from '../types';
import { generateRequestCode, REQUEST_CODE_LANGUAGES, type RequestCodeLanguage } from '../lib/code-generation';
import './CodeGenerationDialog.css';

interface Props { request: ApiRequest; variables: KeyValue[]; onCopy: (code: string) => Promise<void>; onClose: () => void; onError: (message: string) => void; }
export function CodeGenerationDialog({ request, variables, onCopy, onClose, onError }: Props) {
  const [language, setLanguage] = useState<RequestCodeLanguage>(() => {
    const previous = localStorage.getItem('api-manager-code-language');
    return REQUEST_CODE_LANGUAGES.some(item => item.id === previous) ? previous as RequestCodeLanguage : 'curl';
  });
  const [copying, setCopying] = useState(false);
  const result = useMemo(() => { try { return { value: generateRequestCode(request, language, variables) }; } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; } }, [request, language, variables]);
  const copy = async () => { if (!result.value || copying) return; setCopying(true); try { await onCopy(result.value.code); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } finally { setCopying(false); } };
  return <div className="code-generation-dialog">
    <div className="code-generation-options"><label>Language<select aria-label="Code language" value={language} onChange={event => { const next = event.target.value as RequestCodeLanguage; setLanguage(next); localStorage.setItem('api-manager-code-language', next); }}>{REQUEST_CODE_LANGUAGES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><span>{result.value?.fileName || 'Request example'}</span></div>
    {result.error ? <div className="code-generation-error" role="alert">{result.error}</div> : <>
      <div className="code-generation-notes">{result.value?.dependencies.map(note => <p key={note}>{note}</p>)}{result.value?.warnings.map(warning => <p className="code-generation-warning" key={warning}>{warning}</p>)}</div>
      <textarea className="code-generation-source" aria-label="Generated request code" readOnly spellCheck={false} value={result.value?.code || ''} />
    </>}
    <div className="modal-footer code-generation-footer"><span>Generation does not send a request.</span><button className="button" onClick={() => void copy()} disabled={!result.value || copying}>{copying ? 'Copying…' : 'Copy code'}</button><button className="button primary" onClick={onClose}>Done</button></div>
  </div>;
}
export default CodeGenerationDialog;
