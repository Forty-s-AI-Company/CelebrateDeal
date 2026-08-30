[CmdletBinding()]
param(
  [string]$AgeRecipientFile,
  [string]$AgeIdentitySecretName = 'CelebrateDeal.Backup.AgeIdentityPath',
  [switch]$UsePreparedOfflineDestination,
  [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'CelebrateDeal.Backup.Common.psm1') -Force
if ([string]::IsNullOrWhiteSpace($AgeRecipientFile)) {
  $AgeRecipientFile = Join-Path $PSScriptRoot 'keys\production-backup.agepub'
}

if (-not $Execute) {
  @{ action = 'register_offline_age_identity_path'; executionRequired = $true } | ConvertTo-Json -Compress
  exit 0
}

Assert-CelebrateDealExecute -Execute:$Execute -Action 'Offline age identity path registration'
$identityPath = $null
$recipient = $null
try {
  $ageKeygenExecutable = Test-CelebrateDealCommand -Name 'age-keygen'
  if (Test-CelebrateDealSecretName -Name $AgeIdentitySecretName) { throw 'Age identity path reference already exists.' }

  if ($UsePreparedOfflineDestination) {
    $systemRoot = [IO.Path]::GetPathRoot($env:SystemRoot)
    $preparedIdentityPaths = @(
      [IO.DriveInfo]::GetDrives() |
        Where-Object { $_.IsReady -and $_.RootDirectory.FullName -ne $systemRoot } |
        ForEach-Object { Join-Path $_.RootDirectory.FullName 'CelebrateDeal\celebrate-deal-production-backup.agekey' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
    )
    if ($preparedIdentityPaths.Count -ne 1) { throw 'Exactly one prepared offline age identity is required.' }
    $identityPath = $preparedIdentityPaths[0]
  }
  else {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Choose the existing CelebrateDeal age identity on encrypted offline storage'
    $dialog.Filter = 'Age identity (*.agekey)|*.agekey|All files (*.*)|*.*'
    $dialog.Multiselect = $false
    if (Test-Path -LiteralPath 'E:\' -PathType Container) { $dialog.InitialDirectory = 'E:\' }
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'Offline identity selection was cancelled.' }
    $identityPath = $dialog.FileName
  }
  if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) { throw 'Selected age identity file was not found.' }

  $recipient = (& $ageKeygenExecutable '-y' $identityPath 2>$null | Out-String).Trim()
  $configuredRecipient = (Get-Content -LiteralPath $AgeRecipientFile | Where-Object { $_ -match '^age1[023456789acdefghjklmnpqrstuvwxyz]+$' } | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0 -or $recipient -notmatch '^age1[023456789acdefghjklmnpqrstuvwxyz]+$' -or $recipient -ne $configuredRecipient) {
    throw 'Selected identity does not match the configured public recipient.'
  }

  Set-CelebrateDealCredentialText -Name $AgeIdentitySecretName -Value $identityPath
  @{ identity = 'matched'; credential = 'created' } | ConvertTo-Json -Compress
}
catch {
  throw 'Offline age identity path registration failed. No secret details were emitted.'
}
finally {
  $identityPath = $null
  $recipient = $null
  $preparedIdentityPaths = $null
  [GC]::Collect()
}
