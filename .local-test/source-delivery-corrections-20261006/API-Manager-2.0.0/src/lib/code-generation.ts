import type { ApiRequest, KeyValue } from '../types';
import { exportCurl, soapHeaders } from './curl';
import { createVariableResolver } from './variables';
import { effectiveUrlWithParams } from './query-params';

export type RequestCodeLanguage = 'curl' | 'python' | 'java' | 'javascript' | 'c' | 'cpp';
export const REQUEST_CODE_LANGUAGES: readonly { id: RequestCodeLanguage; label: string; fileName: string; syntax: string }[] = [
  { id: 'curl', label: 'cURL', fileName: 'request.sh', syntax: 'shell' },
  { id: 'python', label: 'Python', fileName: 'request.py', syntax: 'python' },
  { id: 'java', label: 'Java', fileName: 'ApiRequestExample.java', syntax: 'java' },
  { id: 'javascript', label: 'JavaScript', fileName: 'request.mjs', syntax: 'javascript' },
  { id: 'c', label: 'C', fileName: 'request.c', syntax: 'c' },
  { id: 'cpp', label: 'C++', fileName: 'request.cpp', syntax: 'cpp' },
];
export interface GeneratedRequestCode { code: string; language: RequestCodeLanguage; label: string; fileName: string; syntax: string; dependencies: string[]; warnings: string[]; }
type Pair = { key: string; value: string };
type Field = Pair & { type: 'text' | 'file'; fileName: string; contentType: string };
interface Prepared { method: string; url: string; headers: Pair[]; mode: ApiRequest['body']['mode']; raw: string; fields: Field[]; filePath: string; warnings: string[]; blocked?: string; challenge?: { type: 'digest' | 'ntlm'; username: string; password: string }; }
const quote = (value: string) => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const javaLiteral = (value: string) => '"' + [...value].map(char => {
  const common: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
  return common[char] ?? (char.charCodeAt(0) < 32 ? '\\' + char.charCodeAt(0).toString(8).padStart(3, '0') : char);
}).join('') + '"';
const javaQuote = (value: string) => {
  if (value.length <= 8000) return javaLiteral(value);
  const chunks: string[] = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 8000, value.length);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
    chunks.push(javaLiteral(value.slice(start, end))); start = end;
  }
  // Runtime join prevents javac folding a long body into one constant-pool entry.
  return `String.join("", ${chunks.join(', ')})`;
};
const cQuote = (value: string) => '"' + [...new TextEncoder().encode(value)].map(byte => {
  if (byte === 34) return '\\"'; if (byte === 92) return '\\\\'; if (byte === 63) return '\\?';
  if (byte === 10) return '\\n'; if (byte === 13) return '\\r'; if (byte === 9) return '\\t';
  return byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '\\' + byte.toString(8).padStart(3, '0');
}).join('') + '"';
const utf8Base64 = (value: string) => btoa([...new TextEncoder().encode(value)].map(byte => String.fromCharCode(byte)).join(''));
const baseName = (value: string) => value.split(/[\\/]/).at(-1) || 'upload.bin';
const disposition = (value: string) => value.replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22');
const defaults: Record<ApiRequest['body']['language'], string> = { json: 'application/json', text: 'text/plain', xml: 'application/xml', html: 'text/html', javascript: 'application/javascript' };
function validHeader(key: string, value: string) {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n\0]/.test(value)) throw new Error(`Invalid HTTP header: ${key || '(empty name)'}.`);
}
function prepare(request: ApiRequest, language: RequestCodeLanguage, variables: KeyValue[]): Prepared {
  const resolve = createVariableResolver(variables);
  const method = request.method.toUpperCase();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(method)) throw new Error('Enter a valid HTTP method before generating code.');
  let url: URL;
  try { url = new URL(resolve(effectiveUrlWithParams(request.url.trim(), request.params))); } catch (error) { if (error instanceof Error && /variable/i.test(error.message)) throw error; throw new Error('Enter a complete HTTP or HTTPS URL before generating code.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Code generation supports HTTP and HTTPS URLs.');
  url.hash = '';
  const params = request.params.filter(item => item.key).map(item => {
    if (item.enabled) return { key: resolve(item.key), value: resolve(item.value), enabled: true };
    let key = item.key;
    try { key = resolve(key); } catch { /* Disabled drafts may reference unavailable variables. */ }
    return { key, value: '', enabled: false };
  });
  for (const key of new Set(params.map(item => item.key))) url.searchParams.delete(key);
  for (const item of params) if (item.enabled) url.searchParams.append(item.key, item.value);
  const soap = request.soap ? { ...request, soap: { ...request.soap, action: resolve(request.soap.action) } } : request;
  let headers = soapHeaders(soap).filter(item => item.enabled && item.key.trim()).map(item => ({ key: resolve(item.key).trim(), value: resolve(item.value) }));
  const warnings = ['Snippets do not execute scripts or copy the application cookie jar/workspace transport settings. Review client timeout, redirect, and TLS defaults.'];
  const setHeader = (key: string, value: string) => { headers = [...headers.filter(item => item.key.toLowerCase() !== key.toLowerCase()), { key, value }]; };
  const ensureHeader = (key: string, value: string) => { if (!headers.find(item => item.key.toLowerCase() === key.toLowerCase())?.value) setHeader(key, value); };
  const auth = request.auth;
  const field = (...keys: string[]) => { for (const key of keys) if (auth.fields?.[key] !== undefined) return resolve(auth.fields[key]); return undefined; };
  let blocked: string | undefined, challenge: Prepared['challenge'];
  if (auth.type === 'basic') setHeader('Authorization', `Basic ${utf8Base64(`${resolve(auth.username || '')}:${resolve(auth.password || '')}`)}`);
  else if (auth.type === 'bearer') setHeader('Authorization', `Bearer ${resolve(auth.token || '')}`);
  else if (auth.type === 'apikey') {
    const key = resolve(auth.key || ''); if (!key) throw new Error('Enter the API key name before generating code.');
    const value = resolve(auth.value || ''); if (auth.in === 'query') url.searchParams.set(key, value); else setHeader(key, value);
  } else if (auth.type === 'oauth2') {
    const token = field('accessToken', 'accesstoken', 'token') ?? resolve(auth.token || '');
    if (!token) throw new Error('Enter an OAuth 2 access token before generating code.');
    if (['query', 'queryParams'].includes(field('addTokenTo') || '')) url.searchParams.set(field('queryParamKey', 'queryParamName') || 'access_token', token);
    else setHeader('Authorization', `${field('headerPrefix') || field('tokenType') || 'Bearer'} ${token}`);
    warnings.push('The current OAuth 2 access token is included. Token acquisition/refresh is not generated.');
  } else if (['digest', 'ntlm'].includes(auth.type) && ['c', 'cpp'].includes(language)) {
    headers = headers.filter(item => item.key.toLowerCase() !== 'authorization');
    const domain = auth.type === 'ntlm' ? field('domain') : '';
    challenge = { type: auth.type as 'digest' | 'ntlm', username: `${domain ? domain + '\\' : ''}${field('username') ?? resolve(auth.username || '')}`, password: field('password') ?? resolve(auth.password || '') };
    warnings.push(`libcurl negotiates ${auth.type} challenge authentication; its build must support this scheme. Application-specific challenge options are not copied.`);
  } else if (auth.type !== 'none') {
    blocked = auth.type === 'inherit' ? 'Resolve inherited authorization before running this snippet.' : `${auth.type} authentication is not generated for this client. Add the required signing/challenge implementation before sending.`;
    headers = headers.filter(item => item.key.toLowerCase() !== 'authorization');
    warnings.push(blocked);
  }
  if (url.username || url.password) {
    if (!headers.find(item => item.key.toLowerCase() === 'authorization')?.value) setHeader('Authorization', `Basic ${utf8Base64(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`)}`);
    url.username = ''; url.password = '';
  }
  const fields = (['formdata', 'urlencoded'].includes(request.body.mode) ? request.body.fields : []).filter(item => item.enabled && item.key).map(item => {
    const value = resolve(item.value), key = resolve(item.key);
    const type = request.body.mode === 'formdata' && item.type === 'file' ? 'file' as const : 'text' as const;
    const fileName = type === 'file' ? (item.fileName ? resolve(item.fileName) : baseName(value)) : '';
    const contentType = type === 'file' ? (item.contentType ? resolve(item.contentType) : 'application/octet-stream') : '';
    if (request.body.mode === 'formdata' && (/\0/.test(key) || /[\r\n\0]/.test(fileName + contentType))) throw new Error('Multipart field names, file names, and content types must not contain invalid control characters.');
    if (request.body.mode === 'formdata' && type === 'file' && !value) throw new Error('Choose a file for every enabled upload field before generating code.');
    return { key, value: request.body.mode === 'formdata' && type === 'text' ? value.replace(/\r\n|\r|\n/g, '\r\n') : value, type, fileName, contentType };
  });
  let raw = request.body.mode === 'raw' ? resolve(request.body.raw) : '';
  if (request.body.mode === 'raw') ensureHeader('Content-Type', defaults[request.body.language]);
  if (request.body.mode === 'urlencoded') { raw = new URLSearchParams(fields.map(item => [item.key, item.value])).toString(); ensureHeader('Content-Type', 'application/x-www-form-urlencoded'); }
  if (request.body.mode === 'binary') ensureHeader('Content-Type', 'application/octet-stream');
  if (request.body.mode === 'formdata') headers = headers.filter(item => !['content-type', 'content-length'].includes(item.key.toLowerCase()));
  const filePath = request.body.mode === 'binary' ? resolve(request.body.filePath || '') : '';
  if (request.body.mode === 'binary' && !filePath) throw new Error('Choose a binary file before generating code.');
  headers.forEach(item => validHeader(item.key, item.value));
  if (headers.some(item => ['content-length', 'transfer-encoding'].includes(item.key.toLowerCase()))) {
    headers = headers.filter(item => !['content-length', 'transfer-encoding'].includes(item.key.toLowerCase()));
    warnings.push('Content-Length and Transfer-Encoding are calculated by the generated client rather than copied manually.');
  }
  if (language === 'java') {
    const restricted = new Set(['host', 'connection', 'expect', 'upgrade', 'http2-settings']);
    const omitted = headers.filter(item => restricted.has(item.key.toLowerCase()));
    if (omitted.length) { headers = headers.filter(item => !restricted.has(item.key.toLowerCase())); warnings.push(`Java HttpClient manages restricted headers: ${omitted.map(item => item.key).join(', ')}. They are omitted from this snippet.`); }
  }
  if (language === 'javascript' && new Set(headers.map(item => item.key.toLowerCase())).size < headers.length) warnings.push('Fetch combines repeated header names into one header value; use Python or libcurl if separate header lines are required.');
  if (language === 'javascript' && ['GET', 'HEAD'].includes(method) && request.body.mode !== 'none') { blocked = 'Fetch does not allow a body with GET or HEAD. Choose another client or change the request method.'; warnings.push(blocked); }
  if (['c', 'cpp'].includes(language) && method === 'HEAD' && request.body.mode !== 'none') { blocked = 'This libcurl HEAD example does not send a request body. Choose Python/Java or remove the body.'; warnings.push(blocked); }
  if (fields.some(item => item.type === 'file') && request.body.mode === 'formdata' || request.body.mode === 'binary') warnings.push('Upload paths refer to local files. Adjust paths on another machine; the Python/Java/JavaScript examples buffer file data in memory.');
  if (request.scripts?.preRequest || request.scripts?.postResponse) warnings.push('This request contains scripts. Script-created variables/request changes must be applied manually before generating code.');
  if (/\{\{\s*\$/.test(JSON.stringify(request))) warnings.push('Dynamic values are sampled once when code is generated. Generate again for fresh values.');
  headers.forEach(item => validHeader(item.key, item.value));
  return { method, url: url.href, headers, mode: request.body.mode, raw, fields, filePath, warnings, blocked, challenge };
}
const noteLines = (prefix: string, warnings: string[]) => warnings.map(value => `${prefix} NOTE: ${value}`).join('\n');
function python(p: Prepared): string {
  let body = 'body = None';
  if (['raw', 'urlencoded'].includes(p.mode)) body = `body = ${quote(p.raw)}.encode("utf-8")`;
  if (p.mode === 'binary') body = `body = Path(${quote(p.filePath)}).read_bytes()`;
  if (p.mode === 'formdata') {
    const parts = p.fields.map(item => {
      const description = `Content-Disposition: form-data; name="${disposition(item.key)}"${item.type === 'file' ? `; filename="${disposition(item.fileName)}"` : ''}\r\n${item.type === 'file' ? `Content-Type: ${item.contentType}\r\n` : ''}\r\n`;
      return `parts.append(("--" + boundary + "\\r\\n" + ${quote(description)}).encode("utf-8"))\nparts.append(${item.type === 'file' ? `Path(${quote(item.value)}).read_bytes()` : `${quote(item.value)}.encode("utf-8")`})\nparts.append(b"\\r\\n")`;
    }).join('\n');
    body = `boundary = "api-manager-" + secrets.token_hex(16)\nparts = []\n${parts}\nparts.append(("--" + boundary + "--\\r\\n").encode("ascii"))\nbody = b"".join(parts)\nheaders.append(("Content-Type", "multipart/form-data; boundary=" + boundary))`;
  }
  return `# Python 3.10+; standard library only. Save as request.py; run: python request.py\n# HTTPS certificates are verified. Timeout: 30 seconds. Redirects are not followed.\n${noteLines('#', p.warnings)}\nimport http.client\nimport secrets\nimport sys\nfrom pathlib import Path\nfrom urllib.parse import urlsplit\n\n${p.blocked ? `raise RuntimeError(${quote(p.blocked)})\n\n` : ''}url = urlsplit(${quote(p.url)})\nheaders = [\n${p.headers.map(item => `    (${quote(item.key)}, ${quote(item.value)}),`).join('\n')}\n]\n${body}\nif body is not None:\n    headers.append(("Content-Length", str(len(body))))\nelif ${quote(p.method)} in ("POST", "PUT", "PATCH"):\n    headers.append(("Content-Length", "0"))\nconnection_type = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection\nconnection = connection_type(url.hostname, url.port, timeout=30)\ntry:\n    target = (url.path or "/") + ("?" + url.query if url.query else "")\n    connection.putrequest(${quote(p.method)}, target, skip_host=any(key.lower() == "host" for key, _ in headers), skip_accept_encoding=True)\n    for key, value in headers:\n        connection.putheader(key, value.encode("utf-8"))\n    connection.endheaders(body)\n    response = connection.getresponse()\n    print(response.status, response.reason, file=sys.stderr)\n    sys.stdout.buffer.write(response.read())\nfinally:\n    connection.close()\n`;
}
function javascript(p: Prepared): string {
  let body = 'let body;';
  if (['raw', 'urlencoded'].includes(p.mode)) body = `const body = ${quote(p.raw)};`;
  if (p.mode === 'binary') body = `const body = await readFile(${quote(p.filePath)});`;
  if (p.mode === 'formdata') body = `const body = new FormData();\n${p.fields.map(item => item.type === 'file' ? `body.append(${quote(item.key)}, new Blob([await readFile(${quote(item.value)})], { type: ${quote(item.contentType)} }), ${quote(item.fileName)});` : `body.append(${quote(item.key)}, ${quote(item.value)});`).join('\n')}`;
  return `// Node.js 22+; no npm packages. Save as request.mjs; run: node request.mjs\n// fetch is the native Node API; browsers need different file selection and may enforce CORS.\n${noteLines('//', p.warnings)}\nimport { readFile } from 'node:fs/promises';\n\n${p.blocked ? `throw new Error(${quote(p.blocked)});\n\n` : ''}const headers = new Headers();\n${p.headers.map(item => `headers.append(${quote(item.key)}, ${quote(item.value)});`).join('\n')}\n${body}\nconst response = await fetch(${quote(p.url)}, {\n  method: ${quote(p.method)}, headers, body,\n  redirect: 'manual', signal: AbortSignal.timeout(30_000),\n});\nconsole.error(response.status, response.statusText);\nprocess.stdout.write(await response.text());\n`;
}
function java(p: Prepared): string {
  let body = 'byte[] body = new byte[0];';
  if (['raw', 'urlencoded'].includes(p.mode)) body = `byte[] body = ${javaQuote(p.raw)}.getBytes(StandardCharsets.UTF_8);`;
  if (p.mode === 'binary') body = `byte[] body = Files.readAllBytes(Path.of(${javaQuote(p.filePath)}));`;
  if (p.mode === 'formdata') body = `String boundary = "api-manager-" + UUID.randomUUID().toString().replace("-", "");\n        ByteArrayOutputStream parts = new ByteArrayOutputStream();\n${p.fields.map(item => {
    const description = `Content-Disposition: form-data; name="${disposition(item.key)}"${item.type === 'file' ? `; filename="${disposition(item.fileName)}"` : ''}\r\n${item.type === 'file' ? `Content-Type: ${item.contentType}\r\n` : ''}\r\n`;
    return `        parts.write(("--" + boundary + "\\r\\n" + ${javaQuote(description)}).getBytes(StandardCharsets.UTF_8));\n        parts.write(${item.type === 'file' ? `Files.readAllBytes(Path.of(${javaQuote(item.value)}))` : `${javaQuote(item.value)}.getBytes(StandardCharsets.UTF_8)`});\n        parts.write("\\r\\n".getBytes(StandardCharsets.US_ASCII));`;
  }).join('\n')}\n        parts.write(("--" + boundary + "--\\r\\n").getBytes(StandardCharsets.US_ASCII));\n        byte[] body = parts.toByteArray();\n        builder.header("Content-Type", "multipart/form-data; boundary=" + boundary);`;
  return `// Java 11+ JDK; no external libraries. Save as ApiRequestExample.java\n// Run: javac -encoding UTF-8 ApiRequestExample.java && java ApiRequestExample\n${noteLines('//', p.warnings)}\nimport java.io.ByteArrayOutputStream;\nimport java.net.URI;\nimport java.net.http.HttpClient;\nimport java.net.http.HttpRequest;\nimport java.net.http.HttpResponse;\nimport java.nio.charset.StandardCharsets;\nimport java.nio.file.Files;\nimport java.nio.file.Path;\nimport java.time.Duration;\nimport java.util.UUID;\n\npublic class ApiRequestExample {\n    public static void main(String[] args) throws Exception {\n${p.blocked ? `        if (args != null) throw new IllegalStateException(${javaQuote(p.blocked)});\n` : ''}        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30))\n                .followRedirects(HttpClient.Redirect.NEVER).build();\n        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(${javaQuote(p.url)}))\n                .timeout(Duration.ofSeconds(30));\n${p.headers.map(item => `        builder.header(${javaQuote(item.key)}, ${javaQuote(item.value)});`).join('\n')}\n        ${body}\n        HttpRequest request = builder.method(${javaQuote(p.method)}, ${p.mode === 'none' ? 'HttpRequest.BodyPublishers.noBody()' : 'HttpRequest.BodyPublishers.ofByteArray(body)'}).build();\n        HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());\n        System.err.println(response.statusCode());\n        System.out.write(response.body());\n    }\n}\n`;
}
function nativeCurl(p: Prepared, cpp: boolean): string {
  const rawBody = ['raw', 'urlencoded'].includes(p.mode) ? `    static const unsigned char body[] = ${cQuote(p.raw)};\n` : '';
  const body = ['raw', 'urlencoded'].includes(p.mode) ? '    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body);\n    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE, (curl_off_t)(sizeof(body) - 1));' : p.mode === 'binary' ? `    binary = read_file(${cQuote(p.filePath)}, &binary_size);\n    if (!binary) goto cleanup;\n    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, binary);\n    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE, binary_size);` : p.mode === 'formdata' ? `    mime = curl_mime_init(curl);\n    if (!mime) goto cleanup;\n${p.fields.map(item => `    {\n        curl_mimepart *part = curl_mime_addpart(mime);\n        if (!part) goto cleanup;\n        if (curl_mime_name(part, ${cQuote(item.key)}) != CURLE_OK) goto cleanup;\n${item.type === 'file' ? `        if (curl_mime_filedata(part, ${cQuote(item.value)}) != CURLE_OK) goto cleanup;\n        if (curl_mime_filename(part, ${cQuote(item.fileName)}) != CURLE_OK) goto cleanup;\n        if (curl_mime_type(part, ${cQuote(item.contentType)}) != CURLE_OK) goto cleanup;` : `        static const char value[] = ${cQuote(item.value)};\n        if (curl_mime_data(part, value, sizeof(value) - 1) != CURLE_OK) goto cleanup;`}\n    }`).join('\n')}\n    curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime);` : '';
  const fileReader = p.mode === 'binary' ? `\nstatic unsigned char *read_file(const char *path, curl_off_t *size) {\n    FILE *file = fopen(path, "rb");\n    long length;\n    unsigned char *data;\n    if (!file) { perror(path); return NULL; }\n    if (fseek(file, 0, SEEK_END) != 0 || (length = ftell(file)) < 0 || fseek(file, 0, SEEK_SET) != 0) { fclose(file); return NULL; }\n    data = (unsigned char *)malloc((size_t)length + 1);\n    if (!data) { fclose(file); return NULL; }\n    if (fread(data, 1, (size_t)length, file) != (size_t)length) { free(data); fclose(file); return NULL; }\n    fclose(file); *size = (curl_off_t)length; return data;\n}\n` : '';
  return `// ${cpp ? 'C++17' : 'C99'} compiler and libcurl 7.56+ development files. No shell execution by the program.\n// Save as request.${cpp ? 'cpp' : 'c'}; compile (Unix example): ${cpp ? 'c++ -std=c++17 request.cpp' : 'cc -std=c99 request.c'} -o request $(pkg-config --cflags --libs libcurl)\n// Run: ./request (Windows: request.exe); HTTPS verification stays enabled.\n${noteLines('//', p.warnings)}\n#include <stdio.h>\n#include <stdlib.h>\n#include <curl/curl.h>\n${fileReader}\nint main(void) {\n    CURL *curl = NULL;\n    struct curl_slist *headers = NULL;\n    curl_mime *mime = NULL;\n    unsigned char *binary = NULL;\n    curl_off_t binary_size = 0;\n    long status = 0;\n    CURLcode result;\n    int exit_code = 1;\n${rawBody}${p.blocked ? `    fprintf(stderr, "%s\\n", ${cQuote(p.blocked)});\n    return 1;\n` : ''}    if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) return 1;\n    curl = curl_easy_init();\n    if (!curl) goto cleanup;\n    curl_easy_setopt(curl, CURLOPT_URL, ${cQuote(p.url)});\n    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);\n    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);\n${p.headers.map(item => `    {\n        struct curl_slist *next = curl_slist_append(headers, ${cQuote(item.value ? `${item.key}: ${item.value}` : `${item.key};`)});\n        if (!next) goto cleanup;\n        headers = next;\n    }`).join('\n')}\n    if (headers) curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);\n${body}\n${p.challenge ? `    curl_easy_setopt(curl, CURLOPT_HTTPAUTH, ${p.challenge.type === 'digest' ? 'CURLAUTH_DIGEST' : 'CURLAUTH_NTLM'});\n    curl_easy_setopt(curl, CURLOPT_USERNAME, ${cQuote(p.challenge.username)});\n    curl_easy_setopt(curl, CURLOPT_PASSWORD, ${cQuote(p.challenge.password)});\n` : ''}${p.method === 'HEAD' ? '    curl_easy_setopt(curl, CURLOPT_NOBODY, 1L);\n' : ''}    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, ${cQuote(p.method)});\n    result = curl_easy_perform(curl);\n    if (result != CURLE_OK) fprintf(stderr, "Request failed: %s\\n", curl_easy_strerror(result));\n    else { curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status); fprintf(stderr, "HTTP %ld\\n", status); exit_code = 0; }\ncleanup:\n    curl_mime_free(mime);\n    curl_slist_free_all(headers);\n    curl_easy_cleanup(curl);\n    free(binary);\n    curl_global_cleanup();\n    return exit_code;\n}\n`;
}

