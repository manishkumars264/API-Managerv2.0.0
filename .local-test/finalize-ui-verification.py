from pathlib import Path
import json

root = Path.cwd()
unit_log = (root / '.local-test/tests-ui-followup-20261004.log').read_text(encoding='utf-8-sig')
desktop_log = (root / '.local-test/e2e-ui-packaged-20261004.log').read_text(encoding='utf-8-sig')
portable = json.loads((root / '.local-test/portable-ui-followup-result.json').read_text(encoding='utf-8-sig'))
assert '287 passed' in unit_log and 'tests 73' in unit_log and 'fail 0' in unit_log
assert '25 passed' in desktop_log and ' failed' not in desktop_log
assert portable['passed'] and portable['greyTheme'] and portable['inlineReleaseNotes']

file = root / 'docs/verification.md'
text = file.read_text(encoding='utf-8-sig')
start = text.index('The release build passed')
end = text.index('\n\n| Check |', start)
text = text[:start] + ('The updated release build passed TypeScript checks, production bundling, 287 Vitest tests, 73 native tests, and all 25 desktop scenarios in one complete run against the final packaged v2.0.0 executable: 385 automated checks in total. The five requested-feature desktop scenarios also passed in a focused run before packaging. The actual final portable executable passed separate JSON/SOAP and appearance/Help smoke checks. Hidden-window tests disable background timer throttling so autosave and editor layout checks use active renderer timers. The error-body sequence explicitly saves workspace snapshots before disk assertions; separate tests cover automatic save and normal-close recovery. No functional failures remained in these final checks.') + text[end:]
text = text.replace('266 passed', '287 passed').replace('69 passed', '73 passed')
text = text.replace('21 scenarios passed; updated Help repeated on the final rebuilt executable', '25 scenarios passed against the final rebuilt executable')
text = text.replace('all accent choices in both themes', 'all accent choices in all three themes')
text = text.replace('Format, variable, script-scope, appearance, console-height, and code-generation tests', 'Format, variable, script-scope, appearance, console-height/order, and code-generation tests')
text = text.replace('saved console height bounds, and generated request programs.', 'saved console height bounds, immutable newest-first Console ordering, empty-workspace round trips, Grey-theme contrast, and generated request programs.')
text = text.replace('editable environment popup/Globals/current values, variable colors/hover, and retained Console cURL across edits and relaunch.', 'editable environment popup/Globals/current values, variable colors/hover, retained Console cURL across edits and relaunch, all-tab closing and empty-workspace recovery, popup variable additions and Ctrl+S, recent-first Console ordering, exclusive inline release accordions, and Grey with every accent.')
text = text.replace('132957745', '132960697').replace('132740391', '132743341')
text = text.replace('AE34884D72B70B3389A32370587AE2C5CFC548BCB76AFDC150B647932722E0C0', '3891E9ABB2A4FAA10F37741E5D570AC79E6C3FCFD34DF16EA077B3E3DF3DB04D')
text = text.replace('0B52B51A18F96A8C8D3DE2AFD0EEEDE339AC5350705BCCDFBEA7C48189DC93BC', '89FC596E896073459E92004F6B23E5B72165D1E14040BE81E320C1370A66507C')
text = text.replace('Dependency versions are unchanged. Only the package and lockfile root application version changed to 2.0.0.', 'Dependency versions remain unchanged during this UI update; the package and lockfile root application version remain 2.0.0.')
text = text.replace('validated backups, corrupt-file retention/recovery, missing-primary recovery, close acknowledgments, input bounds, and off-screen window recovery.', 'validated backups, corrupt-file retention/recovery, missing-primary recovery, close acknowledgments, empty-tab persistence in all three themes, input bounds, and off-screen window recovery.')
text = text.replace('Clean tabs close without a dialog.', 'Clean tabs close without a dialog. Closing the last tab displays an empty workspace and keeps zero tabs after normal relaunch; new/import/open workflows still send HTTP 200 requests afterward. An empty workspace also round-trips through backup import/export.')
text = text.replace('Response content remains visible in smaller windows.', 'Response content remains visible in smaller windows. Newest runs and script messages appear first without changing the saved history or script-result sequence; equal timestamps remain stable and malformed timestamps sort last.')
text = text.replace('in both dark/light modes while sending real requests', 'in Dark, Light, and Grey modes while sending real requests')
text = text.replace('Palette checks preserve semantic colours and verify button/hover and accent-text contrast.', 'Palette checks preserve semantic colours and verify button/hover and accent-text contrast. Grey uses light-leaning neutral backgrounds, a dedicated matching Monaco editor theme, and persisted choices.')
text = text.replace('The dialog footer remains visible at 1000 by 650', 'Version history and release notes share one page; v2 starts expanded, v1 starts collapsed, and opening one closes the other. View/Hide release notes stays inside the selected version, and all versions can be collapsed. The dialog footer remains visible at 1000 by 650')
text = text.replace('a persisted red accent selection, keyboard console resizing', 'persisted Grey background/red accent choices, exclusive version accordions and inline release notes, keyboard console resizing')
text = text.replace('full-editor Save, unresolved-token coloring, and relaunch persistence.', 'full-editor Save, unresolved-token coloring, and relaunch persistence. The + control adds a focused name field; Ctrl+S saves from both the name/value controls and popup header without opening request Save. Cancelling a newly added row discards it, and the full-editor Delete button shows text.')
file.write_text(text, encoding='utf-8')
print('Verification report updated from final unit, native, packaged desktop and portable results.')
