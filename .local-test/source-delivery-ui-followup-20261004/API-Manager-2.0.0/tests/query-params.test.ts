import { describe, expect, it } from 'vitest';
import { effectiveUrlWithParams, encodeQueryComponent, hydrateRequestParams, mergeQueryParams, paramsFromUrl, urlWithParams } from '../src/lib/query-params';
import { newRequest, row } from '../src/lib/model';

describe('query parameter display and synchronization', () => {
  it('reads relative/variable URLs, duplicates, encoded delimiters, plus spaces and empty values without changing the input', () => {
    const url = '{{base}}/echo?email=user@example.test&q=one%26two%3Dthree&same=1&same=2&space=one+two&empty=&flag#keep';
    expect(paramsFromUrl(url).map(item => [item.key, item.value, item.enabled])).toEqual([
      ['email', 'user@example.test', true], ['q', 'one&two=three', true], ['same', '1', true], ['same', '2', true], ['space', 'one two', true], ['empty', '', true], ['flag', '', true],
    ]);
    expect(effectiveUrlWithParams(url, paramsFromUrl(url))).toBe(url);
  });

  it('shows literal @ while safely encoding delimiters and retaining variable references', () => {
    const params = [row('email', 'user+alias@example.test'), row('value', 'a&b=c#d/e?f'), row('{{key}}', '{{value}}'), row('percent', '100% ready')];
    const url = urlWithParams('{{base}}/echo?old=gone#fragment', params);
    expect(url).toBe('{{base}}/echo?email=user%2Balias@example.test&value=a%26b%3Dc%23d%2Fe%3Ff&{{key}}={{value}}&percent=100%25%20ready#fragment');
    expect(paramsFromUrl(url).map(item => [item.key, item.value])).toEqual(params.map(item => [item.key, item.value]));
    expect(encodeQueryComponent('literal%40')).toBe('literal%2540');
  });

  it('preserves already encoded URL bytes and avoids double encoding after decoded Params edits', () => {
    const url = 'https://example.test/echo?email=user%40example.test&path=%2froot%2Ffile&literal=%2526&bad=%oops';
    const params = paramsFromUrl(url);
    expect(effectiveUrlWithParams(url, params)).toBe(url);
    const edited = urlWithParams(url, params);
    expect(edited).toBe('https://example.test/echo?email=user@example.test&path=%2Froot%2Ffile&literal=%2526&bad=%25oops');
    expect(paramsFromUrl(edited).map(item => item.value)).toEqual(params.map(item => item.value));
  });

  it('retains duplicate identities, descriptions, metadata and disabled drafts when URL values change', () => {
    const first = { ...row('same', 'one'), description: 'First', extra: { retained: true } };
    const second = { ...row('same', 'two'), description: 'Second' };
    const disabled = { ...row('off', 'hidden'), enabled: false, extra: { postman: { custom: 'keep' } } };
    const result = paramsFromUrl('https://example.test/?same=two&same=updated&new=3', [first, second, disabled]);
    expect(result[0]).toEqual(second);
    expect(result[1]).toEqual({ ...first, value: 'updated' });
    expect(result[3]).toEqual(disabled);
    expect(paramsFromUrl('https://example.test/?off=changed', [disabled])[0]).toEqual({ ...disabled, value: 'changed' });
  });

  it('distinguishes Params editing/deletion from transport merging for legacy partial rows', () => {
    const url = 'https://example.test/?inline=1&same=url&off=raw#hash';
    const params = [row('same', 'one'), row('same', 'two'), { ...row('off', '{{unused}}'), enabled: false }];
    expect(mergeQueryParams(url, params).map(item => [item.key, item.value, item.enabled])).toEqual([
      ['inline', '1', true], ['same', 'one', true], ['same', 'two', true], ['off', '{{unused}}', false],
    ]);
    expect(effectiveUrlWithParams(url, params)).toBe('https://example.test/?inline=1&same=one&same=two#hash');
    expect(urlWithParams(url, [params[0]])).toBe('https://example.test/?same=one#hash');
    expect(urlWithParams(url, [])).toBe('https://example.test/#hash');
    expect(effectiveUrlWithParams(url, [])).toBe(url);
  });

  it('hydrates empty/partial legacy Params without rewriting the URL or existing metadata', () => {
    const request = newRequest(); request.url = 'https://example.test/?email=user@example.test&same=old';
    expect(hydrateRequestParams(request).params.map(item => item.key)).toEqual(['email', 'same']);
    const overridden = { ...row('same', 'changed'), description: 'Keep this' };
    request.params = [overridden];
    const hydrated = hydrateRequestParams(request);
    expect(hydrated.url).toBe(request.url); expect(hydrated.params[1]).toBe(overridden);
    expect(hydrateRequestParams(hydrated)).toBe(hydrated);
  });

  it('does not treat separators or plus signs inside variable names as query delimiters', () => {
    const url = '{{base?part#name}}/echo?{{key&name}}={{value+name#part}}&normal=one+two#fragment';
    const params = paramsFromUrl(url);
    expect(params.map(item => [item.key, item.value])).toEqual([['{{key&name}}', '{{value+name#part}}'], ['normal', 'one two']]);
    expect(urlWithParams(url, params)).toBe('{{base?part#name}}/echo?{{key&name}}={{value+name#part}}&normal=one%20two#fragment');
  });

  it('preserves unnamed inline query values and handles incomplete Unicode input without an editor exception', () => {
    const url = 'https://example.test/?=value&normal=1';
    expect(effectiveUrlWithParams(url, paramsFromUrl(url))).toBe(url);
    expect(effectiveUrlWithParams(url, [row('normal', 'changed')])).toBe('https://example.test/?=value&normal=changed');
    expect(effectiveUrlWithParams('https://example.test/?=', paramsFromUrl('?='))).toBe('https://example.test/?=');
    expect(urlWithParams(url, [row('unicode', '\uD800')])).toBe('https://example.test/?unicode=%EF%BF%BD');
  });
});
