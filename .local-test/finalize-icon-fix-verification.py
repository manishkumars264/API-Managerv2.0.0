from pathlib import Path
import hashlib, json, re
root = Path('.')
desktop = (root / '.local-test/e2e-icon-fix-packaged-confirmed-20261004.log').read_text()
portable = json.loads((root / '.local-test/portable-icon-fix-result-20261004.json').read_text())
assert '2 passed' in desktop and not re.search(r'\n\s+\d+ failed\b', desktop)
assert portable['passed'] and portable['actualPortable'] and portable['variableDeletion']
p = root / 'docs/verification.md'
s = p.read_text()
start = s.index('The updated release build passed')
end = s.index('\n\n| Check', start)
s = s[:start] + ('The feature-complete v2.0.0 build passed TypeScript checks, production bundling, 312 Vitest tests, 73 native tests, and all 26 desktop scenarios in one complete packaged run: 411 automated checks. The subsequent delete-icon patch changes only scoped popup button styling. That rebuilt application passed TypeScript/production bundling and two targeted packaged desktop scenarios, covering environment/Globals edits, automatic variable creation/deletion, Cancel, Save/Ctrl+S, and relaunch. The trash icon has no native border, filled background, or shadow in Dark, Grey, and Light themes, including hover. Keyboard focus feedback and its existing click area remain intact. The actual final portable executable passed separate icon, variable editing/deletion, generated-header, JSON/SOAP, appearance, Help, search, console, and code-generation smoke checks. Hidden-window tests use isolated local profiles. No functional failures remained in these checks.') + s[end:]
s = s.replace('312 passed |', '312 passed in preceding full regression run |').replace('73 passed |', '73 passed in preceding full regression run |').replace('26 scenarios passed against the final rebuilt executable', '26 scenarios passed before the icon-only patch; 2 targeted scenarios passed after it')
for name in ['API Manager Setup 2.0.0.exe', 'API Manager 2.0.0.exe']:
    file = root / 'release' / name
    with file.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest().upper()
    with (root / 'release/icon-fix-build' / name).open('rb') as stream: assert digest == hashlib.file_digest(stream, 'sha256').hexdigest().upper()
    s = re.sub(r'\| `' + re.escape(name) + r'` \| \d+ \| `[A-Fa-f0-9]+` \|', f'| `{name}` | {file.stat().st_size} | `{digest}` |', s)
p.write_text(s)
print('Updated verification report for the final icon-only patch and rebuilt executable checksums.')
