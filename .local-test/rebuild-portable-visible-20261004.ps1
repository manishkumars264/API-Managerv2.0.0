$ErrorActionPreference = 'Stop'
Write-Output 'Building the latest portable app from the current source.'
npm run build *> '.local-test/build-portable-visible-20261004.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/build-portable-visible-20261004.log' -Tail 40; throw 'Production build failed.' }
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx electron-builder --win portable --x64 --publish never --config.directories.output=release/portable-refresh *> '.local-test/package-portable-visible-20261004.log'
if ($LASTEXITCODE -ne 0) { Get-Content '.local-test/package-portable-visible-20261004.log' -Tail 50; throw 'Portable build failed.' }
$taskBuiltPortable = (Resolve-Path -LiteralPath 'release/portable-refresh/API Manager 2.0.0.exe').Path
$taskVisiblePortable = Join-Path (Get-Location).Path 'release/API Manager 2.0.0.exe'
$taskPriorPortable = Join-Path (Get-Location).Path '.local-test/API Manager 2.0.0-before-visible-refresh.exe'
if (-not (Test-Path -LiteralPath $taskPriorPortable)) { Copy-Item -LiteralPath $taskVisiblePortable -Destination $taskPriorPortable }
$taskLocked = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $taskVisiblePortable })
if ($taskLocked.Count) { throw 'The prior portable EXE was reopened. The rebuilt EXE is available in release/portable-refresh; the open app was preserved.' }
Copy-Item -LiteralPath $taskBuiltPortable -Destination $taskVisiblePortable
$taskBuiltHash = (Get-FileHash -LiteralPath $taskBuiltPortable -Algorithm SHA256).Hash
if ((Get-FileHash -LiteralPath $taskVisiblePortable -Algorithm SHA256).Hash -ne $taskBuiltHash) { throw 'Portable copy failed integrity checks.' }
[pscustomobject]@{ path=$taskVisiblePortable; bytes=(Get-Item -LiteralPath $taskVisiblePortable).Length; version=(Get-Item -LiteralPath $taskVisiblePortable).VersionInfo.ProductVersion; sha256=$taskBuiltHash } | ConvertTo-Json | Tee-Object -FilePath '.local-test/portable-visible-metadata-20261004.json'
