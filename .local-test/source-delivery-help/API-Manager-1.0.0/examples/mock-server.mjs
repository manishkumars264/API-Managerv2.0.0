import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const DEMO_CLIENT_ID = 'api-manager-demo';
export const DEMO_CLIENT_SECRET = 'local-demo-secret';
export const DEMO_TOKEN = 'api-manager-local-demo-token';
const BODY_LIMIT = 1024 * 1024;
const SOAP_NAMESPACE = 'http://www.w3.org/2003/05/soap-envelope';

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Demo-Server': 'API Manager', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value, null, 2));
}
async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) { const error = new Error('Demo request body exceeds 1 MB.'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function queryValues(query) {
  const values = Object.create(null);
  for (const [key, value] of query) {
    if (values[key] === undefined) values[key] = value;
    else values[key] = [...(Array.isArray(values[key]) ? values[key] : [values[key]]), value];
  }
  return values;
}

/** Standalone loopback demo. Fixed credentials demonstrate API auth, not app accounts. */
export function createDemoServer() {
  return http.createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 16384 }, async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/health') { json(response, 200, { ok: true, service: 'API Manager local demo' }); return; }
      if (url.pathname === '/oauth/token') {
        if (request.method !== 'POST') { json(response, 405, { error: 'Use POST for the token endpoint.' }); return; }
        const body = new URLSearchParams(await readBody(request));
        let clientId = body.get('client_id'), clientSecret = body.get('client_secret');
        if (/^Basic /i.test(request.headers.authorization || '')) {
          const credentials = Buffer.from(request.headers.authorization.slice(6), 'base64').toString('utf8');
          const colon = credentials.indexOf(':'); clientId = credentials.slice(0, colon); clientSecret = credentials.slice(colon + 1);
        }
        if (clientId !== DEMO_CLIENT_ID || clientSecret !== DEMO_CLIENT_SECRET) { json(response, 401, { error: 'invalid_client', error_description: 'Use the bundled fake demo credentials.' }); return; }
        if (body.get('grant_type') !== 'client_credentials') { json(response, 400, { error: 'unsupported_grant_type' }); return; }
        json(response, 200, { access_token: DEMO_TOKEN, token_type: 'Bearer', expires_in: 3600, scope: body.get('scope') || 'demo:read' }); return;
      }
      if (url.pathname === '/soap') {
        if (request.method !== 'POST' || !/^application\/soap\+xml(?:;|$)/i.test(request.headers['content-type'] || '')) { json(response, 415, { error: 'Use a SOAP 1.2 POST with application/soap+xml.' }); return; }
        const body = await readBody(request);
        if (!body.includes(SOAP_NAMESPACE)) { json(response, 400, { error: 'Use the bundled SOAP 1.2 envelope namespace.' }); return; }
        // A fixed illustrative operation, without WSDL parsing or external entities.
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<soap:Envelope xmlns:soap="${SOAP_NAMESPACE}" xmlns:m="urn:api-manager:demo">\n  <soap:Body>\n    <m:EchoResponse>\n      <m:message>Hello from API Manager</m:message>\n      <m:receivedBytes>${Buffer.byteLength(body, 'utf8')}</m:receivedBytes>\n    </m:EchoResponse>\n  </soap:Body>\n</soap:Envelope>`;
        response.writeHead(200, { 'Content-Type': 'application/soap+xml; charset=utf-8', 'X-Demo-Server': 'API Manager' }); response.end(xml); return;
      }
      if (url.pathname === '/echo' || url.pathname === '/protected') {
        if (url.pathname === '/protected' && request.headers.authorization !== `Bearer ${DEMO_TOKEN}`) { json(response, 401, { error: 'Send the demo Bearer token. Run Get demo token first.' }); return; }
        const body = await readBody(request);
        let parsed;
        if (body && /^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
          try { parsed = JSON.parse(body); } catch { json(response, 400, { error: 'Invalid JSON request body.' }); return; }
        }
        json(response, 200, { method: request.method, path: url.pathname, query: queryValues(url.searchParams), headers: request.headers, body, ...(parsed === undefined ? {} : { json: parsed }), receivedAt: new Date().toISOString() }); return;
      }
      json(response, 404, { error: 'Unknown demo endpoint.', endpoints: ['/health', '/echo', '/soap', '/oauth/token', '/protected'] });
    } catch (error) {
      if (!response.headersSent && !response.destroyed) json(response, error.status || 500, { error: error.message || 'Demo server error.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.API_MANAGER_DEMO_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error('API_MANAGER_DEMO_PORT must be an integer from 0 through 65535.'); process.exitCode = 1; }
  else {
    const server = createDemoServer();
    server.on('error', error => { console.error(`Could not start the local demo: ${error.message}`); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => { console.log(`API Manager demo is ready at http://127.0.0.1:${server.address().port}`); console.log('Keep this terminal open. Press Ctrl+C to stop.'); });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
  }
}
