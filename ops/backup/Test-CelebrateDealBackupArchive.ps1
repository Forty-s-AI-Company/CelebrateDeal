[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$EncryptedArchive,
  [Parameter(Mandatory)][string]$ExpectedSha256File,
  [string]$AgeIdentityFile,
  [string]$AgeIdentitySecretName = 'CelebrateDeal.Backup.AgeIdentityPath',
  [string]$SecretVault,
  [string]$AgePath = 'age',
  [string]$PgRestorePath = 'pg_restore',
  [string]$WorkingDirectory = (Join-Path $PSScriptRoot 'runtime'),
  [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'CelebrateDeal.Backup.Common.psm1') -Force
if (-not $Execute) {
  @{ action = 'offline_archive_verification'; executionRequired = $true } | ConvertTo-Json -Compress
  exit 0
}
Assert-CelebrateDealExecute -Execute:$Execute -Action 'Offline archive verification'
$temporaryDump = Join-Path $WorkingDirectory "verify-$([guid]::NewGuid().ToString('N')).dump"
$ageExecutable = $null; $pgRestoreExecutable = $null
$commandOutput = $null
try {
  $ageExecutable = Test-CelebrateDealCommand -Name $AgePath
  $pgRestoreExecutable = Test-CelebrateDealCommand -Name $PgRestorePath
  if ([string]::IsNullOrWhiteSpace($AgeIdentityFile)) {
    $AgeIdentityFile = Get-CelebrateDealSecretText -Name $AgeIdentitySecretName -Vault $SecretVault
  }
  foreach ($path in @($EncryptedArchive,$ExpectedSha256File,$AgeIdentityFile)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Required verification input was not found.' }
  }
  $expected = (Get-Content -LiteralPath $ExpectedSha256File -Raw).Split()[0].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $EncryptedArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw 'Archive checksum mismatch.' }
  New-Item -ItemType Directory -Path $WorkingDirectory -Force | Out-Null
  $commandOutput = & $ageExecutable '-d' '-i' $AgeIdentityFile '-o' $temporaryDump $EncryptedArchive 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw 'Archive decryption failed.' }
  $commandOutput = & $pgRestoreExecutable '--list' $temporaryDump 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw 'pg_restore archive listing failed.' }
  Write-Output 'offline_archive_verification_passed'
}
finally {
  $AgeIdentityFile = $null
  $commandOutput = $null
  Remove-Item -LiteralPath $temporaryDump -Force -ErrorAction SilentlyContinue
}