/** Generates data only: it never runs scripts, sends a request, or reads uploads. */
export function generateRequestCode(request: ApiRequest, language: RequestCodeLanguage, variables: KeyValue[] = []): GeneratedRequestCode {
  const config = REQUEST_CODE_LANGUAGES.find(item => item.id === language);
  if (!config) throw new Error('Choose a supported code language.');
  if (language === 'curl') return { ...config, language, code: exportCurl(request, variables), dependencies: ['cURL 8+; run in a POSIX-compatible shell (for example Git Bash on Windows).'], warnings: ['cURL does not run request scripts or include the application cookie jar/workspace transport settings.'] };
  const p = prepare(request, language, variables);
  const dependencies: Record<Exclude<RequestCodeLanguage, 'curl'>, string[]> = { python: ['Python 3.10+; standard library only. Run: python request.py'], java: ['Java 11+ JDK; no external libraries. Run: javac -encoding UTF-8 ApiRequestExample.java, then java ApiRequestExample'], javascript: ['Node.js 22+; no npm packages. Run: node request.mjs'], c: ['C99 compiler and libcurl 7.56+ headers/library. Build command is in the snippet.'], cpp: ['C++17 compiler and libcurl 7.56+ headers/library. Build command is in the snippet.'] };
  const code = language === 'python' ? python(p) : language === 'javascript' ? javascript(p) : language === 'java' ? java(p) : nativeCurl(p, language === 'cpp');
  return { ...config, language, code, dependencies: dependencies[language], warnings: p.warnings };
}
