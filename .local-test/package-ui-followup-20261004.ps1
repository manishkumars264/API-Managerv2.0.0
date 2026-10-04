$ErrorActionPreference = 'Stop'
Write-Output 'Building the updated v2.0.0 desktop application.'
npm run build *> '.local-test/build-ui-release-20261004.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/build-ui-release-20261004.log' -Tail 40; throw 'Production build failed.' }
Write-Output 'Creating Windows installer and portable executables.'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx electron-builder --win nsis portable --x64 --publish never --config.directories.output=release/ui-followup-build *> '.local-test/package-ui-release-20261004.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/package-ui-release-20261004.log' -Tail 50; throw 'Windows packaging failed.' }
Write-Output 'Running the complete desktop regression suite against the updated executable.'
$env:API_MANAGER_EXECUTABLE = (Resolve-Path 'release/ui-followup-build/win-unpacked/API Manager.exe').Path
npx playwright test *> '.local-test/e2e-ui-packaged-20261004.log'
$taskExit = $LASTEXITCODE
Get-Content '.local-test/e2e-ui-packaged-20261004.log' -Tail 45
if ($taskExit -ne 0) { throw 'Packaged desktop checks failed.' }
