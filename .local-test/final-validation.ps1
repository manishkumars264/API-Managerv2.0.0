$ErrorActionPreference = 'Stop'
Write-Output 'Running unit and native engine tests.'
npm test *> '.local-test/tests-delivery.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/tests-delivery.log' -Tail 80; throw 'Unit or native engine tests failed.' }
Write-Output 'Checking dependency advisories.'
npm audit --audit-level moderate *> '.local-test/audit-delivery.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/audit-delivery.log'; throw 'Dependency audit failed.' }
Write-Output 'Running all packaged desktop examples and regression scenarios.'
$env:API_MANAGER_EXECUTABLE = (Resolve-Path 'release/win-unpacked/API Manager.exe').Path
npx playwright test *> '.local-test/e2e-delivery.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/e2e-delivery.log' -Tail 100; throw 'Packaged desktop tests failed.' }
Get-Content '.local-test/tests-delivery.log' -Tail 12
Get-Content '.local-test/audit-delivery.log'
Get-Content '.local-test/e2e-delivery.log' -Tail 14
