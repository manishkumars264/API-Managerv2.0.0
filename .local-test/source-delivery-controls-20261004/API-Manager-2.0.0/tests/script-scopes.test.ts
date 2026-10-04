import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialWorkspace, newRequest, row } from '../src/lib/model';
import { mergeScriptChanges, runScripts, scriptPrograms } from '../src/lib/scripts';
import type { ScriptPayload, ScriptResult } from '../src/types';

const { runScript } = vi.hoisted(() => ({ runScript: vi.fn() }));
vi.mock('../src/lib/bridge', () => ({ bridge: { runScript } }));

function fixture() {
  const workspace = initialWorkspace();
  const request = { ...newRequest('Request'), collectionId: 'collection', folderId: 'child', scripts: { preRequest: 'request-before', postResponse: 'request-after' } };
  workspace.globals = [row('global', 'old')];
  workspace.activeEnvironmentId = 'environment';
  workspace.environments = [{ id: 'environment', name: 'Local', variables: [row('token', 'old')] }];
  workspace.collections = [{ id: 'collection', name: 'Collection', description: '', auth: { type: 'none' }, variables: [row('collection', 'old')], requests: [], scripts: { preRequest: 'collection-before', postResponse: 'collection-after' }, folders: [{ id: 'parent', name: 'Parent', variables: [row('folder', 'inherited')], requests: [], scripts: { preRequest: 'parent-before', postResponse: 'parent-after' }, folders: [{ id: 'child', name: 'Child', requests: [request], folders: [], scripts: { preRequest: 'child-before', postResponse: 'child-after' } }] }] }];
  return { workspace, request };
}
function result(payload: ScriptPayload): ScriptResult {
  return { request: payload.request, globals: payload.globals, environment: payload.environment, collectionVariables: payload.collectionVariables, variables: payload.variables, tests: [], logs: [] };
}
beforeEach(() => { runScript.mockReset(); });

describe('script stage orchestration', () => {
  it('executes each inherited stage in collection, ancestor, child, request order', async () => {
    const { workspace, request } = fixture();
    expect(scriptPrograms(workspace, request, 'post-response').map(p => p.source)).toEqual(['collection-after', 'parent-after', 'child-after', 'request-after']);
    runScript.mockImplementation(async (payload: ScriptPayload) => ({ ...result(payload), variables: [...payload.variables, row(payload.script, 'executed')], logs: [{ level: 'log', message: payload.script }] }));
    const completed = await runScripts(workspace, request, 'pre-request', undefined, undefined, 'send-id');
    expect(runScript.mock.calls.map(([p]) => p.script)).toEqual(['collection-before', 'parent-before', 'child-before', 'request-before']);
    expect(runScript.mock.calls.every(([p]) => p.requestId === 'send-id')).toBe(true);
    expect(completed.variables.some(v => v.key === 'folder' && v.value === 'inherited')).toBe(true);
    expect(completed.variables.some(v => v.key === 'collection-before')).toBe(true);
    expect(completed.logs[3].message).toBe('Request: request-before');
  });

  it('stops at a script error and carries changed scopes without mutating the original', async () => {
    const { workspace, request } = fixture();
    runScript.mockImplementation(async (payload: ScriptPayload) => ({ ...result(payload), environment: payload.environment.map(v => ({ ...v, value: 'new' })), error: 'Script failed.' }));
    const completed = await runScripts(workspace, request, 'pre-request');
    expect(runScript).toHaveBeenCalledTimes(1);
    expect(completed.error).toBe('Collection: Script failed.');
    expect(completed.workspace.environments[0].variables[0].value).toBe('new');
    expect(workspace.environments[0].variables[0].value).toBe('old');
  });

  it('merges only script variable changes while preserving concurrent drafts and other environment edits', () => {
    const { workspace } = fixture();
    const after = structuredClone(workspace), current = structuredClone(workspace);
    after.environments[0].variables[0].value = 'script-token';
    after.globals = [row('new-global', 'script-value')];
    current.tabs[0].request.url = 'http://localhost/concurrent-draft';
    const concurrent = row('other', 'concurrent'); current.environments[0].variables.push(concurrent);
    current.environments.push({ id: 'other-environment', name: 'Other', variables: [row('untouched', 'yes')] });
    mergeScriptChanges(current, workspace, after);
    expect(current.tabs[0].request.url).toContain('concurrent-draft');
    expect(current.environments[0].variables).toEqual([after.environments[0].variables[0], concurrent]);
    expect(current.environments[1].variables[0].value).toBe('yes');
    expect(current.globals).toEqual(after.globals);
  });

  it('preserves row ordering and duplicate-key precedence when scripts update an earlier value', () => {
    const { workspace } = fixture();
    workspace.globals = [row('duplicate', 'first'), row('duplicate', 'last')];
    const after = structuredClone(workspace), current = structuredClone(workspace);
    after.globals[0].value = 'changed-first';
    mergeScriptChanges(current, workspace, after);
    expect(current.globals.map(value => value.value)).toEqual(['changed-first', 'last']);
  });

  it('keeps inherited output within persistence limits after names are prefixed', async () => {
    const { workspace, request } = fixture();
    runScript.mockImplementation(async (payload: ScriptPayload) => ({ ...result(payload), tests: Array.from({ length: 700 }, () => ({ name: 't'.repeat(1000), passed: true })), logs: Array.from({ length: 700 }, () => ({ level: 'log', message: 'm'.repeat(10000) })) }));
    const completed = await runScripts(workspace, request, 'pre-request');
    expect(completed.tests).toHaveLength(1000);
    expect(completed.logs).toHaveLength(1000);
    expect(completed.tests.every(test => test.name.length <= 1000)).toBe(true);
    expect(completed.logs.every(log => log.message.length <= 10000)).toBe(true);
  });
});
