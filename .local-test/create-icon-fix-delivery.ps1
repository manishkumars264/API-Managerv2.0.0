$ErrorActionPreference = 'Stop'
$taskRoot = (Get-Location).Path
$taskStage = Join-Path $taskRoot '.local-test/source-delivery-icon-fix-20261004/API-Manager-2.0.0'
$taskZip = Join-Path $taskRoot '.local-test/API-Manager-2.0.0-icon-fix.zip'
if ((Test-Path -LiteralPath $taskZip) -or (Test-Path -LiteralPath $taskStage)) { throw 'Delivery staging already exists; retain it and use a new staging path.' }
New-Item -ItemType Directory -Path $taskStage -Force | Out-Null
$taskSourceFiles = @()
foreach ($taskDirectory in @('src','electron','shared','build','tests','docs','examples')) {
  $taskSourceFiles += @(Get-ChildItem -LiteralPath (Join-Path $taskRoot $taskDirectory) -File -Recurse | ForEach-Object { [System.IO.Path]::GetRelativePath($taskRoot, $_.FullName).Replace('\','/') })
}
$taskSourceFiles += @('.gitattributes','.gitignore','CHANGELOG.md','README.md','LICENSE','index.html','package.json','package-lock.json','playwright.config.ts','tsconfig.json','vite.config.ts','vitest.config.ts')
$taskSourceFiles = @($taskSourceFiles | Sort-Object -Unique)
foreach ($taskRelative in $taskSourceFiles) {
  $taskSource = [System.IO.Path]::GetFullPath((Join-Path $taskRoot $taskRelative))
  $taskDestination = [System.IO.Path]::GetFullPath((Join-Path $taskStage $taskRelative))
  if (-not $taskSource.StartsWith($taskRoot + '\', [System.StringComparison]::OrdinalIgnoreCase) -or -not $taskDestination.StartsWith($taskStage + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Source path escaped the workspace.' }
  New-Item -ItemType Directory -Path (Split-Path $taskDestination -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $taskSource -Destination $taskDestination
}
Copy-Item -LiteralPath (Join-Path $taskRoot 'dist') -Destination $taskStage -Recurse
$taskAssets = @(Get-ChildItem -LiteralPath (Join-Path $taskRoot 'dist') -File -Recurse | ForEach-Object { [System.IO.Path]::GetRelativePath($taskRoot, $_.FullName).Replace('\','/') })
New-Item -ItemType Directory -Path (Join-Path $taskStage 'release') -Force | Out-Null
$taskBinaries = @('API Manager Setup 2.0.0.exe','API Manager 2.0.0.exe')
$taskHashes = @{}
foreach ($taskBinary in $taskBinaries) {
  $taskFile = Join-Path $taskRoot ('release/' + $taskBinary)
  Copy-Item -LiteralPath $taskFile -Destination (Join-Path $taskStage 'release')
  $taskHashes['release/' + $taskBinary] = (Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash
  if ($taskHashes['release/' + $taskBinary] -ne (Get-FileHash -LiteralPath (Join-Path $taskRoot ('release/icon-fix-build/' + $taskBinary)) -Algorithm SHA256).Hash) { throw 'Root release executable does not match the tested build.' }
}
$taskHashes.GetEnumerator() | Sort-Object Name | ForEach-Object { '{0}  {1}' -f $_.Value, $_.Key } | Set-Content -LiteralPath (Join-Path $taskStage 'CHECKSUMS.txt') -Encoding utf8
Add-Type -AssemblyName System.IO.Compression.FileSystem
Write-Output 'Creating the source and software ZIP.'
[System.IO.Compression.ZipFile]::CreateFromDirectory($taskStage,$taskZip,[System.IO.Compression.CompressionLevel]::Optimal,$false)
Write-Output 'Verifying every source file, built asset and executable in the ZIP.'
$taskArchive = [System.IO.Compression.ZipFile]::OpenRead($taskZip)
try {
  $taskRequired = @($taskSourceFiles) + @($taskAssets) + @('CHECKSUMS.txt','release/API Manager Setup 2.0.0.exe','release/API Manager 2.0.0.exe')
  foreach ($taskEntry in $taskArchive.Entries) {
    if ($taskEntry.FullName -match '^(node_modules|\.git|\.local-test|test-results|\.github|playwright-report)/') { throw ('Excluded directory included: ' + $taskEntry.FullName) }
  }
  foreach ($taskRelative in $taskRequired) {
    $taskEntry = $taskArchive.GetEntry($taskRelative)
    if (-not $taskEntry) { throw ('Missing archive file: ' + $taskRelative) }
    $taskStream = $taskEntry.Open(); $taskSha = [System.Security.Cryptography.SHA256]::Create()
    try { $taskHash = [System.BitConverter]::ToString($taskSha.ComputeHash($taskStream)).Replace('-','') } finally { $taskStream.Dispose(); $taskSha.Dispose() }
    $taskExpected = if ($taskRelative -eq 'CHECKSUMS.txt') { Join-Path $taskStage $taskRelative } else { Join-Path $taskRoot $taskRelative }
    if ($taskHash -ne (Get-FileHash -LiteralPath $taskExpected -Algorithm SHA256).Hash) { throw ('Archive integrity mismatch: ' + $taskRelative) }
  }
  $taskSummary = @{ stagingZip=$taskZip; bytes=(Get-Item -LiteralPath $taskZip).Length; entries=$taskArchive.Entries.Count; sourceFiles=$taskSourceFiles.Count; builtAssets=$taskAssets.Count; allFileHashesVerified=$true; executableHashes=$taskHashes }
} finally { $taskArchive.Dispose() }
$taskSummary.sha256 = (Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash
foreach ($taskName in @('API-Manager-2.0.0.zip','API-Manager-2.0.0-ui-update.zip')) {
  $taskDestination = Join-Path $taskRoot ('release/' + $taskName)
  $taskBackup = Join-Path $taskRoot ('.local-test/before-icon-fix-' + $taskName)
  if ((Test-Path -LiteralPath $taskDestination) -and -not (Test-Path -LiteralPath $taskBackup)) { Copy-Item -LiteralPath $taskDestination -Destination $taskBackup }
  Copy-Item -LiteralPath $taskZip -Destination $taskDestination
  if ((Get-FileHash -LiteralPath $taskDestination -Algorithm SHA256).Hash -ne $taskSummary.sha256) { throw 'Delivery ZIP copy integrity mismatch.' }
}
$taskSummary | ConvertTo-Json -Depth 5 | Tee-Object -FilePath '.local-test/delivery-icon-fix-20261004.json'
