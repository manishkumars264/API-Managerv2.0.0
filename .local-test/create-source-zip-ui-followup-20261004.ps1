$ErrorActionPreference = 'Stop'
$taskRoot = (Get-Location).Path
$taskStage = Join-Path $taskRoot '.local-test/source-delivery-ui-followup-20261004/API-Manager-2.0.0'
$taskZip = Join-Path $taskRoot 'release/API-Manager-2.0.0-ui-update.zip'
if (Test-Path -LiteralPath $taskZip) { throw 'The delivery ZIP already exists; retain it until a replacement is prepared.' }
New-Item -ItemType Directory -Path $taskStage -Force | Out-Null
$taskSourceFiles = git -c core.quotepath=false ls-files --cached --others --exclude-standard
if ($LASTEXITCODE -ne 0) { throw 'Source inventory failed.' }
$taskSourceFiles = @($taskSourceFiles | Where-Object { -not $_.StartsWith('.github/') } | Sort-Object -Unique)
foreach ($taskRelative in $taskSourceFiles) {
  $taskSource = [System.IO.Path]::GetFullPath((Join-Path $taskRoot $taskRelative))
  $taskDestination = [System.IO.Path]::GetFullPath((Join-Path $taskStage $taskRelative))
  if (-not $taskSource.StartsWith($taskRoot + '\', [System.StringComparison]::OrdinalIgnoreCase) -or -not $taskDestination.StartsWith($taskStage + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Source path escaped the project.' }
  New-Item -ItemType Directory -Path (Split-Path $taskDestination -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $taskSource -Destination $taskDestination
}
Copy-Item -LiteralPath (Join-Path $taskRoot 'dist') -Destination $taskStage -Recurse
New-Item -ItemType Directory -Path (Join-Path $taskStage 'release') -Force | Out-Null
$taskBinaries = @('API Manager Setup 2.0.0.exe', 'API Manager 2.0.0.exe')
$taskHashes = @{}
foreach ($taskBinary in $taskBinaries) {
  $taskFile = Join-Path $taskRoot ('release/ui-followup-build/' + $taskBinary)
  Copy-Item -LiteralPath $taskFile -Destination (Join-Path $taskStage 'release')
  $taskHashes['release/' + $taskBinary] = (Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash
}
$taskHashes.GetEnumerator() | Sort-Object Name | ForEach-Object { '{0}  {1}' -f $_.Value, $_.Key } | Set-Content -LiteralPath (Join-Path $taskStage 'CHECKSUMS.txt') -Encoding utf8
Add-Type -AssemblyName System.IO.Compression.FileSystem
Write-Output 'Creating the source and software ZIP.'
[System.IO.Compression.ZipFile]::CreateFromDirectory($taskStage, $taskZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Write-Output 'Checking source completeness and executable integrity inside the ZIP.'
$taskArchive = [System.IO.Compression.ZipFile]::OpenRead($taskZip)
try {
  $taskRequired = @($taskSourceFiles) + @('dist/index.html', 'CHANGELOG.md', 'CHECKSUMS.txt', 'release/API Manager Setup 2.0.0.exe', 'release/API Manager 2.0.0.exe', 'examples/README.md', 'examples/mock-server.mjs')
  foreach ($taskRequiredFile in $taskRequired) { if (-not $taskArchive.GetEntry($taskRequiredFile.Replace('\', '/'))) { throw ('Missing archive file: ' + $taskRequiredFile) } }
  foreach ($taskEntry in $taskArchive.Entries) {
    if ($taskEntry.FullName -match '^(node_modules|\.git|\.local-test|test-results|\.github)/') { throw ('Private/generated directory was included: ' + $taskEntry.FullName) }
  }
  foreach ($taskSourcePath in $taskSourceFiles) {
    $taskStream = $taskArchive.GetEntry($taskSourcePath.Replace('\', '/')).Open()
    $taskSha = [System.Security.Cryptography.SHA256]::Create()
    try { $taskHash = [System.BitConverter]::ToString($taskSha.ComputeHash($taskStream)).Replace('-', '') } finally { $taskStream.Dispose(); $taskSha.Dispose() }
    $taskOriginalHash = (Get-FileHash -LiteralPath (Join-Path $taskRoot $taskSourcePath) -Algorithm SHA256).Hash
    if ($taskHash -ne $taskOriginalHash) { throw ('Source changed during ZIP creation: ' + $taskSourcePath) }
  }
  foreach ($taskBinaryPath in $taskHashes.Keys) {
    $taskStream = $taskArchive.GetEntry($taskBinaryPath).Open()
    $taskSha = [System.Security.Cryptography.SHA256]::Create()
    try { $taskHash = [System.BitConverter]::ToString($taskSha.ComputeHash($taskStream)).Replace('-', '') } finally { $taskStream.Dispose(); $taskSha.Dispose() }
    if ($taskHash -ne $taskHashes[$taskBinaryPath]) { throw ('Executable changed during ZIP creation: ' + $taskBinaryPath) }
  }
  $taskSummary = @{ path = $taskZip; bytes = (Get-Item -LiteralPath $taskZip).Length; entries = $taskArchive.Entries.Count; sourceFiles = $taskSourceFiles.Count; executableHashesVerified = $true }
} finally { $taskArchive.Dispose() }
$taskSummary.sha256 = (Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash
$taskSummary | ConvertTo-Json -Compress



