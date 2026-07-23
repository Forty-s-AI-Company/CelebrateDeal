[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$WorkingDirectory,
  [string]$OffsiteDestinationSecretName = 'CelebrateDeal.Backup.GoogleDriveDestination',
  [string]$RcloneConfigSecretName = 'CelebrateDeal.Backup.RcloneConfigPath',
  [string]$RclonePath = 'rclone',
  [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'CelebrateDeal.Backup.Common.psm1') -Force

if (-not $Execute) {
  @{ action = 'resume_google_drive_upload'; executionRequired = $true } | ConvertTo-Json -Compress
  exit 0
}

Assert-CelebrateDealExecute -Execute:$Execute -Action 'Google Drive archive upload resume'
$runtimeDirectory = Join-Path $WorkingDirectory 'runtime'
$encryptedArchives = @(Get-ChildItem -LiteralPath $runtimeDirectory -Filter 'celebrate-deal-production-*.dump.age' -File -ErrorAction SilentlyContinue)
if ($encryptedArchives.Count -ne 1) { throw 'Expected exactly one encrypted archive to resume.' }
$archive = $encryptedArchives[0]
$checksumSidecar = "$($archive.FullName).sha256"
if (-not (Test-Path -LiteralPath $checksumSidecar -PathType Leaf)) { throw 'Expected checksum sidecar was not found.' }

$rcloneConfigPath = $null
$googleDriveDestination = $null
$stage = 'initializing'
try {
  $rcloneExecutable = Test-CelebrateDealCommand -Name $RclonePath
  $rcloneConfigPath = Get-CelebrateDealSecretText -Name $RcloneConfigSecretName
  $googleDriveDestination = Get-CelebrateDealSecretText -Name $OffsiteDestinationSecretName
  $stage = 'google_drive_upload_check'
  Copy-CelebrateDealGoogleDriveArchive -RclonePath $rcloneExecutable -RcloneConfigPath $rcloneConfigPath -RemoteDestination $googleDriveDestination -LocalFiles @($archive.FullName,$checksumSidecar)
  Write-CelebrateDealBackupEvent -LogDirectory (Join-Path $WorkingDirectory 'logs') -Status success -Stage 'offsite_checksum_verified' -ArchiveId $archive.BaseName
  Write-Output 'google_drive_archive_resume_passed'
}
catch {
  $stage = if ($_.Exception.Message -match 'checksum') { 'google_drive_checksum' } else { 'google_drive_upload' }
  Write-CelebrateDealBackupEvent -LogDirectory (Join-Path $WorkingDirectory 'logs') -Status failed -Stage $stage -ArchiveId $archive.BaseName
  throw 'Google Drive archive resume failed. Review the safe backup event log.'
}
finally {
  $rcloneConfigPath = $null
  $googleDriveDestination = $null
  [GC]::Collect()
}
