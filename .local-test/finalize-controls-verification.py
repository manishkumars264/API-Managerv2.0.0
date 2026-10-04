from pathlib import Path
import json, re, hashlib
root = Path('.')
unit = (root / '.local-test/unit-native-controls-20261004.log').read_text()
desktop = (root / '.local-test/e2e-controls-packaged-20261004.log').read_text()
portable = json.loads((root / '.local-test/portable-controls-result-20261004.json').read_text())
assert re.search(r'Tests\s+312 passed', unit) and 'pass 73' in unit and 'fail 0' in unit
assert '26 passed' in desktop and not re.search(r'\n\s+\d+ failed\b', desktop)
assert portable['passed'] and portable['actualPortable'] and portable['generatedHeaders'] and portable['variableDeletion'] and portable['automaticVariableRows']
files = []
for name in ['API Manager Setup 2.0.0.exe', 'API Manager 2.0.0.exe']:
    file = root / 'release' / name
    digest = hashlib.file_digest(file.open('rb'), 'sha256').hexdigest().upper()
    rebuilt = root / 'release/controls-build' / name
    assert digest == hashlib.file_digest(rebuilt.open('rb'), 'sha256').hexdigest().upper()
    files.append((name, file.stat().st_size, digest))
p = root / 'docs/verification.md'
s = p.read_text().replace('287 Vitest tests, 73 native tests, and all 25 desktop scenarios', '312 Vitest tests, 73 native tests, and all 26 desktop scenarios').replace('385 automated checks', '411 automated checks').replace('The five requested-feature desktop scenarios also passed in a focused run before packaging.', 'Focused desktop checks also verified automatic variable rows/deletion, generated authorization headers, the darker Grey theme, and tab controls before packaging.').replace('287 passed', '312 passed').replace('25 scenarios passed', '26 scenarios passed')
s = s.replace('The + control adds a focused name field;', 'Typing a name or value in the blank popup row automatically creates a checked variable and preserves typing focus; a fresh blank row is provided. Per-variable trash controls support removal, including deleting all variables. Disabled rows remain disabled when edited. Empty placeholder rows are not persisted, unnamed values prompt for a name, and Cancel discards additions/deletions;')
s = s.replace('Cancelling a newly added row discards it, and the full-editor Delete button shows text.', 'Environment and Globals additions/deletions survive explicit saves and relaunch, and the full-editor Delete button shows text.')
s = s.replace('Grey background/red accent choices', 'darker Grey background/red accent choices')
s = s.replace('five requested-feature desktop scenarios', 'requested-feature desktop scenarios')
for name, size, digest in files:
    s = re.sub(r'\| `' + re.escape(name) + r'` \| \d+ \| `[A-Fa-f0-9]+` \|', f'| `{name}` | {size} | `{digest}` |', s)
needle = '- Console checks retain the native cURL'
index = s.index(needle)
s = s[:index] + '- Generated-header checks cover UTF-8 Basic encoding, Bearer/API Key/OAuth 2 credentials, inherited folder/collection auth, scoped and recursive variables, defaults and case-insensitive overrides, query placement, multipart boundary deferral, missing/invalid credentials, and deferred dynamic/signing values. Desktop previews are compared with actual loopback requests and remain read-only across changes/relaunch. The actual portable executable also passed automatic variable creation/deletion, Ctrl+S, generated-header substitution, and JSON/SOAP sends; its extracted app archive matched the packaged executable used by the complete desktop suite.\n- Tab checks verify selected accent colors, paler disabled arrows at both ends, matching left/right dividers, no overlap with close controls, Ctrl+wheel navigation, and middle-button closing. Grey backgrounds and editors use the darker neutral palette while all five accents preserve requests and session state.\n' + s[index:]
s = s.replace('popup variable additions and Ctrl+S,', 'automatic popup variable additions/deletions and Ctrl+S, generated header previews compared with real requests,')
s = s.replace('and generated request programs.', 'read-only generated authorization headers, and generated request programs.')
p.write_text(s)
print(json.dumps({'checks': 411, 'vitest': 312, 'native': 73, 'desktop': 26, 'portable': True, 'files': files}, indent=2))
