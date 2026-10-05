import { describe, expect, it } from 'vitest';
import { initialWorkspace, newRequest, row } from '../src/lib/model';
import { buildVariableContext } from '../src/lib/variable-details';
import { requestVariables } from '../src/lib/variables';

function setup() {
  const workspace = initialWorkspace(), request = newRequest();
  request.collectionId = 'collection'; request.folderId = 'child';
  workspace.globals = [row('shared', 'global'), row('globalOnly', 'global-value')];
  workspace.collections = [{ id: 'collection', name: 'Orders', description: '', auth: { type: 'none' }, requests: [], variables: [row('shared', 'collection'), row('collectionOnly', 'collection-value')], folders: [{ id: 'parent', name: 'Parent', requests: [], variables: [row('shared', 'parent'), row('parentOnly', 'parent-value')], folders: [{ id: 'child', name: 'Child', requests: [], folders: [], variables: [row('shared', 'child'), row('childOnly', 'child-value')] }] }] }];
  workspace.environments = [{ id: 'environment', name: 'Local API', variables: [row('shared', 'environment'), row('environmentOnly', 'environment-value')] }];
  workspace.activeEnvironmentId = 'environment';
  return { workspace, request };
}

describe('variable hover metadata', () => {
  it('matches Send precedence and identifies the true source', () => {
    const { workspace, request } = setup(), context = buildVariableContext(workspace, request);
    for (const variable of requestVariables(workspace, request)) expect(context.describe(variable.key).value).toBe(variable.value);
    expect(context.describe('shared').source).toEqual({ scope: 'Environment', name: 'Local API' });
    expect(context.describe('globalOnly').source?.scope).toBe('Global');
    expect(context.describe('collectionOnly').source?.scope).toBe('Collection');
    expect(context.describe('parentOnly').source).toEqual({ scope: 'Folder', name: 'Orders / Parent' });
    expect(context.describe('childOnly').source).toEqual({ scope: 'Folder', name: 'Orders / Parent / Child' });
  });
  it('falls back through disabled rows and absent environments', () => {
    const { workspace, request } = setup();
    workspace.environments[0].variables[0].enabled = false;
    expect(buildVariableContext(workspace, request).describe('shared').value).toBe('child');
    workspace.activeEnvironmentId = null;
    expect(buildVariableContext(workspace, request).describe('shared').environmentName).toBeUndefined();
    request.collectionId = undefined; request.folderId = undefined;
    expect(buildVariableContext(workspace, request).describe('shared').value).toBe('global');
  });
  it('uses the last enabled duplicate value and preserves empty values', () => {
    const { workspace, request } = setup();
    workspace.globals.push(row('globalOnly', ''), { ...row('globalOnly', 'disabled'), enabled: false });
    expect(buildVariableContext(workspace, request).describe('globalOnly')).toMatchObject({ status: 'resolved', value: '' });
  });
  it('resolves recursive references in the active context', () => {
    const { workspace, request } = setup(); workspace.globals.push(row('endpoint', 'https://{{ shared }}/{{childOnly}}'));
    expect(buildVariableContext(workspace, request).describe('endpoint').value).toBe('https://environment/child-value');
  });
  it('labels dynamic values without generating them on hover', () => {
    const { workspace, request } = setup(); workspace.globals.push(row('correlation', 'prefix-{{$guid}}'));
    const context = buildVariableContext(workspace, request);
    expect(context.describe('$guid')).toMatchObject({ status: 'dynamic', message: 'Generated when sent' });
    expect(context.describe('$guid').value).toBeUndefined();
    expect(context.describe('correlation')).toMatchObject({ status: 'dynamic', value: 'prefix-{{$guid}}' });
    expect(context.describe('correlation')).toBe(context.describe('correlation'));
    workspace.globals.push(row('$guid', 'user-defined'));
    expect(buildVariableContext(workspace, request).describe('$guid')).toMatchObject({ status: 'resolved', value: 'user-defined', source: { scope: 'Global' } });
  });
  it('reports missing, circular, and unknown dynamic references without throwing', () => {
    const { workspace, request } = setup(); workspace.globals.push(row('a', '{{b}}'), row('b', '{{a}}'), row('nestedMissing', '{{notDefined}}'));
    const context = buildVariableContext(workspace, request);
    expect(context.describe('notDefined').status).toBe('missing');
    expect(context.describe('$unknownDynamic').status).toBe('missing');
    expect(context.describe('nestedMissing')).toMatchObject({ status: 'missing', message: 'Unresolved variable: {{notDefined}}' });
    expect(context.describe('a')).toMatchObject({ status: 'error', message: 'Circular variable reference: a → b → a' });
  });
  it('keeps UTF-16 offsets for Monaco and trims token names', () => {
    const { workspace, request } = setup();
    const tokens = buildVariableContext(workspace, request).tokens('😀/{{ shared }}/{{missing}}');
    expect(tokens.map(token => [token.start, token.end, token.details.name])).toEqual([[3, 15, 'shared'], [16, 27, 'missing']]);
  });
  it('reads current workspace values without mutating workspace or request', () => {
    const { workspace, request } = setup(), before = structuredClone({ workspace, request });
    buildVariableContext(workspace, request).tokens('{{shared}} {{$guid}} {{missing}}');
    expect({ workspace, request }).toEqual(before);
    workspace.environments[0].variables[0].value = 'updated';
    expect(buildVariableContext(workspace, request).describe('shared').value).toBe('updated');
  });
});
