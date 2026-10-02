import { applyEdits, format, parseTree, type ParseError } from 'jsonc-parser';
import xmlFormat from 'xml-formatter';
import { XMLValidator } from 'fast-xml-parser';
import type { ApiRequest, ApiResponse } from '../types';
import { row } from './model';

export function beautify(value: string, language: string): string {
  if (language === 'json') {
    const errors: ParseError[] = [];
    const parsed = parseTree(value, errors, { allowTrailingComma: false, disallowComments: true });
    if (!parsed || errors.length) throw new Error(`Invalid JSON${errors[0] ? ` near character ${errors[0].offset + 1}` : ''}.`);
    return applyEdits(value, format(value, undefined, { insertSpaces: true, tabSize: 2, eol: '\n' })).trim();
  }
  if (language === 'xml') {
    const result = XMLValidator.validate(value);
    if (result !== true) throw new Error(`Invalid XML: ${result.err.msg} (line ${result.err.line}).`);
    return xmlFormat(value, { indentation: '  ', lineSeparator: '\n', collapseContent: true, throwOnFailure: true });
  }
  throw new Error('Beautify supports JSON and XML.');
}
export function responseDocument(response: ApiResponse, includeHeaders: boolean): string {
  let body: string;
  try { body = beautify(response.body, 'json'); } catch { body = JSON.stringify(response.body); }
  if (!includeHeaders) return body;
  const metadata = JSON.stringify({ status: response.status, statusText: response.statusText, url: response.url, headers: response.headers.map(({ key, value }) => ({ key, value })) }, null, 2);
  // Insert the validated JSON text directly so 64-bit numbers and duplicate keys
  // are preserved instead of being converted through JavaScript Number.
  return `${metadata.slice(0, -2)},\n  "body": ${body.replace(/\n/g, '\n  ')}\n}`;
}
export function configureSoap(request: ApiRequest, version: '1.1' | '1.2', action = ''): ApiRequest {
  if (/[\r\n\0]/.test(action)) throw new Error('SOAP action must not contain line breaks.');
  const escapedAction = action.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const namespace = version === '1.1' ? 'http://schemas.xmlsoap.org/soap/envelope/' : 'http://www.w3.org/2003/05/soap-envelope';
  let raw = request.body.raw;
  if (!raw.trim()) raw = `<?xml version="1.0" encoding="UTF-8"?>\n<soap:Envelope xmlns:soap="${namespace}">\n  <soap:Header />\n  <soap:Body>\n    <!-- Add your SOAP operation here -->\n  </soap:Body>\n</soap:Envelope>`;
  else if (request.soap && request.soap.version !== version) raw = raw.replace(request.soap.version === '1.1' ? 'http://schemas.xmlsoap.org/soap/envelope/' : 'http://www.w3.org/2003/05/soap-envelope', namespace);
  const headers = request.headers.filter(header => !['soapaction', 'content-type'].includes(header.key.toLowerCase()));
  headers.push(row('Content-Type', version === '1.1' ? 'text/xml; charset=utf-8' : `application/soap+xml; charset=utf-8${action ? `; action="${escapedAction}"` : ''}`));
  if (version === '1.1') headers.push(row('SOAPAction', `"${escapedAction}"`));
  return { ...request, method: 'POST', soap: { version, action }, body: { ...request.body, mode: 'raw', language: 'xml', raw }, headers };
}
