$ErrorActionPreference = 'Stop'
Write-Output 'Building the application with v2.0.0 upgrade and requested workflow fixes.'
npm run build *> '.local-test/build-v2-release-20261004.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/build-v2-release-20261004.log' -Tail 50; throw 'Production build failed.' }
Write-Output 'Building Windows installer and portable executables.'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx electron-builder --win nsis portable --x64 --publish never *> '.local-test/package-v2-20261004.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/package-v2-20261004.log' -Tail 50; throw 'Windows packaging failed.' }
Write-Output 'Running all desktop scenarios against the rebuilt executable.'
$env:API_MANAGER_EXECUTABLE = (Resolve-Path 'release/win-unpacked/API Manager.exe').Path
npx playwright test *> '.local-test/e2e-v2-packaged-20261004.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/e2e-v2-packaged-20261004.log' -Tail 100; throw 'Packaged desktop tests failed.' }
Get-Content '.local-test/e2e-v2-packaged-20261004.log' -Tail 20
