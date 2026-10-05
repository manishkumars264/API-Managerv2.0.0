import { version } from '../../package.json';
import type { ApiRequest, RequestAuth, Workspace } from '../types';
import { effectiveAuth } from './variables';
import { buildVariableContext } from './variable-details';

export interface GeneratedHeader { key: string; value: string; source: string; status: 'resolved' | 'pending' | 'error'; note?: string; }
export interface GeneratedHeaderPreview { headers: GeneratedHeader[]; notes: string[]; }
class PendingValue extends Error {}

/** A read-only preview. Never consumes dynamic variables, signs, sends, or edits the request. */
export function buildGeneratedHeaders(workspace: Workspace, request: ApiRequest): GeneratedHeaderPreview {
  const context = buildVariableContext(workspace, request), headers: GeneratedHeader[] = [], notes: string[] = [];
  const resolve = (value = '') => value.replace(/\{\{([^{}]+)\}\}/g, (_token, name: string) => {
    const details = context.describe(name);
    if (details.status === 'dynamic') throw new PendingValue('Dynamic values are generated when sent.');
    if (details.status !== 'resolved') throw new Error(details.message || `Unresolved variable: ${name}`);
    return details.value ?? '';
  });
  // Disabled headers do not affect Send. Preserve first-value semantics for defaults.
  const custom = request.headers.filter(item => item.enabled && item.key.trim()).map(item => {
    try { return { key: resolve(item.key).trim(), value: resolve(item.value), status: 'resolved' as const }; }
    catch (error) { return { key: item.key.trim(), value: '', status: error instanceof PendingValue ? 'pending' as const : 'error' as const }; }
  });
  const existing = (key: string) => headers.find(item => item.key.toLowerCase() === key.toLowerCase()) ?? custom.find(item => item.key.toLowerCase() === key.toLowerCase());
  const add = (key: string, value: () => string, source: string) => {
    const override = custom.some(item => item.key.toLowerCase() === key.toLowerCase());
    let header: GeneratedHeader;
    try {
      const resolved = value();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n\0]/.test(resolved)) throw new Error('Invalid HTTP header name or value.');
      header = { key, value: resolved, source, status: 'resolved' };
    } catch (error) {
      header = { key, value: error instanceof PendingValue ? 'Generated when sent' : 'Unavailable', source, status: error instanceof PendingValue ? 'pending' : 'error', note: error instanceof Error ? error.message : String(error) };
    }
    if (override) header.note = [header.note, `Replaces custom ${key} header.`].filter(Boolean).join(' ');
    const index = headers.findIndex(item => item.key.toLowerCase() === key.toLowerCase());
    if (index >= 0) headers.splice(index, 1);
    headers.push(header);
  };
  const base64 = (value: string) => btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join(''));
  const auth = effectiveAuth(workspace, request), inherited = request.auth.type === 'inherit' ? ' (inherited)' : '';
  const field = (...keys: string[]) => {
    const fields = { ...auth, ...auth.fields } as Record<string, unknown>;
    for (const key of keys) if (['string', 'number', 'boolean'].includes(typeof fields[key])) return resolve(String(fields[key]));
    return '';
  };
  if (auth.type === 'basic') add('Authorization', () => `Basic ${base64(`${resolve(auth.username || '')}:${resolve(auth.password || '')}`)}`, `Basic auth${inherited}`);
  else if (auth.type === 'bearer') add('Authorization', () => `Bearer ${resolve(auth.token || '')}`, `Bearer auth${inherited}`);
  else if (auth.type === 'apikey') {
    try {
      const key = resolve(auth.key || '');
      if (!key) throw new Error('Enter the API key name.');
      if (auth.in === 'query') notes.push(`API key is added to the ${key} query parameter, rather than a header.`);
      else add(key, () => resolve(auth.value || ''), `API key auth${inherited}`);
    } catch (error) { notes.push(error instanceof PendingValue ? 'API key name is generated when sent.' : error instanceof Error ? error.message : String(error)); }
  } else if (auth.type === 'oauth2') {
    try {
      if (['queryParams', 'query'].includes(field('addTokenTo'))) notes.push(`OAuth 2 token is added to the ${field('queryParamKey', 'queryParamName') || 'access_token'} query parameter, rather than a header.`);
      else add('Authorization', () => {
        const token = field('accessToken', 'accesstoken', 'token');
        if (!token) throw new Error('Enter an OAuth 2 access token or use Get Token.');
        return `${field('headerPrefix') || field('tokenType') || 'Bearer'} ${token}`;
      }, `OAuth 2 auth${inherited}`);
    } catch (error) { notes.push(error instanceof Error ? error.message : String(error)); }
  } else if (!['none', 'inherit'].includes(auth.type)) {
    const labels: Partial<Record<RequestAuth['type'], string>> = { digest: 'Digest', ntlm: 'NTLM', oauth1: 'OAuth 1', hawk: 'Hawk', awsv4: 'AWS Signature V4', edgegrid: 'EdgeGrid', jwt: 'JWT', asap: 'ASAP' };
    notes.push(`${labels[auth.type] || auth.type}${inherited}: signing or challenge headers and query values are generated when sent. View the actual request in Console after sending.`);
  }
  // URL credentials are a Basic fallback, unless Authorization is already present.
  if (!existing('Authorization')?.value && !existing('Authorization')?.status?.match(/pending|error/)) {
    try {
      const url = new URL(resolve(request.url));
      if (url.username || url.password) add('Authorization', () => `Basic ${base64(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`)}`, 'URL credentials');
    } catch { /* An incomplete URL does not block header editing. Send validates it. */ }
  }
  const fallback = (key: string, value: string, source: string) => {
    const current = existing(key);
    if (!current || (current.status === 'resolved' && !current.value)) add(key, () => value, source);
  };
  if (request.body.mode === 'formdata') {
    for (let index = headers.length - 1; index >= 0; index--) if (['content-type', 'content-length'].includes(headers[index].key.toLowerCase())) headers.splice(index, 1);
    headers.push({ key: 'Content-Type', value: 'multipart/form-data; boundary=…', source: 'Multipart body', status: 'pending', note: 'The body boundary is generated when sent. Custom Content-Type and Content-Length are replaced.' });
  } else if (request.body.mode === 'raw') {
    fallback('Content-Type', { json: 'application/json', xml: 'application/xml', html: 'text/html', javascript: 'application/javascript', text: 'text/plain' }[request.body.language], 'Raw body');
  } else if (request.body.mode === 'urlencoded') fallback('Content-Type', 'application/x-www-form-urlencoded', 'Form body');
  else if (request.body.mode === 'binary') fallback('Content-Type', 'application/octet-stream', 'Binary body');
  fallback('User-Agent', `API-Manager/${version}`, 'Default header');
  fallback('Accept-Encoding', 'gzip, deflate, br', 'Default header');
  notes.push('Pre-request scripts, cookies, and the HTTP transport may add or change headers when sent. Console retains the actual request.');
  return { headers, notes };
}
