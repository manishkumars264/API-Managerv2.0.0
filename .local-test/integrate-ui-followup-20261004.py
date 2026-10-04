from pathlib import Path
p=Path('src/App.tsx')
s=p.read_text(encoding='utf-8')
def replace(old,new):
 global s
 assert old in s,old[:130]
 s=s.replace(old,new,1)
replace('Your APIs. Your workspace.', 'Store, organize, and test APIs locally.')
replace(' : current && request && <div className="request-workspace"', ' : current && request ? <div className="request-workspace"')
replace('        </div>}\n      </main>', '        </div> : <EmptyWorkspace onNew={() => addTab()} onImport={() => setModal({ kind: \'import\' })} />}\n      </main>')
replace('function VariableIcon() { return <span className="variable-symbol">{\'{ }\'}</span>; }', 'function VariableIcon() { return <SlidersHorizontal size={15} aria-hidden="true" />; }')
replace("event.target.value as 'dark' | 'light'", "event.target.value as Workspace['settings']['theme']")
replace('<option value="dark">Dark</option><option value="light">Light</option>', '<option value="dark">Dark</option><option value="grey">Grey</option><option value="light">Light</option>')
replace('<button className="icon-button danger" title="Delete environment" aria-label="Delete environment" onClick={onDelete}><Trash2 size={15} /></button>', '<button className="button danger" aria-label="Delete environment" onClick={onDelete}>Delete</button>')
replace('<h1>{environment?.name || \'Globals\'}</h1>', '<h1>{environment ? <SlidersHorizontal size={21} aria-hidden="true" /> : <Globe2 size={21} aria-hidden="true" />} {environment?.name || \'Globals\'}</h1>')
p.write_text(s,encoding='utf-8')
