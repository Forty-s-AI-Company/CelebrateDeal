[CmdletBinding()]
param(
  [string]$SourceSecretName = 'CelebrateDeal.Production.DirectDatabaseUrl',
  [string]$IsolationTargetSecretName = 'CelebrateDeal.Isolated.RestoreUrl',
  [string]$SecretVault,
  [string]$AgeRecipientFile,
  [string]$PgDumpPath = 'pg_dump',
  [string]$PgRestorePath = 'pg_restore',
  [string]$AgePath = 'age',
  [string]$RclonePath = 'rclone'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 does not initialize $PSScriptRoot early enough for a
# param-block default expression. Resolve the local public recipient only once
# the script body starts; callers can still pass an explicit public-key path.
if ([string]::IsNullOrWhiteSpace($AgeRecipientFile)) {
  $AgeRecipientFile = Join-Path $PSScriptRoot 'keys\production-backup.agepub'
}

Import-Module (Join-Path $PSScriptRoot 'CelebrateDeal.Backup.Common.psm1') -Force

# This preflight is intentionally read-only. It never invokes pg_dump, age,
# rclone, pg_restore, Task Scheduler, or an off-site provider.
function Test-PreflightCommand {
  param([Parameter(Mandatory)][string]$Name)
  try {
    $null = Test-CelebrateDealCommand -Name $Name
    return $true
  }
  catch {
    return $false
  }
}

$checks = [ordered]@{
  pgDump = Test-PreflightCommand -Name $PgDumpPath
  pgRestore = Test-PreflightCommand -Name $PgRestorePath
  age = Test-PreflightCommand -Name $AgePath
  rclone = Test-PreflightCommand -Name $RclonePath
  sourceCredential = Test-CelebrateDealSecretName -Name $SourceSecretName -Vault $SecretVault
  isolationCredential = Test-CelebrateDealSecretName -Name $IsolationTargetSecretName -Vault $SecretVault
  ageRecipient = Test-CelebrateDealAgeRecipientFile -Path $AgeRecipientFile
  targetIsolation = Test-CelebrateDealIsolationTarget -SourceSecretName $SourceSecretName -TargetSecretName $IsolationTargetSecretName -Vault $SecretVault
}

$missing = @()
if (-not $checks.pgDump) { $missing += 'pg_dump' }
if (-not $checks.pgRestore) { $missing += 'pg_restore' }
if (-not $checks.age) { $missing += 'age' }
if (-not $checks.rclone) { $missing += 'rclone' }
if (-not $checks.sourceCredential) { $missing += 'source_credential' }
if (-not $checks.isolationCredential) { $missing += 'isolation_credential' }
if (-not $checks.ageRecipient) { $missing += 'age_recipient' }
if ($checks.targetIsolation -ne 'isolated') { $missing += 'isolated_target' }

[ordered]@{
  action = 'backup_preflight'
  ready = ($missing.Count -eq 0)
  checks = $checks
  missing = $missing
} | ConvertTo-Json -Compress
