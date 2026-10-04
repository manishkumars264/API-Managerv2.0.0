from pathlib import Path
import hashlib
p = Path('docs/verification.md')
s = p.read_text(encoding='utf-8')
log = Path('.local-test/e2e-v2-packaged-final-20261004.log').read_text(encoding='utf-8-sig')
assert '1 passed' in log and ' failed' not in log and '21 passed' in Path('.local-test/e2e-v2-packaged-20261004.log').read_text(encoding='utf-8-sig'), 'The complete packaged suite must pass before publishing the final report.'
s = s.replace('Date: 2026-10-03. Target:', 'Date: 2026-10-04. Release: API Manager v2.0.0, an upgrade and complete revamp of v1.0.0. Target:', 1)
start=s.index('The release build passed')
end=s.index('\n\n| Check',start)
s=s[:start]+('The release build passed TypeScript checks, production bundling, 266 Vitest tests, 69 native tests, and all 21 desktop scenarios in a complete packaged v2.0.0 run: 356 automated checks in total. A final rebuild added selection of the original v1 release notes; the complete Help workflow was repeated against that final executable, including both v1/v2 history links, shortcut handling, layout, and bug-report drafts. Hidden-window tests disable background timer throttling so autosave and editor layout checks use active renderer timers. The error-body sequence explicitly saves workspace snapshots before disk assertions; separate tests cover automatic save and normal-close recovery. No functional failures remained in these final checks.')+s[end:]
s=s.replace('| 239 passed |','| 266 passed |').replace('| 57 passed |','| 69 passed |')
s=s.replace('All 16 scenarios passed across a complete run and one focused repeat','21 scenarios passed; updated Help repeated on the final rebuilt executable')
s=s.replace('Postman collection/environment/globals/native backup/cURL round trips, scopes,', 'Postman collection/environment/globals/native backup/cURL round trips, query hydration and encoding, metadata-preserving disabled/duplicate rows, version consistency, hover scope resolution, scopes,')
s=s.replace('Real HTTP bodies/uploads/headers, cookies,', 'Real HTTP bodies/uploads/headers, captured native cURL and actual curl.exe byte/header replay, HTTP errors and failed/cancelled attempt lookup, cookies,')
s=s.replace('all six code-generation options with preview/copy/error recovery.', 'all six code-generation options with preview/copy/error recovery, imported-cURL Save updates, collection/folder duplication without tab creation, current HTTP error/empty bodies, connection-failure clearing, editable environment popup/Globals/current values, variable colors/hover, and retained Console cURL across edits and relaunch.')
for name in ['API Manager Setup', 'API Manager']:
    oldname=f'{name} 1.0.0.exe'
    newname=f'{name} 2.0.0.exe'
    f=Path('release')/newname
    data=f.read_bytes()
    lines=s.splitlines()
    s='\n'.join(f'| `{newname}` | {len(data)} | `{hashlib.sha256(data).hexdigest().upper()}` |' if line.startswith(f'| `{oldname}`') else line for line in lines)+'\n'
s=s.replace('Dependency versions and the lockfile are unchanged by this console/appearance/code-generation update.', 'Dependency versions are unchanged. Only the package and lockfile root application version changed to 2.0.0.')
s=s.replace('Seventeen generator tests execute sixteen successful standalone Python/Node requests', 'Generator tests execute eighteen successful standalone Python/Node requests')
s=s.replace('The actual portable executable was launched separately', 'The actual v2.0.0 portable executable was launched separately')
anchor='## Practical limits'
details='''- New workflow checks import cURL URLs with readable email addresses and duplicate parameters, save twice to the same request ID, duplicate a collection request without creating a tab, and keep Duplicate tab separate. Nested Postman imports retain disabled rows and folder identity.
- The retained Monaco model is synchronized on each read-only mount. Sequential HTTP 200, 404, 401, 403, 200, and 204 responses show their current bodies; a disconnected server clears the preceding response and records a fresh error.
- Environment checks cover hover value/scope details, popup Cancel, explicit Save, next-request substitution, switching between environments, editing Globals with no selected environment, full-editor Save, unresolved-token coloring, and relaunch persistence.
- Console checks retain the native cURL after pre-request scripts, auth, and variable substitution across draft edits and relaunch. Native tests replay captures with actual curl.exe and match every header and payload byte, including duplicate headers and captured multipart boundaries. Large file-reference and omitted-command limitations are explicit.
- Version checks keep package/lockfile/current release/export stamps/native User-Agent/email drafts at v2.0.0. About retains v1.0.0 as Initial release and presents v2.0.0 as Upgrade and complete revamp. The application ID, local profile path, and workspace schema remain unchanged.

'''
s=s.replace(anchor,details+anchor,1)
p.write_text(s,encoding='utf-8')
