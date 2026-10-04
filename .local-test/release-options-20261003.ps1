$ErrorActionPreference = 'Stop'
Write-Output 'Building the application with console sizing, accents, and code generation.'
npm run build *> '.local-test/build-options-release-20261003.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/build-options-release-20261003.log' -Tail 50; throw 'Production build failed.' }
Write-Output 'Building Windows installer and portable executables.'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx electron-builder --win nsis portable --x64 --publish never *> '.local-test/package-options-20261003.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/package-options-20261003.log' -Tail 50; throw 'Windows packaging failed.' }
Write-Output 'Running all desktop scenarios against the rebuilt executable.'
$env:API_MANAGER_EXECUTABLE = (Resolve-Path 'release/win-unpacked/API Manager.exe').Path
npx playwright test *> '.local-test/e2e-options-packaged-20261003.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/e2e-options-packaged-20261003.log' -Tail 100; throw 'Packaged desktop tests failed.' }
Get-Content '.local-test/e2e-options-packaged-20261003.log' -Tail 20
