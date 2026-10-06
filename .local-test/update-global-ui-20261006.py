from pathlib import Path
root = Path(__file__).resolve().parents[1]
def replace(path, old, new):
    file = root / path
    text = file.read_text(encoding='utf-8')
    if text.count(old) != 1:
        raise RuntimeError('Unexpected source for ' + path + ': ' + old[:80])
    file.write_text(text.replace(old, new), encoding='utf-8', newline='\n')

replace('src/App.tsx', '<option value="">No environment</option>', '<option value="">Global</option>')
replace('src/App.tsx', 'GeneratedHeaders key={request.id}', 'GeneratedHeaders key={current.id}')
replace('src/App.tsx', 'next.activeEnvironmentId = selectedEnvironment === workspace.activeEnvironmentId ? null : selectedEnvironment;', 'next.activeEnvironmentId = selectedEnvironment === \'globals\' || selectedEnvironment === workspace.activeEnvironmentId ? null : selectedEnvironment;')
replace('src/App.tsx', '  return <section className="environment-panel">', '  const isActive = selectedId === \'globals\' ? activeId === null : activeId === environment?.id;\n  return <section className="environment-panel">')
replace('src/App.tsx', "{environment && <><button className={`button ${activeId === environment.id ? 'active-button' : ''}`} onClick={onActivate}>{activeId === environment.id ? <><Check size={14} />Active</> : 'Set active'}</button><button", "<button className={`button ${isActive ? 'active-button' : ''}`} disabled={selectedId === 'globals' && isActive} onClick={onActivate}>{isActive ? <><Check size={14} />Active</> : 'Set active'}</button>{environment && <><button")
replace('src/App.tsx', 'Changes save automatically on this computer. Use Save to write them immediately. Select this environment in the toolbar to use its values in requests.', "Changes save automatically on this computer. Use Save to write them immediately. {selectedId === 'globals' ? 'Select Global or use Set active to use values without environment overrides.' : 'Select this environment in the toolbar to use its values in requests.'}")
replace('src/components/Sidebar.tsx', '<span>Globals</span><span className="count">', '<span>Globals</span>{workspace.activeEnvironmentId === null && <span className="active-dot" title="Global active" />}<span className="count">')
replace('src/components/EnvironmentQuickEdit.tsx', "environment ? 'Active environment' : 'No environment selected'", "environment ? 'Active environment' : 'Global active'")
replace('src/components/EnvironmentQuickEdit.tsx', 'Requests use global, collection, and folder values while no environment is selected. Edit global values below.', 'Requests use global, collection, and folder values without environment overrides. Edit global values below.')
replace('src/components/VariableInput.tsx', "details.environmentName || 'No environment selected'", "details.environmentName || 'Global'")
replace('tests/e2e/workspace.spec.ts', "await expect(dialog).toContainText('No environment selected');", "await expect(dialog).toContainText('Global active');")
print('Updated Global controls and workspace-tab disclosure identity without changing variable storage or precedence.')
