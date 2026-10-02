import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import type { ApiRequest, RequestAuth, Workspace } from '../types';
import { bridge } from '../lib/bridge';
import { requestVariables } from '../lib/variables';
import './AuthEditor.css';

interface Props { value: RequestAuth; onChange: (auth: RequestAuth) => void; inherited?: string; allowInherit?: boolean; workspace?: Workspace; request?: ApiRequest; notify?: (message: string, error?: boolean) => void; }
const types: [RequestAuth['type'], string][] = [['none', 'No Auth'], ['bearer', 'Bearer Token'], ['basic', 'Basic Auth'], ['apikey', 'API Key'], ['digest', 'Digest Auth'], ['oauth1', 'OAuth 1.0'], ['oauth2', 'OAuth 2.0'], ['hawk', 'Hawk Authentication'], ['awsv4', 'AWS Signature'], ['ntlm', 'NTLM Authentication'], ['edgegrid', 'Akamai EdgeGrid'], ['jwt', 'JWT Bearer'], ['asap', 'ASAP']];
type Field = [string, string, boolean?, string?];
const specifications: Partial<Record<RequestAuth['type'], Field[]>> = {
  digest: [['Username', 'username'], ['Password', 'password', true], ['Realm (optional)', 'realm'], ['Nonce (optional)', 'nonce'], ['Quality of protection (optional)', 'qop'], ['Opaque (optional)', 'opaque'], ['Client nonce (optional)', 'cnonce']],
  oauth1: [['Consumer key', 'consumerKey'], ['Consumer secret', 'consumerSecret', true], ['Access token', 'token', true], ['Token secret', 'tokenSecret', true], ['Private key (RSA)', 'privateKey', true, 'textarea'], ['Realm (optional)', 'realm'], ['Nonce (optional)', 'nonce'], ['Timestamp (optional)', 'timestamp'], ['Callback URL (optional)', 'callback'], ['Verifier (optional)', 'verifier']],
  oauth2: [['Access token', 'accessToken', true], ['Header prefix', 'headerPrefix'], ['Token URL', 'tokenUrl'], ['Client ID', 'clientId'], ['Client secret', 'clientSecret', true], ['Scope (optional)', 'scope']],
  hawk: [['Auth ID', 'authId'], ['Auth key', 'key', true], ['Extension (optional)', 'ext'], ['Nonce (optional)', 'nonce'], ['Timestamp (optional)', 'timestamp'], ['App (optional)', 'app'], ['Delegation (optional)', 'dlg']],
  awsv4: [['Access key', 'accessKey'], ['Secret key', 'secretKey', true], ['AWS region', 'region'], ['Service name', 'service'], ['Session token (optional)', 'sessionToken', true], ['Signing date (optional)', 'amzDate']],
  ntlm: [['Username', 'username'], ['Password', 'password', true], ['Domain', 'domain'], ['Workstation', 'workstation']],
  edgegrid: [['Client token', 'clientToken', true], ['Access token', 'accessToken', true], ['Client secret', 'clientSecret', true], ['Nonce (optional)', 'nonce'], ['Timestamp (optional)', 'timestamp'], ['Headers to sign (optional)', 'headersToSign']],
  jwt: [['JWT payload', 'payload', false, 'textarea'], ['JWT header (optional)', 'header', false, 'textarea']],
  asap: [['Private key', 'privateKey', true, 'textarea'], ['Key ID', 'keyId'], ['Issuer', 'issuer'], ['Audience', 'audience'], ['Subject (optional)', 'subject'], ['Token lifetime (seconds)', 'expiry'], ['Issued at (optional)', 'issuedAt'], ['JWT ID (optional)', 'jwtId'], ['Key passphrase (optional)', 'passphrase', true]],
};
const hints: Partial<Record<RequestAuth['type'], string>> = {
  digest: 'The server challenge fills missing Digest fields. Retries are bounded.',
  oauth1: 'Signs this request locally. RSA methods use a PEM private key.',
  oauth2: 'Use an existing token or acquire one explicitly. Authorization codes and PKCE verifiers are supplied manually; tokens are not refreshed automatically.',
  awsv4: 'Signs for the chosen AWS service and region. Multipart body signing is unavailable when exact bytes are not known.',
  ntlm: 'NTLMv2 handshake reuses one connection. Legacy NTLMv1 and mandatory MIC/channel binding are unavailable.',
  edgegrid: 'Timestamp format: YYYYMMDDTHH:mm:ss+0000. Headers to sign: JSON array or comma-separated names.',
  jwt: 'Enter JSON objects for the payload/header. Tokens are signed locally when sending.',
  asap: 'RS256 assertion with issuer, audience and key ID. Lifetime must be 1–3600 seconds.',
};

