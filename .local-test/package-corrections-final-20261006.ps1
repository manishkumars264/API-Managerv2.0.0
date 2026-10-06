$ErrorActionPreference = 'Stop'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Write-Output 'Building the final v2.0.0 corrections and running unit/native checks.'
npm run check *> '.local-test/check-corrections-final-20261006.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/check-corrections-final-20261006.log' -Tail 45; throw 'Build or unit/native checks failed.' }
Write-Output 'Packaging the final Windows installer and portable executable.'
npx electron-builder --win nsis portable --x64 --publish never --config.directories.output=release/corrections-final-build-20261006 *> '.local-test/package-corrections-final-20261006.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/package-corrections-final-20261006.log' -Tail 50; throw 'Windows packaging failed.' }
Write-Output 'Running all desktop regression scenarios against the final packaged app.'
$env:API_MANAGER_EXECUTABLE = (Resolve-Path -LiteralPath 'release/corrections-final-build-20261006/win-unpacked/API Manager.exe').Path
npx playwright test *> '.local-test/e2e-corrections-final-packaged-20261006.log'
$taskExit = $LASTEXITCODE
Get-Content '.local-test/e2e-corrections-final-packaged-20261006.log' -Tail 70
if ($taskExit -ne 0) { throw 'Final packaged desktop regression failed.' }
