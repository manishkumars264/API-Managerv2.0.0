from pathlib import Path

root = Path.cwd()
script = (root / '.local-test/portable-ui-followup.cjs').read_text(encoding='utf-8-sig')
script = script.replace('release/ui-followup-build/API Manager 2.0.0.exe', 'release/API Manager 2.0.0.exe')
script = script.replace('portable-ui-followup-result.json', 'portable-visible-result-20261004.json')
(root / '.local-test/portable-visible-smoke-20261004.cjs').write_text(script, encoding='utf-8')
