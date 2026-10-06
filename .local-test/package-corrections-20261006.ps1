$ErrorActionPreference = 'Stop'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Write-Output 'Building the corrected v2.0.0 application.'
npm run build *> '.local-test/build-corrections-20261006.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/build-corrections-20261006.log' -Tail 40; throw 'Production build failed.' }
Write-Output 'Packaging the Windows installer and portable executable.'
npx electron-builder --win nsis portable --x64 --publish never --config.directories.output=release/corrections-build-20261006 *> '.local-test/package-corrections-20261006.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/package-corrections-20261006.log' -Tail 50; throw 'Windows packaging failed.' }
Write-Output 'Running the complete desktop regression suite against the packaged application.'
$env:API_MANAGER_EXECUTABLE = (Resolve-Path -LiteralPath 'release/corrections-build-20261006/win-unpacked/API Manager.exe').Path
npx playwright test *> '.local-test/e2e-corrections-packaged-20261006.log'
$taskExit = $LASTEXITCODE
Get-Content '.local-test/e2e-corrections-packaged-20261006.log' -Tail 70
if ($taskExit -ne 0) { throw 'Packaged desktop regression checks failed.' }
