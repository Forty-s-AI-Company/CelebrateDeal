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
  [string]$AlertHandlerPath,
  [string]$PgDumpPath = 'pg_dump',
  [string]$AgePath = 'age',
  [string]$RclonePath = 'rclone',
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')][string]$DailyAt = '02:00',
  [switch]$Enable
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$backupScript = Join-Path $PSScriptRoot 'Invoke-CelebrateDealProductionBackup.ps1'
$taskName = 'CelebrateDeal-Production-Encrypted-Backup'
$arguments = "-NoProfile -ExecutionPolicy RemoteSigned -File `"$backupScript`" -WorkingDirectory `"$WorkingDirectory`" -OffsiteAdapter `"$OffsiteAdapter`" -AgeRecipientFile `"$AgeRecipientFile`" -SecretName `"$SecretName`""
if ($OffsiteAdapter -eq 'FileSystem') {
  if ([string]::IsNullOrWhiteSpace($OffsiteDestination)) { throw 'FileSystem adapter requires OffsiteDestination.' }
  $arguments += " -OffsiteDestination `"$OffsiteDestination`""
} else {
  $arguments += " -OffsiteDestinationSecretName `"$OffsiteDestinationSecretName`" -RcloneConfigSecretName `"$RcloneConfigSecretName`""
}
if ($SecretVault) { $arguments += " -SecretVault `"$SecretVault`"" }
if ($AlertHandlerPath) { $arguments += " -AlertHandlerPath `"$AlertHandlerPath`"" }
$arguments += " -PgDumpPath `"$PgDumpPath`" -AgePath `"$AgePath`" -RclonePath `"$RclonePath`""
$arguments += ' -Execute'

if (-not $Enable) {
  @{ action = 'register_windows_task'; taskName = $taskName; dailyAt = $DailyAt; enabled = $false; executionRequired = $true } | ConvertTo-Json -Compress
  exit 0
}

# Register this while signed in as the dedicated least-privilege backup account.
$action = New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact($DailyAt, 'HH:mm', $null))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'CelebrateDeal encrypted Production logical backup' -Force | Out-Null
Write-Output 'scheduled_task_registered'
