import type { ApiRequest, KeyValue } from '../types';
import { row } from './model';

const variablePattern = /(\{\{[^{}]+\}\})/g;
const isVariable = (value: string) => /^\{\{[^{}]+\}\}$/.test(value);

/** URL separators inside a variable reference belong to its name, not the URL. */
function separatorIndex(value: string, separator: string, start = 0): number {
  for (let index = start; index < value.length; index++) {
    if (value.startsWith('{{', index)) {
      const end = value.indexOf('}}', index + 2);
      if (end >= 0) { index = end + 1; continue; }
    }
    if (value[index] === separator) return index;
  }
  return -1;
}

function urlParts(url: string): { base: string; query: string; hash: string } {
  const hashIndex = separatorIndex(url, '#');
  const beforeHash = hashIndex < 0 ? url : url.slice(0, hashIndex);
  const queryIndex = separatorIndex(beforeHash, '?');
  return { base: queryIndex < 0 ? beforeHash : beforeHash.slice(0, queryIndex),
    query: queryIndex < 0 ? '' : beforeHash.slice(queryIndex + 1), hash: hashIndex < 0 ? '' : url.slice(hashIndex) };
}

export function decodeQueryComponent(value: string): string {
  return value.split(variablePattern).map(part => isVariable(part) ? part : new URLSearchParams(`value=${part.replace(/&/g, '%26')}`).get('value') ?? '').join('');
}

/** Encodes delimiters without hiding readable @ characters or variable references. */
export function encodeQueryComponent(value: string): string {
  return value.split(variablePattern).map(part => isVariable(part) ? part : encodeURIComponent(new TextDecoder().decode(new TextEncoder().encode(part))).replace(/%40/g, '@')).join('');
}

function queryRows(url: string): KeyValue[] {
  const { query } = urlParts(url), result: KeyValue[] = [];
  let start = 0;
  while (start < query.length) {
    const next = separatorIndex(query, '&', start), end = next < 0 ? query.length : next;
    const part = query.slice(start, end);
    if (part) {
      const equals = separatorIndex(part, '=');
      result.push(row(decodeQueryComponent(equals < 0 ? part : part.slice(0, equals)), decodeQueryComponent(equals < 0 ? '' : part.slice(equals + 1))));
    }
    start = end + 1;
  }
  return result;
}

/** Synchronizes a manually edited URL while retaining matching row identities and metadata. */
export function paramsFromUrl(url: string, previous: KeyValue[] = []): KeyValue[] {
  const used = new Set<number>();
  const result = queryRows(url).map(parsed => {
    let index = previous.findIndex((item, i) => !used.has(i) && item.key === parsed.key && item.value === parsed.value);
    if (index < 0) index = previous.findIndex((item, i) => !used.has(i) && item.key === parsed.key);
    if (index < 0) return parsed;
    used.add(index);
    return { ...previous[index], key: parsed.key, value: parsed.value };
  });
  result.push(...previous.filter((item, index) => !item.enabled && !used.has(index)));
  return result;
}

/** Structured rows override all inline rows with the same key, including disabled rows. */
export function mergeQueryParams(url: string, params: KeyValue[]): KeyValue[] {
  const specified = new Set(params.map(item => item.key));
  return [...queryRows(url).filter(item => !specified.has(item.key)), ...params];
}

/** Replaces the displayed query with the complete Params editor, preserving base and fragment. */
export function urlWithParams(url: string, params: KeyValue[]): string {
  const { base, hash } = urlParts(url);
  const query = params.filter(item => item.enabled && (item.key || item.value)).map(item => `${encodeQueryComponent(item.key)}=${encodeQueryComponent(item.value)}`).join('&');
  return `${base}${query ? `?${query}` : ''}${hash}`;
}

/** Normalizes a transport/export URL without dropping inline keys missing from legacy Params. */
export function effectiveUrlWithParams(url: string, params: KeyValue[]): string {
  if (!params.length) return url;
  const merged = mergeQueryParams(url, params);
  const inline = queryRows(url), enabled = merged.filter(item => item.enabled);
  // No edits: retain the exact spelling of encoded bytes, plus signs, and bare flags.
  if (inline.length === enabled.length && inline.every((item, index) => item.key === enabled[index].key && item.value === enabled[index].value)) return url;
  return urlWithParams(url, merged);
}

/** Makes legacy inline queries visible in Params without rewriting the saved URL text. */
export function hydrateRequestParams(request: ApiRequest): ApiRequest {
  const params = mergeQueryParams(request.url, request.params);
  return params.length === request.params.length ? request : { ...request, params };
}
