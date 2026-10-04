$ErrorActionPreference = 'Stop'
$taskCredentialLines = @('protocol=https', 'host=github.com', '') | git credential fill
if ($LASTEXITCODE -ne 0) { throw 'Existing GitHub authentication could not be read.' }
$taskCredential = @{}
foreach ($taskLine in $taskCredentialLines) {
  if ($taskLine -match '^([^=]+)=(.*)$') { $taskCredential[$Matches[1]] = $Matches[2] }
}
if (-not $taskCredential['password']) { throw 'Existing GitHub authentication did not include a token.' }
$taskHeaders = @{ Authorization = 'Bearer ' + $taskCredential['password']; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'API-Manager-build' }
try {
  $taskExisting = Invoke-RestMethod -Uri 'https://api.github.com/repos/manishkumars264/API-Manager/pulls?state=open&head=manishkumars264%3Acodex%2Fapi-manager-desktop' -Headers $taskHeaders
  if ($taskExisting -and $taskExisting[0].number) {
    $taskPullRequest = $taskExisting[0]
  } else {
    $taskBody = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'pull-request.json') -Raw
    $taskPullRequest = Invoke-RestMethod -Method Post -Uri 'https://api.github.com/repos/manishkumars264/API-Manager/pulls' -Headers $taskHeaders -ContentType 'application/json' -Body $taskBody
  }
  $taskPullRequest | Select-Object number,html_url,state,@{Name='head_sha';Expression={$_.head.sha}} | ConvertTo-Json -Compress
} finally {
  $taskCredential.Clear()
  $taskHeaders.Clear()
  $taskCredentialLines = $null
}
