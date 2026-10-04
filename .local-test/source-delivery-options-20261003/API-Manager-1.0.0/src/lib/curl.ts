import type { ApiRequest, KeyValue } from '../types';
import { newRequest, row } from './model';
import { createVariableResolver } from './variables';

function unquoteSoapAction(value: string): string {
  const trimmed = value.trim();
  const quoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return (quoted ? trimmed.slice(1, -1) : trimmed).replace(/\\([\\"'])/g, '$1');
}

/** SOAP headers carry the configuration in interoperable Postman and cURL exports. */
export function soapHeaders(request: ApiRequest): KeyValue[] {
  if (!request.soap) return request.headers;
  const { version, action } = request.soap;
  if (/[\r\n\0]/.test(action)) throw new Error('SOAP action cannot contain line breaks or null characters.');
  const quotedAction = `"${action.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const headers = request.headers.filter(header => !header.enabled || !['content-type', 'soapaction'].includes(header.key.toLowerCase().trim()));
  headers.push(row('Content-Type', version === '1.2' ? `application/soap+xml; charset=utf-8${action ? `; action=${quotedAction}` : ''}` : 'text/xml; charset=utf-8'));
  if (version === '1.1') headers.push(row('SOAPAction', quotedAction));
  return headers;
}

export function detectSoap(request: ApiRequest): ApiRequest {
  if (request.body.mode !== 'raw') return request;
  const contentType = request.headers.find(header => header.enabled && header.key.toLowerCase().trim() === 'content-type')?.value ?? '';
  const soapAction = request.headers.find(header => header.enabled && header.key.toLowerCase().trim() === 'soapaction');
  if (/^\s*application\/soap\+xml(?:\s*;|\s*$)/i.test(contentType)) {
    const match = contentType.match(/(?:^|;)\s*action\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^;\s]*)/i);
    return { ...request, soap: { version: '1.2', action: match ? unquoteSoapAction(match[1]) : '' }, body: { ...request.body, language: 'xml' } };
  }
  if (/^\s*text\/xml(?:\s*;|\s*$)/i.test(contentType) && soapAction) {
    return { ...request, soap: { version: '1.1', action: unquoteSoapAction(soapAction.value) }, body: { ...request.body, language: 'xml' } };
  }
  return request;
}

/** Parses command text only. It never invokes a shell or reads an imported file path. */
function tokenize(command: string): string[] {
  const text = command.trim().replace(/(?:\\|\^|`)\r?\n/g, ' ');
  const tokens: string[] = [];
  let token = '', quote = '', started = false;
  const push = () => { if (started) tokens.push(token); token = ''; started = false; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote === "'") {
      if (char === "'") quote = '';
      else token += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') { quote = ''; continue; }
      if (char === '\\' && /["\\$`]/.test(text[i + 1] ?? '')) { token += text[++i]; continue; }
      if (char === '`' || (char === '$' && /[({A-Za-z_]/.test(text[i + 1] ?? ''))) throw new Error('Shell expansion is unsupported. Use literal values or {{variables}} in the cURL command.');
      token += char;
      continue;
    }
    if (/\s/.test(char)) { push(); continue; }
    started = true;
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '\\') {
      if (i + 1 >= text.length) throw new Error('The cURL command ends with an incomplete escape.');
      token += text[++i]; continue;
    }
    if (char === '^' && /["^&|<>]/.test(text[i + 1] ?? '')) { token += text[++i]; continue; }
    if (/[;|&<>`]/.test(char) || (char === '$' && /[({A-Za-z_]/.test(text[i + 1] ?? ''))) throw new Error('Shell execution, pipelines, redirection, and expansion are unsupported. Paste one cURL command with quoted values.');
    token += char;
  }
  if (quote) throw new Error('The cURL command contains an unclosed quote.');
  push();
  return tokens;
}

function splitAssignment(value: string, label: string): [string, string] {
  const index = value.indexOf('=');
  if (index < 1) throw new Error(`${label} requires a field in the form name=value.`);
  return [value.slice(0, index), value.slice(index + 1)];
}

export function parseCurl(command: string): ApiRequest {
  const tokens = tokenize(command);
  if (!tokens.length || !/^(?:curl|curl\.exe)$/i.test(tokens[0])) throw new Error('Paste a cURL command beginning with curl or curl.exe.');
  const request = newRequest('Imported cURL request');
  const warnings: string[] = [];
  let explicitMethod = false, useGet = false, json = false;
  let authMode: 'basic' | 'digest' | 'ntlm' | 'awsv4' | undefined, awsScope = '';
  const data: { kind: 'raw' | 'encoded' | 'json'; value: string; field?: KeyValue }[] = [];
  const argument = (index: number, flag: string): string => {
    if (index >= tokens.length) throw new Error(`${flag} requires a value.`);
    return tokens[index];
  };
  for (let i = 1; i < tokens.length; i++) {
    let flag = tokens[i], attached: string | undefined;
    if (flag.startsWith('--') && flag.includes('=')) {
      const equals = flag.indexOf('='); attached = flag.slice(equals + 1); flag = flag.slice(0, equals);
    } else if (/^-[XHduF]/.test(flag) && flag.length > 2) { attached = flag.slice(2); flag = flag.slice(0, 2); }
    const take = () => attached ?? argument(++i, flag);
    switch (flag) {
      case '-X': case '--request': request.method = take().toUpperCase(); explicitMethod = true; break;
      case '--url': {
        if (request.url) throw new Error('Only one request URL can be imported at a time.');
        request.url = take(); break;
      }
      case '-H': case '--header': {
        const header = take(), index = header.indexOf(':');
        if (index < 1) throw new Error('A header must use the form Name: Value.');
        request.headers.push(row(header.slice(0, index).trim(), header.slice(index + 1).trim())); break;
      }
      case '-u': case '--user': {
        const credentials = take(), index = credentials.indexOf(':');
        request.auth = { type: 'basic', username: index < 0 ? credentials : credentials.slice(0, index), password: index < 0 ? '' : credentials.slice(index + 1) }; break;
      }
      case '--basic': authMode = 'basic'; break;
      case '--digest': authMode = 'digest'; break;
      case '--ntlm': authMode = 'ntlm'; break;
      case '--aws-sigv4': authMode = 'awsv4'; awsScope = take(); break;
      case '-G': case '--get': useGet = true; break;
      case '-I': case '--head': request.method = 'HEAD'; explicitMethod = true; break;
      case '-d': case '--data': case '--data-ascii': case '--data-raw': case '--data-binary': {
        const value = take();
        if (value.startsWith('@') && flag !== '--data-raw') {
          if (flag !== '--data-binary') throw new Error('Reading a file with --data strips line breaks in cURL. Use --data-binary @path to import a file body.');
          if (data.length || request.body.mode !== 'none') throw new Error('A binary file body cannot be combined with other body fields.');
          if (value === '@-' || value === '@') throw new Error('Standard input is unsupported. Select a local file instead.');
          request.body = { ...request.body, mode: 'binary', filePath: value.slice(1) };
        } else data.push({ kind: 'raw', value });
        break;
      }
      case '--json': {
        const value = take();
        if (value.startsWith('@')) throw new Error('cURL --json @file is unsupported. Paste the JSON body or use a binary file body.');
        json = true; data.push({ kind: 'json', value }); break;
      }
      case '--data-urlencode': {
        const [key, value] = splitAssignment(take(), '--data-urlencode');
        data.push({ kind: 'encoded', value: `${encodeURIComponent(key)}=${encodeURIComponent(value)}`, field: row(key, value) }); break;
      }
      case '-F': case '--form': case '--form-string': {
        if (data.length || (request.body.mode !== 'none' && request.body.mode !== 'formdata')) throw new Error('Form data cannot be combined with a raw or binary request body.');
        const [key, value] = splitAssignment(take(), flag);
        const field = row(key, value);
        if (flag !== '--form-string' && value.startsWith('@')) {
          const [path, ...modifiers] = value.slice(1).split(';');
          if (!path || path === '-' || path.includes(',')) throw new Error('Use one explicit local file path for each form field. Standard input and file lists are unsupported.');
          field.type = 'file'; field.value = path;
          for (const modifier of modifiers) {
            if (modifier.startsWith('type=')) Object.assign(field, { contentType: modifier.slice(5) });
            else if (modifier.startsWith('filename=')) Object.assign(field, { fileName: modifier.slice(9) });
            else throw new Error(`Unsupported cURL file modifier: ${modifier}. Use ;type= or ;filename=.`);
          }
        } else if (flag !== '--form-string' && (value.startsWith('<') || value.includes(';'))) {
          throw new Error('Advanced form syntax is unsupported. Use --form-string for literal text or --form name=@path for a file.');
        }
        request.body.mode = 'formdata'; request.body.fields.push(field); break;
      }
      case '-s': case '-S': case '-sS': case '-Ss': case '--silent': case '--show-error': case '-i': case '--include': case '--compressed': break;
      case '-L': case '--location': warnings.push('cURL redirect behavior uses API Manager settings; --location is retained as metadata.'); break;
      case '--': {
        if (i + 1 !== tokens.length - 1 || request.url) throw new Error('Only one request URL can be imported at a time.');
        request.url = tokens[++i]; break;
      }
      default: {
        if (flag.startsWith('-')) throw new Error(`Unsupported cURL option ${flag}. Remove it or configure its equivalent in API Manager settings.`);
        if (request.url) throw new Error('Only one request URL can be imported at a time. Quote the URL and other values that contain spaces.');
        request.url = flag;
      }
    }
  }
  if (!request.url) throw new Error('The cURL command does not contain a URL.');
  if (authMode && authMode !== 'basic') {
    const username = request.auth.username ?? '', password = request.auth.password ?? '';
    if (authMode === 'awsv4') {
      const scope = awsScope.split(':');
      if (scope[0] !== 'aws' || scope[1] !== 'amz' || !scope[2] || !scope[3]) throw new Error('Import AWS signing with --aws-sigv4 aws:amz:region:service and --user accessKey:secretKey.');
      const sessionToken = request.headers.find(header => header.key.toLowerCase() === 'x-amz-security-token')?.value;
      request.auth = { type: 'awsv4', fields: { accessKey: username, secretKey: password, region: scope[2], service: scope[3], ...(sessionToken ? { sessionToken } : {}) } };
    } else request.auth = { type: authMode, fields: { username, password } };
  }
  if (!/^[A-Z0-9!#$%&'*+.^_`|~-]{1,32}$/.test(request.method)) throw new Error('The request method must be a valid HTTP token of at most 32 characters.');
  if (data.length && request.body.mode !== 'none') throw new Error('Raw data cannot be combined with a form or binary body.');
  if (useGet && (json || request.body.mode !== 'none')) throw new Error('--get can only be combined with URL-encoded or raw query data.');
  if (useGet) {
    if (!explicitMethod) request.method = 'GET';
    for (const part of data) {
      if (part.field) request.params.push(part.field);
      else for (const [key, value] of new URLSearchParams(part.value)) request.params.push(row(key, value));
    }
  } else if (data.length) {
    if (data.every(part => part.kind === 'encoded')) { request.body.mode = 'urlencoded'; request.body.fields = data.map(part => part.field!); }
    else {
      request.body.mode = 'raw';
      request.body.raw = data.map(part => part.value).join(data.every(part => part.kind === 'json') ? '' : '&');
      request.body.language = json ? 'json' : 'text';
    }
    if (!explicitMethod) request.method = 'POST';
  } else if (request.body.mode !== 'none' && !explicitMethod) request.method = 'POST';
  const ensureHeader = (key: string, value: string) => { if (!request.headers.some(h => h.key.toLowerCase() === key.toLowerCase())) request.headers.push(row(key, value)); };
  if (json) { ensureHeader('Content-Type', 'application/json'); ensureHeader('Accept', 'application/json'); }
  else if ((data.length && !useGet) || request.body.mode === 'binary') ensureHeader('Content-Type', 'application/x-www-form-urlencoded');
  if (warnings.length) request.extra = { curlWarnings: warnings, curlOptions: ['--location'] };
  return detectSoap(request);
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

function addParams(url: string, fields: KeyValue[], resolve: (value: string) => string): string {
  const enabled = fields.filter(field => field.enabled && field.key);
  if (!enabled.length) return url;
  const hashIndex = url.indexOf('#'), fragment = hashIndex < 0 ? '' : url.slice(hashIndex);
  const base = hashIndex < 0 ? url : url.slice(0, hashIndex), queryIndex = base.indexOf('?');
  const query = new URLSearchParams(queryIndex < 0 ? '' : base.slice(queryIndex + 1));
  for (const key of new Set(enabled.map(field => resolve(field.key)))) query.delete(key);
  for (const field of enabled) query.append(resolve(field.key), resolve(field.value));
  return `${queryIndex < 0 ? base : base.slice(0, queryIndex)}?${query.toString()}${fragment}`;
}

/** Produces a POSIX cURL command; supplied variables are resolved before export. */
export function exportCurl(request: ApiRequest, variables?: KeyValue[]): string {
  const resolve = variables ? createVariableResolver(variables) : (value: string) => value;
  let url = addParams(resolve(request.url), request.params, resolve);
  const parts = ['curl', request.method === 'HEAD' ? '--head' : `--request ${shellQuote(request.method)}`];
  const exportedRequest = request.soap ? { ...request, soap: { ...request.soap, action: resolve(request.soap.action) } } : request;
  let headers = soapHeaders(exportedRequest).filter(h => h.enabled && h.key.trim()).map(h => ({ key: resolve(h.key).trim(), value: resolve(h.value) }));
  const auth = request.auth;
  if (auth.type === 'basic') { headers = headers.filter(h => h.key.toLowerCase() !== 'authorization'); parts.push(`--user ${shellQuote(`${resolve(auth.username ?? '')}:${resolve(auth.password ?? '')}`)}`); }
  if (auth.type === 'bearer') {
    headers = headers.filter(h => h.key.toLowerCase() !== 'authorization');
    headers.push({ key: 'Authorization', value: `Bearer ${resolve(auth.token ?? '')}` });
  }
  if (auth.type === 'apikey' && auth.key) {
    const key = resolve(auth.key), value = resolve(auth.value ?? '');
    if (auth.in === 'query') url = addParams(url, [row(key, value)], v => v);
    else { headers = headers.filter(h => h.key.toLowerCase() !== key.toLowerCase()); headers.push({ key, value }); }
  }
  const fields = new Proxy(auth.fields ?? {}, { get: (target, key: string) => target[key] === undefined ? undefined : resolve(target[key]) });
  if (auth.type === 'digest' || auth.type === 'ntlm') {
    headers = headers.filter(header => header.key.toLowerCase() !== 'authorization');
    parts.push(`--${auth.type}`, `--user ${shellQuote(`${fields.username ?? resolve(auth.username ?? '')}:${fields.password ?? resolve(auth.password ?? '')}`)}`);
  } else if (auth.type === 'oauth2') {
    const token = fields.accessToken ?? fields.accesstoken ?? resolve(auth.token ?? '');
    if (!token) throw new Error('Enter an OAuth 2 access token before exporting cURL.');
    if (fields.addTokenTo === 'query' || fields.addTokenTo === 'queryParams') url = addParams(url, [row(fields.queryParamKey || 'access_token', token)], value => value);
    else { headers = headers.filter(header => header.key.toLowerCase() !== 'authorization'); headers.push({ key: 'Authorization', value: `${fields.headerPrefix || fields.tokenType || 'Bearer'} ${token}` }); }
  } else if (auth.type === 'awsv4') {
    if (fields.signQuery === 'true' || fields.addAuthDataToQuery === 'true') throw new Error('cURL AWS signing uses header authentication. Export the collection to retain signed query configuration.');
    if (!fields.service || !(fields.accessKey || fields.accessKeyId) || !(fields.secretKey || fields.secretAccessKey)) throw new Error('Configure the AWS service, access key, and secret key before exporting cURL.');
    headers = headers.filter(header => !['authorization', 'x-amz-security-token'].includes(header.key.toLowerCase()));
    parts.push(`--aws-sigv4 ${shellQuote(`aws:amz:${fields.region || 'us-east-1'}:${fields.service}`)}`, `--user ${shellQuote(`${fields.accessKey || fields.accessKeyId}:${fields.secretKey || fields.secretAccessKey}`)}`);
    if (fields.sessionToken) headers.push({ key: 'X-Amz-Security-Token', value: fields.sessionToken });
  } else if (['oauth1', 'hawk', 'edgegrid', 'jwt', 'asap'].includes(auth.type)) {
    throw new Error(`cURL export cannot regenerate ${auth.type} signatures. Export the Postman collection to preserve this authentication configuration.`);
  }
  parts.push(`--url ${shellQuote(url)}`);
  const ensureHeader = (key: string, value: string) => { if (!headers.some(h => h.key.toLowerCase() === key.toLowerCase())) headers.push({ key, value }); };
  if (request.body.mode === 'raw') {
    ensureHeader('Content-Type', ({ json: 'application/json', text: 'text/plain', xml: 'application/xml', html: 'text/html', javascript: 'application/javascript' } as const)[request.body.language]);
    parts.push(`--data-raw ${shellQuote(resolve(request.body.raw))}`);
  }
  if (request.body.mode === 'urlencoded') {
    ensureHeader('Content-Type', 'application/x-www-form-urlencoded');
    for (const field of request.body.fields.filter(f => f.enabled && f.key)) parts.push(`--data-urlencode ${shellQuote(`${resolve(field.key)}=${resolve(field.value)}`)}`);
  }
  if (request.body.mode === 'formdata') {
    headers = headers.filter(h => !['content-type', 'content-length'].includes(h.key.toLowerCase()));
    for (const field of request.body.fields.filter(f => f.enabled && f.key)) {
      if (field.type === 'file') {
        const metadata = field as KeyValue & { contentType?: string; fileName?: string };
        const modifiers = `${metadata.contentType ? `;type=${resolve(metadata.contentType)}` : ''}${metadata.fileName ? `;filename=${resolve(metadata.fileName)}` : ''}`;
        parts.push(`--form ${shellQuote(`${resolve(field.key)}=@${resolve(field.value)}${modifiers}`)}`);
      } else parts.push(`--form-string ${shellQuote(`${resolve(field.key)}=${resolve(field.value)}`)}`);
    }
  }
  if (request.body.mode === 'binary') {
    if (!request.body.filePath) throw new Error('Choose a file before exporting a binary request.');
    ensureHeader('Content-Type', 'application/octet-stream');
    parts.push(`--data-binary ${shellQuote(`@${resolve(request.body.filePath)}`)}`);
  }
  for (const header of headers) parts.push(`--header ${shellQuote(`${header.key}: ${header.value}`)}`);
  return parts.join(' \\\n  ');
}
