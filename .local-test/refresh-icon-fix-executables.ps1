$ErrorActionPreference = 'Stop'
$taskRoot = (Get-Location).Path
foreach ($taskName in @('API Manager 2.0.0.exe','API Manager Setup 2.0.0.exe')) {
  $taskBuilt = (Resolve-Path -LiteralPath (Join-Path $taskRoot ('release/icon-fix-build/' + $taskName))).Path
  $taskVisible = Join-Path $taskRoot ('release/' + $taskName)
  $taskBackup = Join-Path $taskRoot ('.local-test/before-icon-fix-' + $taskName)
  $taskRunning = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $taskVisible })
  if ($taskRunning.Count) { throw ('The current executable is open and was preserved. The rebuilt file is available at ' + $taskBuilt) }
  if ((Test-Path -LiteralPath $taskVisible) -and -not (Test-Path -LiteralPath $taskBackup)) { Copy-Item -LiteralPath $taskVisible -Destination $taskBackup }
  Copy-Item -LiteralPath $taskBuilt -Destination $taskVisible
  $taskHash = (Get-FileHash -LiteralPath $taskBuilt -Algorithm SHA256).Hash
  if ((Get-FileHash -LiteralPath $taskVisible -Algorithm SHA256).Hash -ne $taskHash) { throw 'Executable copy integrity failed.' }
  [pscustomobject]@{ path=$taskVisible; bytes=(Get-Item -LiteralPath $taskVisible).Length; version=(Get-Item -LiteralPath $taskVisible).VersionInfo.ProductVersion; sha256=$taskHash } | ConvertTo-Json -Compress
}
