import { describe, it, expect } from 'vitest';
import { beautify, configureSoap, responseDocument } from '../src/lib/format';
import { newRequest } from '../src/lib/model';
import type { ApiResponse } from '../src/types';

describe('body formatting and SOAP', () => {
  it('beautifies JSON while preserving big integer and duplicate key tokens', () => {
    const formatted = beautify('{"large":90071992547409931234,"same":1,"same":2}', 'json');
    expect(formatted).toContain('90071992547409931234'); expect(formatted.match(/"same"/g)).toHaveLength(2); expect(formatted).toContain('\n  "large"');
  });
  it('rejects invalid JSON without replacing editor content', () => {
    for (const value of ['', '{invalid}', '{"a":1,}', '{/*comment*/"a":1}']) expect(() => beautify(value, 'json')).toThrow('Invalid JSON');
  });
  it('formats SOAP XML and preserves mixed text and CDATA', () => {
    const formatted = beautify('<root><a>hello <b>world</b> !</a><code><![CDATA[a < b]]></code></root>', 'xml');
    expect(formatted).toContain('<![CDATA[a < b]]>'); expect(formatted).toContain('hello <b>world</b> !'); expect(formatted).toContain('\n');
    expect(() => beautify('<root><a></root>', 'xml')).toThrow('Invalid XML');
  });
  it('generates version-matched SOAP headers and envelope and upgrades namespace', () => {
    const one = configureSoap(newRequest(), '1.1', 'urn:Fetch');
    expect(one.method).toBe('POST'); expect(one.body.language).toBe('xml'); expect(one.headers.find(h => h.key === 'SOAPAction')?.value).toBe('"urn:Fetch"');
    const two = configureSoap(one, '1.2', 'urn:Fetch');
    expect(two.body.raw).toContain('http://www.w3.org/2003/05/soap-envelope'); expect(two.headers.find(h => h.key === 'SOAPAction')).toBeUndefined(); expect(two.headers.find(h => h.key === 'Content-Type')?.value).toContain('action="urn:Fetch"');
    expect(() => configureSoap(one, '1.1', 'bad\r\nHeader: value')).toThrow();
  });
  it('saves bodies and envelopes as valid JSON without changing large number text', () => {
    const response: ApiResponse = { status: 200, statusText: 'OK', body: '{"id":90071992547409931234}', headers: [], duration: 2, size: 30, url: 'https://example.com', receivedAt: new Date().toISOString() };
    const saved = responseDocument(response, true); expect(saved).toContain('90071992547409931234'); expect(JSON.parse(saved).status).toBe(200);
    expect(responseDocument({ ...response, body: '<soap>XML</soap>' }, false)).toBe('"<soap>XML</soap>"');
  });
});
