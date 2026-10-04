const fs = require('node:fs');
const file = 'src/App.tsx';
let source = fs.readFileSync(file, 'utf8');
const before = "onCopy={code => copy(code, 'Request code copied.')}";
if (source.split(before).length !== 2) throw new Error('Code copy callback changed');
source = source.replace(before, "onCopy={async code => { await navigator.clipboard.writeText(code); notify('Request code copied.'); }}");
fs.writeFileSync(file, source);
