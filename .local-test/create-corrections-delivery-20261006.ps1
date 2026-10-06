$ErrorActionPreference = 'Stop'
$taskRoot = (Get-Location).Path
$taskPlan = Get-Content -LiteralPath '.local-test/delivery-plan-corrections-20261006.json' -Raw | ConvertFrom-Json
$taskOutput = [System.IO.Path]::GetFullPath($taskPlan.folder)
$taskReleaseRoot = [System.IO.Path]::GetFullPath((Join-Path $taskRoot 'release'))
if (-not $taskOutput.StartsWith($taskReleaseRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Delivery output escaped release.' }
if (-not (Test-Path -LiteralPath $taskOutput -PathType Container)) { throw 'The requested timestamped folder is missing.' }
$taskDesktop = Get-Content -LiteralPath '.local-test/e2e-corrections-final-packaged-20261006.log' -Raw
$taskChecks = Get-Content -LiteralPath '.local-test/check-corrections-final-20261006.log' -Raw
$taskPortable = Get-Content -LiteralPath '.local-test/portable-corrections-result-20261006.json' -Raw | ConvertFrom-Json
if ($taskDesktop -notmatch '28 passed' -or $taskChecks -notmatch '314 passed' -or $taskChecks -notmatch 'pass 73' -or -not $taskPortable.passed) { throw 'Final verification gates are not complete.' }
$taskVerification = Get-Content -LiteralPath 'docs/verification.md' -Raw
if ($taskVerification -notmatch '415 automated checks') { throw 'The current verification report is not finalized.' }
$taskStage = Join-Path $taskRoot '.local-test/source-delivery-corrections-20261006/API-Manager-2.0.0'
if (Test-Path -LiteralPath $taskStage) { throw 'Source staging already exists; preserve it.' }
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
$taskHashes = @{}
$taskBuiltRoot = Join-Path $taskRoot 'release/corrections-final-build-20261006'
foreach ($taskBinary in @('API Manager Setup 2.0.0.exe','API Manager 2.0.0.exe')) {
  $taskFile = Join-Path $taskBuiltRoot $taskBinary
  Copy-Item -LiteralPath $taskFile -Destination (Join-Path $taskStage 'release')
  Copy-Item -LiteralPath $taskFile -Destination $taskOutput
  $taskHashes['release/' + $taskBinary] = (Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash
  if ((Get-FileHash -LiteralPath (Join-Path $taskOutput $taskBinary) -Algorithm SHA256).Hash -ne $taskHashes['release/' + $taskBinary]) { throw 'Executable copy integrity mismatch.' }
}
$taskHashes.GetEnumerator() | Sort-Object Name | ForEach-Object { '{0}  {1}' -f $_.Value, $_.Key } | Set-Content -LiteralPath (Join-Path $taskStage 'CHECKSUMS.txt') -Encoding utf8
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskZip = Join-Path $taskOutput 'API-Manager-2.0.0.zip'
if (Test-Path -LiteralPath $taskZip) { throw 'The delivery ZIP already exists; preserve it.' }
Write-Output 'Creating the complete source and software ZIP in the timestamped release folder.'
[System.IO.Compression.ZipFile]::CreateFromDirectory($taskStage,$taskZip,[System.IO.Compression.CompressionLevel]::Optimal,$false)
$taskArchive = [System.IO.Compression.ZipFile]::OpenRead($taskZip)
try {
  $taskRequired = @($taskSourceFiles) + @($taskAssets) + @('CHECKSUMS.txt','release/API Manager Setup 2.0.0.exe','release/API Manager 2.0.0.exe')
  if ($taskArchive.Entries.Count -ne $taskRequired.Count) { throw 'Archive inventory differs from the source allowlist.' }
  foreach ($taskEntry in $taskArchive.Entries) {
    if ($taskEntry.FullName -match '^(node_modules|\.git|\.local-test|test-results|\.github|playwright-report)/') { throw ('Excluded directory included: ' + $taskEntry.FullName) }
  }
  foreach ($taskRelative in $taskRequired) {
    $taskEntry = $taskArchive.GetEntry($taskRelative)
    if (-not $taskEntry) { throw ('Missing archive file: ' + $taskRelative) }
    $taskStream = $taskEntry.Open(); $taskSha = [System.Security.Cryptography.SHA256]::Create()
    try { $taskHash = [System.BitConverter]::ToString($taskSha.ComputeHash($taskStream)).Replace('-','') } finally { $taskStream.Dispose(); $taskSha.Dispose() }
    if ($taskHash -ne (Get-FileHash -LiteralPath (Join-Path $taskStage $taskRelative) -Algorithm SHA256).Hash) { throw ('Archive integrity mismatch: ' + $taskRelative) }
  }
  $taskSummary = @{ folder=$taskOutput; zip=$taskZip; bytes=(Get-Item -LiteralPath $taskZip).Length; entries=$taskArchive.Entries.Count; sourceFiles=$taskSourceFiles.Count; builtAssets=$taskAssets.Count; allFileHashesVerified=$true; executableHashes=$taskHashes; applicationVersion='2.0.0'; releaseDate='2026-10-04' }
} finally { $taskArchive.Dispose() }
$taskSummary.sha256 = (Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash
$taskAlias = Join-Path $taskOutput 'API-Manager-2.0.0-ui-update.zip'
Copy-Item -LiteralPath $taskZip -Destination $taskAlias
if ((Get-FileHash -LiteralPath $taskAlias -Algorithm SHA256).Hash -ne $taskSummary.sha256) { throw 'Compatibility ZIP integrity mismatch.' }
Get-ChildItem -LiteralPath $taskOutput -File | Sort-Object Name | ForEach-Object { '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash, $_.Name } | Set-Content -LiteralPath (Join-Path $taskOutput 'SHA256SUMS.txt') -Encoding utf8
$taskSummary | ConvertTo-Json -Depth 5 | Tee-Object -FilePath '.local-test/delivery-corrections-20261006.json'
