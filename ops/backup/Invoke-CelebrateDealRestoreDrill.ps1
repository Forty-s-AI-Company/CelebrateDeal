[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$EncryptedArchive,
  [string]$AgeIdentityFile,
  [string]$AgeIdentitySecretName = 'CelebrateDeal.Backup.AgeIdentityPath',
  [Parameter(Mandatory)][string]$IsolationTargetSecretName,
  [string]$SourceSecretName = 'CelebrateDeal.Production.DirectDatabaseUrl',
  [string]$SecretVault,
  [string]$AgePath = 'age',
  [string]$PgRestorePath = 'pg_restore',
  [string[]]$ApplicationSchema = @('public'),
  [string]$WorkingDirectory = (Join-Path $PSScriptRoot 'runtime'),
  [string]$Confirmation,
  [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'CelebrateDeal.Backup.Common.psm1') -Force
if (-not $Execute) {
  @{ action = 'isolated_restore_drill'; targetSecret = $IsolationTargetSecretName; executionRequired = $true } | ConvertTo-Json -Compress
  exit 0
}
Assert-CelebrateDealExecute -Execute:$Execute -Action 'Isolated restore drill'
$temporaryDump = Join-Path $WorkingDirectory "restore-$([guid]::NewGuid().ToString('N')).dump"
$source = $null; $target = $null; $previousEnvironment = $null
$ageExecutable = $null; $pgRestoreExecutable = $null
$commandOutput = $null
$stage = 'initializing'
try {
  $ageExecutable = Test-CelebrateDealCommand -Name $AgePath
  $pgRestoreExecutable = Test-CelebrateDealCommand -Name $PgRestorePath
  if ([string]::IsNullOrWhiteSpace($AgeIdentityFile)) {
    # The secret contains only a protected runtime path reference, never the
    # identity content. The identity itself remains on the offline medium.
    $AgeIdentityFile = Get-CelebrateDealSecretText -Name $AgeIdentitySecretName -Vault $SecretVault
  }
  if (-not (Test-Path -LiteralPath $EncryptedArchive -PathType Leaf)) { throw 'Encrypted archive was not found.' }
  if (-not (Test-Path -LiteralPath $AgeIdentityFile -PathType Leaf)) { throw 'age identity file was not found.' }
  $source = Get-CelebrateDealSecretText -Name $SourceSecretName -Vault $SecretVault
  $target = Get-CelebrateDealSecretText -Name $IsolationTargetSecretName -Vault $SecretVault
  Assert-CelebrateDealIsolatedTarget -SourceConnectionString $source -TargetConnectionString $target -Confirmation $Confirmation
  New-Item -ItemType Directory -Path $WorkingDirectory -Force | Out-Null
  $stage = 'decryption'
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $commandOutput = & $ageExecutable '-d' '-i' $AgeIdentityFile '-o' $temporaryDump $EncryptedArchive 2>&1 | Out-String
    $nativeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($nativeExitCode -ne 0) { throw 'Archive decryption failed.' }
  # The isolated drill may use a local PostgreSQL instance without TLS.
  # The common helper permits this only for an explicit loopback host.
  $previousEnvironment = Set-CelebrateDealPostgresEnvironment -ConnectionString $target -AllowLocalNonTls
  $stage = 'pg_restore'
  if (-not $ApplicationSchema -or $ApplicationSchema | Where-Object { $_ -notmatch '^[a-z_][a-z0-9_]*$' }) {
    throw 'At least one safe application schema is required for the isolated restore drill.'
  }
  $restoreArguments = @('--clean', '--if-exists', '--no-owner', '--no-privileges')
  foreach ($schema in $ApplicationSchema) { $restoreArguments += "--schema=$schema" }
  $restoreArguments += @('--dbname', $env:PGDATABASE, $temporaryDump)
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    # A plain PostgreSQL isolation target does not provide Supabase-managed
    # roles and extensions. Restore only application-owned schemas here while
    # retaining the complete encrypted archive for managed-platform recovery.
    $commandOutput = & $pgRestoreExecutable $restoreArguments 2>&1 | Out-String
    $nativeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($nativeExitCode -ne 0) {
    $stage = "pg_restore_$(Get-CelebrateDealRestoreFailureCategory -RawOutput $commandOutput)"
    throw 'Isolated restore failed.'
  }
  Write-Output 'isolated_restore_drill_passed'
}
catch {
  [ordered]@{ isolatedRestore = 'failed'; safeStage = $stage } | ConvertTo-Json -Compress
  exit 1
}
finally {
  if ($previousEnvironment) { Restore-CelebrateDealPostgresEnvironment -Previous $previousEnvironment }
  $source = $null; $target = $null
  $AgeIdentityFile = $null
  $commandOutput = $null
  $previousErrorActionPreference = $null
  $nativeExitCode = $null
  $restoreArguments = $null
  Remove-Item -LiteralPath $temporaryDump -Force -ErrorAction SilentlyContinue
  [GC]::Collect()
}
