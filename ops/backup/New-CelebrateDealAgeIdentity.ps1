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

# Windows PowerShell 5.1 does not initialize $PSScriptRoot early enough for a
# param-block default expression.
if ([string]::IsNullOrWhiteSpace($AgeRecipientFile)) {
  $AgeRecipientFile = Join-Path $PSScriptRoot 'keys\production-backup.agepub'
}

if (-not $Execute) {
  @{ action = 'generate_offline_age_identity'; executionRequired = $true } | ConvertTo-Json -Compress
  exit 0
}

Assert-CelebrateDealExecute -Execute:$Execute -Action 'Offline age identity generation'
$identityPath = $null
$temporaryIdentityPath = $null
$recipient = $null
$stage = 'initialization'
try {
  $stage = 'age_command'
  $ageKeygenExecutable = Test-CelebrateDealCommand -Name 'age-keygen'
  $stage = 'credential_existing_check'
  if (Test-CelebrateDealSecretName -Name $AgeIdentitySecretName) {
    throw 'Age identity path reference already exists.'
  }

  $stage = 'offline_destination_selection'
  if ($UsePreparedOfflineDestination) {
    $systemRoot = [IO.Path]::GetPathRoot($env:SystemRoot)
    $preparedDirectories = @(
      [IO.DriveInfo]::GetDrives() |
        Where-Object { $_.IsReady -and $_.RootDirectory.FullName -ne $systemRoot } |
        ForEach-Object { Join-Path $_.RootDirectory.FullName 'CelebrateDeal' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Container }
    )
    if ($preparedDirectories.Count -ne 1) {
      throw 'Exactly one prepared offline CelebrateDeal directory is required.'
    }
    $identityPath = Join-Path $preparedDirectories[0] 'celebrate-deal-production-backup.agekey'
  }
  else {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Title = 'Choose encrypted offline storage for CelebrateDeal age identity'
    $dialog.FileName = 'celebrate-deal-production-backup.agekey'
    $dialog.Filter = 'Age identity (*.agekey)|*.agekey|All files (*.*)|*.*'
    $dialog.OverwritePrompt = $false
    if (Test-Path -LiteralPath 'E:\' -PathType Container) {
      $dialog.InitialDirectory = 'E:\'
    }
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
      throw 'Offline identity selection was cancelled.'
    }
    $identityPath = $dialog.FileName
  }
  if (Test-Path -LiteralPath $identityPath) {
    throw 'Selected age identity file already exists.'
  }
  $identityDirectory = [IO.Path]::GetDirectoryName($identityPath)
  if ([string]::IsNullOrWhiteSpace($identityDirectory) -or -not (Test-Path -LiteralPath $identityDirectory -PathType Container)) {
    throw 'Selected identity directory was not found.'
  }

  $stage = 'offline_destination_write_probe'
  $probePath = Join-Path $identityDirectory ('celebrate-deal-age-write-probe-' + [guid]::NewGuid().ToString('N') + '.tmp')
  $probeStream = $null
  try {
    $probeStream = [IO.File]::Open($probePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $probeStream.WriteByte(0)
  }
  finally {
    if ($probeStream) { $probeStream.Dispose() }
    Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
  }

  # With -o, age-keygen reports the public recipient on stderr even when it
  # succeeds. Windows PowerShell 5.1 can promote that native stderr record to
  # a terminating error under ErrorActionPreference=Stop, so suppress it and
  # derive the public recipient from the generated identity in the next step.
  $stage = 'key_generation'
  $temporaryIdentityPath = Join-Path $identityDirectory ('celebrate-deal-agekey-' + [guid]::NewGuid().ToString('N') + '.tmp')
  & $ageKeygenExecutable '-o' $temporaryIdentityPath 2>$null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporaryIdentityPath -PathType Leaf)) {
    throw 'age key generation failed.'
  }
  $stage = 'recipient_validation'
  $recipient = (& $ageKeygenExecutable '-y' $temporaryIdentityPath 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $recipient -notmatch '^age1[023456789acdefghjklmnpqrstuvwxyz]+$') {
    throw 'Generated public recipient validation failed.'
  }
  $stage = 'identity_file_commit'
  Move-Item -LiteralPath $temporaryIdentityPath -Destination $identityPath -ErrorAction Stop
  $temporaryIdentityPath = $null

  $stage = 'public_recipient_update'
  Set-Content -LiteralPath $AgeRecipientFile -Value @(
    '# Production backup age recipient public key.',
    '# Private identity remains on the selected encrypted offline storage.',
    $recipient
  ) -Encoding ascii
  $stage = 'credential_registration'
  Set-CelebrateDealCredentialText -Name $AgeIdentitySecretName -Value $identityPath
  @{ identity = 'created'; recipient = 'updated'; credential = 'created' } | ConvertTo-Json -Compress
}
catch {
  if ($temporaryIdentityPath -and (Test-Path -LiteralPath $temporaryIdentityPath -PathType Leaf)) {
    Remove-Item -LiteralPath $temporaryIdentityPath -Force -ErrorAction SilentlyContinue
  }
  if ($identityPath -and (Test-Path -LiteralPath $identityPath -PathType Leaf) -and -not $recipient) {
    Remove-Item -LiteralPath $identityPath -Force -ErrorAction SilentlyContinue
  }
  @{ identity = 'failed'; safeStage = $stage; secretDetailsEmitted = $false } | ConvertTo-Json -Compress
  exit 1
}
finally {
  $identityPath = $null
  $temporaryIdentityPath = $null
  $identityDirectory = $null
  $probePath = $null
  $probeStream = $null
  $recipient = $null
  $ageKeygenExecutable = $null
  $preparedDirectories = $null
  $systemRoot = $null
  $stage = $null
  [GC]::Collect()
}
