$ErrorActionPreference = 'Stop'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Write-Output 'Packaging the updated Windows installer and portable app.'
npx electron-builder --win nsis portable --x64 --publish never --config.directories.output=release/controls-build *> '.local-test/package-controls-20261004.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/package-controls-20261004.log' -Tail 50; throw 'Windows packaging failed.' }
Write-Output 'Running the complete desktop suite against the packaged app.'
$env:API_MANAGER_EXECUTABLE = (Resolve-Path -LiteralPath 'release/controls-build/win-unpacked/API Manager.exe').Path
npx playwright test *> '.local-test/e2e-controls-packaged-20261004.log'
$taskExit = $LASTEXITCODE
Get-Content '.local-test/e2e-controls-packaged-20261004.log' -Tail 50
if ($taskExit -ne 0) { throw 'Packaged desktop checks failed.' }
