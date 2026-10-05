import { describe, expect, it } from 'vitest';
import { newestConsoleEntries, newestScriptLogs } from '../src/lib/console-order';

describe('console activity order', () => {
  it('orders combined pending and completed requests by actual timestamp, newest first', () => {
    const pending = [{ id: 'long-pending', timestamp: '2026-10-04T08:00:00Z' }];
    const history = [{ id: 'older-completed', timestamp: '2026-10-04T07:00:00Z' }, { id: 'recent-completed', timestamp: '2026-10-04T09:00:00Z' }];
    expect(newestConsoleEntries([...pending, ...history]).map(entry => entry.id)).toEqual(['recent-completed', 'long-pending', 'older-completed']);
  });
  it('keeps equal instants stable even when their time zones differ', () => {
    const entries = [{ id: 'first', timestamp: '2026-10-04T14:30:00+05:30' }, { id: 'second', timestamp: '2026-10-04T09:00:00Z' }, { id: 'older', timestamp: '2026-10-04T08:59:59Z' }];
    expect(newestConsoleEntries(entries).map(entry => entry.id)).toEqual(['first', 'second', 'older']);
  });
  it('puts invalid or empty timestamps last without scrambling their order', () => {
    const entries = [{ id: 'invalid', timestamp: 'bad-time' }, { id: 'valid', timestamp: '2026-10-04T09:00:00Z' }, { id: 'empty', timestamp: '' }, { id: 'ancient', timestamp: '1900-01-01T00:00:00Z' }];
    expect(newestConsoleEntries(entries).map(entry => entry.id)).toEqual(['valid', 'ancient', 'invalid', 'empty']);
  });
  it('copies the array and retains every entry and its saved data without mutation', () => {
    const older = Object.freeze({ id: 'older', timestamp: '2026-10-04T08:00:00Z', body: 'saved older response' });
    const recent = Object.freeze({ id: 'recent', timestamp: '2026-10-04T09:00:00Z', body: 'saved recent response' });
    const source = Object.freeze([older, recent]);
    const sorted = newestConsoleEntries(source);
    expect(sorted).not.toBe(source);
    expect(sorted).toEqual([recent, older]);
    expect(sorted[0]).toBe(recent);
    expect(source).toEqual([older, recent]);
    expect(newestConsoleEntries([])).toEqual([]);
  });
  it('shows the newest script messages in the collapsed preview and older messages below when expanded', () => {
    const source = Object.freeze(Array.from({ length: 5 }, (_, index) => Object.freeze({ level: 'log', message: `message ${index + 1}` })));
    const displayed = newestScriptLogs(source);
    expect(displayed.slice(0, 3).map(log => log.message)).toEqual(['message 5', 'message 4', 'message 3']);
    expect(displayed.slice(3).map(log => log.message)).toEqual(['message 2', 'message 1']);
    expect(source.map(log => log.message)).toEqual(['message 1', 'message 2', 'message 3', 'message 4', 'message 5']);
    expect(displayed).not.toBe(source);
    expect(displayed[0]).toBe(source[4]);
    expect(newestScriptLogs([])).toEqual([]);
  });
});
