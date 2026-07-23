[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$WorkingDirectory,
  [string]$OffsiteDestination,
  [ValidateSet('FileSystem','GoogleDrive')][string]$OffsiteAdapter = 'FileSystem',
  [string]$OffsiteDestinationSecretName = 'CelebrateDeal.Backup.GoogleDriveDestination',
  [string]$RcloneConfigSecretName = 'CelebrateDeal.Backup.RcloneConfigPath',
  [Parameter(Mandatory)][string]$AgeRecipientFile,
  [string]$SecretName = 'CelebrateDeal.Production.DirectDatabaseUrl',
  [string]$SecretVault,
  [string]$PgDumpPath = 'pg_dump',
  [string]$AgePath = 'age',
  [string]$RclonePath = 'rclone',
  [string]$AlertHandlerPath,
  [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'CelebrateDeal.Backup.Common.psm1') -Force

# Plan mode deliberately exits before reading secrets, checking tools, or touching disk.
$plan = [ordered]@{
  action = 'encrypted_logical_backup'
  adapter = $OffsiteAdapter
  secret = $SecretName
  destination = 'configured offsite destination (path withheld)'
  executionRequired = $true
}
if (-not $Execute) { $plan | ConvertTo-Json -Compress; exit 0 }

Assert-CelebrateDealExecute -Execute:$Execute -Action 'Production backup'
$archiveId = "celebrate-deal-production-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
$work = Join-Path $WorkingDirectory 'runtime'
$logDirectory = Join-Path $WorkingDirectory 'logs'
$dumpPath = Join-Path $work "$archiveId.dump"
$encryptedPath = Join-Path $work "$archiveId.dump.age"
$hashPath = "$encryptedPath.sha256"
$connectionString = $null
$previousEnvironment = $null
$rcloneConfigPath = $null
$googleDriveDestination = $null
$stage = 'initializing'
$pgDumpExecutable = $null
$ageExecutable = $null
$rcloneExecutable = $null
$commandOutput = $null

try {
  $pgDumpExecutable = Test-CelebrateDealCommand -Name $PgDumpPath
  $ageExecutable = Test-CelebrateDealCommand -Name $AgePath
  if (-not (Test-Path -LiteralPath $AgeRecipientFile -PathType Leaf)) { throw 'age recipient file was not found.' }
  if ($OffsiteAdapter -eq 'FileSystem' -and -not (Test-Path -LiteralPath $OffsiteDestination -PathType Container)) { throw 'Offsite destination must already exist.' }
  if ($OffsiteAdapter -eq 'GoogleDrive') { $rcloneExecutable = Test-CelebrateDealCommand -Name $RclonePath }

  New-Item -ItemType Directory -Path $work -Force | Out-Null
  $connectionString = Get-CelebrateDealSecretText -Name $SecretName -Vault $SecretVault
  $previousEnvironment = Set-CelebrateDealPostgresEnvironment -ConnectionString $connectionString

  # Connection details stay in process-scoped PG* variables, never in command arguments.
  $stage = 'pg_dump'
  $commandOutput = & $pgDumpExecutable '--format=custom' '--no-owner' '--no-privileges' '--file' $dumpPath 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dumpPath)) {
    $stage = "pg_dump_$(Get-CelebrateDealSafeFailureCategory -RawOutput $commandOutput)"
    throw 'pg_dump failed.'
  }
  # The repository contains only an age recipient public key; private identities never decrypt here.
  $stage = 'age_encryption'
  $commandOutput = & $ageExecutable '-R' $AgeRecipientFile '-o' $encryptedPath $dumpPath 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $encryptedPath)) {
    $stage = 'age_encryption_failed'
    throw 'age encryption failed.'
  }

  $stage = 'checksum'
  $hash = (Get-FileHash -LiteralPath $encryptedPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath $hashPath -Value "$hash  $(Split-Path -Leaf $encryptedPath)" -NoNewline -Encoding utf8
  if ($OffsiteAdapter -eq 'FileSystem') {
    $stage = 'offsite_copy'
    Copy-Item -LiteralPath $encryptedPath,$hashPath -Destination $OffsiteDestination -Force
    $remoteArchive = Join-Path $OffsiteDestination (Split-Path -Leaf $encryptedPath)
    if ((Get-FileHash -LiteralPath $remoteArchive -Algorithm SHA256).Hash -ne $hash) { throw 'Offsite checksum verification failed.' }
  } else {
    # Remote and config paths are runtime secrets, so they never enter source, logs, or task arguments.
    $stage = 'google_drive_upload_check'
    $googleDriveDestination = Get-CelebrateDealSecretText -Name $OffsiteDestinationSecretName -Vault $SecretVault
    $rcloneConfigPath = Get-CelebrateDealSecretText -Name $RcloneConfigSecretName -Vault $SecretVault
    Copy-CelebrateDealGoogleDriveArchive -RclonePath $rcloneExecutable -RcloneConfigPath $rcloneConfigPath -RemoteDestination $googleDriveDestination -LocalFiles @($encryptedPath,$hashPath)
  }
  Write-CelebrateDealBackupEvent -LogDirectory $logDirectory -Status success -Stage 'offsite_checksum_verified' -ArchiveId $archiveId
}
catch {
  Write-CelebrateDealBackupEvent -LogDirectory $logDirectory -Status failed -Stage $stage -ArchiveId $archiveId
  if ($AlertHandlerPath) { & $AlertHandlerPath -Status 'failed' -ArchiveId $archiveId -ErrorCategory 'backup_failed' }
  throw 'Production backup failed. Review the safe backup event log and Task Scheduler result.'
}
finally {
  if ($previousEnvironment) { Restore-CelebrateDealPostgresEnvironment -Previous $previousEnvironment }
  $connectionString = $null
  $rcloneConfigPath = $null
  $googleDriveDestination = $null
  $commandOutput = $null
  Remove-Item -LiteralPath $dumpPath -Force -ErrorAction SilentlyContinue
  [GC]::Collect()
}