export function AuthEditor({ value, onChange, inherited, allowInherit = true, workspace, request, notify }: Props) {
  const [gettingToken, setGettingToken] = useState(false), [error, setError] = useState(''), [resultMessage, setResultMessage] = useState('');
  const get = (key: string, fallback = '') => {
    const aliases: Record<string, string[]> = { accessToken: ['accesstoken', 'token'], tokenUrl: ['accessTokenUrl', 'accessTokenURL'], clientId: ['clientID'], accessKey: ['accessKeyId'], secretKey: ['secretAccessKey'], authId: ['id'], key: ['authKey', 'secret'], ext: ['extraData'], keyId: ['kid'], privateKey: ['private_key'], code: ['authorizationCode'], amzDate: ['timestamp'] };
    for (const name of [key, ...aliases[key] ?? []]) { const found = value.fields?.[name] ?? (value as unknown as Record<string, string>)[name]; if (typeof found === 'string') return found; }
    return fallback;
  };
  const update = (key: string, text: string) => onChange({ ...value, fields: { ...value.fields, [key]: text }, ...(['username', 'password', 'token', 'key', 'value'].includes(key) ? { [key]: text } : {}) });
  const field = ([label, key, secret, kind]: Field, fallback = '') => <label className="form-label" key={key}>{label}{kind === 'textarea' ? <textarea aria-label={label} disabled={gettingToken} spellCheck={false} rows={secret ? 4 : 5} value={get(key, fallback)} placeholder={key === 'payload' || key === 'header' ? '{}' : undefined} onChange={event => update(key, event.target.value)} /> : <input aria-label={label} disabled={gettingToken} type={secret ? 'password' : 'text'} autoComplete="off" value={get(key, fallback)} placeholder={key === 'amzDate' ? 'YYYYMMDDTHHmmssZ' : undefined} onChange={event => update(key, event.target.value)} />}</label>;
  const select = (label: string, key: string, choices: [string, string][], fallback: string) => <label className="form-label" key={key}>{label}<select aria-label={label} value={get(key, fallback)} onChange={event => update(key, event.target.value)}>{choices.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>;
  const check = (label: string, key: string) => <label className="auth-checkbox" key={key}><input type="checkbox" aria-label={label} checked={get(key) === 'true'} onChange={event => update(key, String(event.target.checked))} />{label}</label>;
  const acquire = async () => {
    if (!workspace) { setError('Token acquisition needs an active desktop workspace.'); return; }
    setGettingToken(true); setError(''); setResultMessage('');
    try {
      const token = await bridge.acquireOAuthToken(value, request ? requestVariables(workspace, request) : [...workspace.globals, ...(workspace.environments.find(env => env.id === workspace.activeEnvironmentId)?.variables ?? [])], workspace.settings);
      onChange({ ...value, token: token.accessToken, fields: { ...value.fields, accessToken: token.accessToken, ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}), tokenType: token.tokenType || 'Bearer' } });
      const message = `Token acquired${token.expiresIn ? ` · expires in ${token.expiresIn} seconds` : ''}.`; setResultMessage(message); notify?.(message);
    } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); notify?.(message, true); }
    finally { setGettingToken(false); }
  };
  const algorithm = get('algorithm', value.type === 'jwt' ? 'HS256' : 'sha256');
  return <div className="auth-editor"><div className="auth-type"><label className="form-label">Auth type<select aria-label="Authorization type" disabled={gettingToken} value={value.type} onChange={event => { setError(''); setResultMessage(''); onChange({ ...value, type: event.target.value as RequestAuth['type'] }); }}>{allowInherit && <option value="inherit">Inherit auth from parent</option>}{types.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><p>Authorization is applied when sending. Use variables to reuse credentials across environments.</p>{hints[value.type] && <p>{hints[value.type]}</p>}</div><div className="auth-values">
    {value.type === 'none' && <div className="auth-empty"><ShieldCheck size={26} /><p>This request does not use generated authorization.</p></div>}
    {value.type === 'inherit' && <div className="auth-empty"><ShieldCheck size={26} /><p>Uses the closest folder or collection authorization.</p><small>Effective type: {inherited || 'none'}</small></div>}
    {value.type === 'bearer' && field(['Token', 'token', true])}
    {value.type === 'basic' && <>{field(['Username', 'username'])}{field(['Password', 'password', true])}</>}
    {value.type === 'apikey' && <>{field(['Key', 'key'])}{field(['Value', 'value', true])}<label className="form-label">Add to<select aria-label="API key location" value={value.in || 'header'} onChange={event => onChange({ ...value, in: event.target.value as 'header' | 'query' })}><option value="header">Header</option><option value="query">Query params</option></select></label></>}
    {specifications[value.type]?.map(spec => field(spec, spec[1] === 'headerPrefix' ? 'Bearer' : spec[1] === 'expiry' ? '3600' : ''))}
    {value.type === 'digest' && select('Digest algorithm', 'algorithm', ['MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess', 'SHA-512-256', 'SHA-512-256-sess'].map(v => [v, v]), 'MD5')}
    {value.type === 'oauth1' && <>{select('Signature method', 'signatureMethod', ['HMAC-SHA1', 'HMAC-SHA256', 'RSA-SHA1', 'RSA-SHA256', 'PLAINTEXT'].map(v => [v, v]), 'HMAC-SHA1')}{select('Add authorization data to', 'addParamsToHeader', [['true', 'Authorization header'], ['false', 'Query parameters']], 'true')}{check('Include body hash', 'includeBodyHash')}</>}
    {value.type === 'oauth2' && <>{select('Token placement', 'addTokenTo', [['header', 'Authorization header'], ['queryParams', 'Query parameter']], 'header')}{get('addTokenTo', 'header') === 'queryParams' && field(['Token query key', 'queryParamKey'], 'access_token')}{select('Grant type', 'grantType', [['client_credentials', 'Client credentials'], ['authorization_code', 'Authorization code (manual / PKCE)'], ['refresh_token', 'Refresh token'], ['password', 'Password']], 'client_credentials')}{select('Client authentication', 'clientAuthentication', [['header', 'Basic auth header'], ['body', 'Request body']], 'header')}{get('grantType') === 'authorization_code' && <>{field(['Authorization code', 'code', true])}{field(['Redirect URI', 'redirectUri'])}{field(['PKCE code verifier', 'codeVerifier', true])}</>}{get('grantType') === 'refresh_token' && field(['Refresh token', 'refreshToken', true])}{get('grantType') === 'password' && <>{field(['Username', 'username'])}{field(['Password', 'password', true])}</>}<button className="button primary" type="button" disabled={gettingToken || !workspace} onClick={() => void acquire()}>{gettingToken ? <Loader2 size={14} className="spinner" /> : <ShieldCheck size={14} />}{gettingToken ? 'Getting token…' : 'Get token'}</button>{error && <p className="auth-inline-error" role="alert">{error}</p>}{resultMessage && <p className="auth-inline-success" role="status">{resultMessage}</p>}</>}
    {value.type === 'hawk' && <>{select('Hawk algorithm', 'algorithm', [['sha256', 'SHA-256'], ['sha1', 'SHA-1']], 'sha256')}{check('Include payload hash', 'includePayloadHash')}</>}
    {value.type === 'awsv4' && check('Sign query parameters', 'signQuery')}
    {value.type === 'jwt' && <>{select('JWT algorithm', 'algorithm', ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512'].map(v => [v, v]), 'HS256')}{algorithm.startsWith('HS') ? <>{field(['Secret', 'secret', true])}{check('Secret is Base64 encoded', 'isSecretBase64Encoded')}</> : <>{field(['Private key', 'privateKey', true, 'textarea'])}{field(['Key passphrase (optional)', 'passphrase', true])}</>}{select('JWT placement', 'addTokenTo', [['header', 'Authorization header'], ['queryParams', 'Query parameter']], 'header')}{get('addTokenTo', 'header') === 'queryParams' ? field(['JWT query key', 'queryParamKey'], 'token') : field(['Header prefix', 'headerPrefix'], 'Bearer')}</>}
  </div></div>;
}
