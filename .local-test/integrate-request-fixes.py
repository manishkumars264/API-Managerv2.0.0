from pathlib import Path
p = Path('src/App.tsx')
s = p.read_text(encoding='utf-8')
def replace(old, new):
    global s
    assert old in s, old[:150]
    s = s.replace(old, new, 1)
replace('return <div className="app-shell">', 'return <VariableContextProvider workspace={workspace} request={request}><div className="app-shell">')
replace('  </div>;\n}\n\nfunction VariableIcon()', '  </div></VariableContextProvider>;\n}\n\nfunction VariableIcon()')
replace('<div className="header-actions"><button className="icon-button" title="About and Help" aria-label="Help" onClick={() => setModal({ kind: \'help\' })}><CircleHelp size={17} /></button></div>', '<div className="header-actions" />')
replace("onClick={() => { mutate(next => { next.sidebarView = 'environments'; }); setSelectedEnvironment(workspace.activeEnvironmentId || 'globals'); }}", "onClick={() => setModal({ kind: 'environment', environmentId: workspace.activeEnvironmentId })}")
replace('<input aria-label="Request URL"', '<VariableInput aria-label="Request URL"')
replace('params: paramsFromUrl(event.target.value)', 'params: paramsFromUrl(event.target.value, request.params)')
replace('<button onClick={() => { setMenu(null); copyCurl(request); }}><Code2 size={14} /> Copy as cURL</button>', '')
replace('<button onClick={() => { setMenu(null); setModal({ kind: \'name\', title: \'Rename request\', value: request.name, submit: name => patchRequest({ name }) }); }}>Rename request</button>', '')
replace('error={text => notify(text, true)} /> : current && request', 'onSave={() => void persist(latest.current).then(() => notify("Environment values saved locally.")).catch(() => {})} error={text => notify(text, true)} /> : current && request')
replace("modal.kind === 'code' ? 'Generate code' :", "modal.kind === 'environment' ? 'Environment values' : modal.kind === 'code' ? 'Generate code' :")
replace("wide={modal.kind === 'code' ||", "wide={modal.kind === 'environment' || modal.kind === 'code' ||")
replace("      {modal.kind === 'cookies'", "      {modal.kind === 'environment' && <EnvironmentQuickEdit environment={workspace.environments.find(item => item.id === modal.environmentId)} globals={workspace.globals} onSave={async variables => { mutate(next => { const active = next.environments.find(item => item.id === modal.environmentId); if (active) active.variables = variables; else next.globals = variables; }); await persist(latest.current); notify('Environment values saved locally.'); setModal(null); }} onClose={() => setModal(null)} />}\n      {modal.kind === 'cookies'")
replace('onChange, onActivate, onRename, onExport, onDelete, error }: { environment?: Environment;', 'onChange, onActivate, onRename, onExport, onDelete, onSave, error }: { environment?: Environment;')
replace('onDelete: () => void; error: (text: string) => void })', 'onDelete: () => void; onSave: () => void; error: (text: string) => void })')
replace('<div className="environment-actions">', '<div className="environment-actions"><button className="button primary" aria-label="Save environment" onClick={onSave}><Save size={14} />Save</button>')
replace('Values are saved automatically on this computer. They are included when you export this environment.', 'Changes save automatically on this computer. Use Save to write them immediately. Select this environment in the toolbar to use its values in requests.')
p.write_text(s, encoding='utf-8')
