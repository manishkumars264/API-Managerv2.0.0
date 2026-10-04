const fs = require('node:fs');
const appPath = 'src/App.tsx';
let app = fs.readFileSync(appPath, 'utf8');
function replaceOnce(before, after) {
  if (app.split(before).length !== 2) throw new Error(`Expected one match: ${before.slice(0, 100)}`);
  app = app.replace(before, after);
}
replaceOnce('onEnvironment={setSelectedEnvironment} onAction={action}', 'onEnvironment={setSelectedEnvironment} consoleOpen={consoleOpen} onToggleConsole={() => setConsoleOpen(value => !value)} onAction={action}');
replaceOnce('<button onClick={() => { setMenu(null); copyCurl(request); }}><Code2 size={14} /> Copy as cURL</button>', '<button onClick={() => { setMenu(null); copyCurl(request); }}><Code2 size={14} /> Copy as cURL</button><button onClick={() => { setMenu(null); showRequestCode(request); }}><Code2 size={14} /> Generate code…</button>');
replaceOnce('<button className={`console-toggle ${consoleOpen ? "active" : ""}`} aria-label="Console" aria-pressed={consoleOpen} onClick={() => setConsoleOpen(!consoleOpen)}><Code2 size={12} />Console</button>', '');
replaceOnce("modal.kind === 'import' ? 'Import into your workspace' :", "modal.kind === 'code' ? 'Generate code' : modal.kind === 'import' ? 'Import into your workspace' :");
replaceOnce("wide={modal.kind === 'collection'", "wide={modal.kind === 'code' || modal.kind === 'collection'");
replaceOnce('<h4>Appearance</h4><label', '<h4>Appearance</h4><AccentSelector value={accent} onChange={setAccent} /><label');
replaceOnce("      {modal.kind === 'settings' &&", "      {modal.kind === 'code' && <CodeGenerationDialog request={modal.request} variables={modal.variables} onCopy={code => copy(code, 'Request code copied.')} onClose={() => setModal(null)} onError={text => notify(text, true)} />}\n      {modal.kind === 'settings' &&");
fs.writeFileSync(appPath, app);
