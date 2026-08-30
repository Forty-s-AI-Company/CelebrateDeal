$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$scripts = Get-ChildItem -LiteralPath $root -Filter '*.ps1' -File
foreach ($script in $scripts) {
  $tokens = $null; $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) { throw "PowerShell parse failure: $($script.Name): $($errors[0].Message)" }
}

$backup = Join-Path $root 'Invoke-CelebrateDealProductionBackup.ps1'
$plan = & $backup -WorkingDirectory 'C:\backup-work' -OffsiteDestination '\\server\backups' -AgeRecipientFile 'C:\keys\recipient.agepub'
if ($LASTEXITCODE -ne 0 -or $plan -notmatch 'executionRequired') { throw 'Backup script must remain plan-only without -Execute.' }
$googlePlan = & $backup -WorkingDirectory 'C:\backup-work' -OffsiteAdapter GoogleDrive -AgeRecipientFile 'C:\keys\recipient.agepub'
if ($LASTEXITCODE -ne 0 -or $googlePlan -notmatch 'GoogleDrive') { throw 'Google Drive adapter must remain plan-only without -Execute.' }

$preflight = Join-Path $root 'Test-CelebrateDealBackupPreflight.ps1'
$preflightResult = & $preflight | ConvertFrom-Json
if ($preflightResult.action -ne 'backup_preflight' -or $null -eq $preflightResult.ready) {
  throw 'Backup preflight must return a safe status-only result.'
}

$commonModule = Get-Content -LiteralPath (Join-Path $root 'CelebrateDeal.Backup.Common.psm1') -Raw
if ($commonModule -match "'check'\s+'--one-way'\s+'--checksum'") {
  throw 'Google Drive verification must not pass --checksum to rclone check.'
}
if ($commonModule -notmatch "'check'\s+'--one-way'\s+'--no-traverse'\s+'--files-from'") {
  throw 'Google Drive verification must select only the current archive pair without remote traversal.'
}
if ($commonModule -match "'copyto'.*'--checksum'") {
  throw 'Google Drive upload must defer checksum validation to the explicit check stage.'
}
if ($commonModule -notmatch 'Test-CelebrateDealIsolationTarget') {
  throw 'Backup tooling must compare source and restore targets without exposing metadata.'
}
if ($commonModule -notmatch 'AllowLocalNonTls' -or $commonModule -notmatch '\$isLoopback') {
  throw 'Backup tooling must allow non-TLS restore only for an explicit loopback target.'
}
if ($commonModule -notmatch 'Get-CelebrateDealRestoreFailureCategory' -or $commonModule -notmatch 'role_compatibility') {
  throw 'Backup tooling must safely classify isolated restore compatibility failures.'
}
if ($commonModule -notmatch 'Set-CelebrateDealCredentialText' -or $commonModule -notmatch 'CredWriteW') {
  throw 'Backup tooling must support a native Windows Credential Manager write fallback.'
}
$backupSource = Get-Content -LiteralPath $backup -Raw
if ($backupSource -notmatch '\$pgDumpExecutable\s*=\s*Test-CelebrateDealCommand' -or $backupSource -notmatch '&\s+\$pgDumpExecutable') {
  throw 'Backup execution must invoke the resolved pg_dump executable path.'
}
if ($backupSource -notmatch 'Get-CelebrateDealSafeFailureCategory' -or $backupSource -notmatch '2>&1\s*\|\s*Out-String') {
  throw 'Backup failures must be safely classified without emitting raw provider output.'
}
$resumeScript = Join-Path $root 'Resume-CelebrateDealGoogleDriveBackupUpload.ps1'
$resumePlan = & $resumeScript -WorkingDirectory 'C:\backup-work'
if ($LASTEXITCODE -ne 0 -or $resumePlan -notmatch 'executionRequired') { throw 'Google Drive upload resume must remain plan-only without -Execute.' }
$resumeSource = Get-Content -LiteralPath $resumeScript -Raw
if ($resumeSource -notmatch 'offsite_checksum_verified' -or $resumeSource -notmatch 'google_drive_checksum') {
  throw 'Google Drive resume must record only safe outcome stages.'
}
$identitySetup = Join-Path $root 'New-CelebrateDealAgeIdentity.ps1'
$identityPlan = & $identitySetup
if ($LASTEXITCODE -ne 0 -or $identityPlan -notmatch 'executionRequired') { throw 'Age identity setup must remain plan-only without -Execute.' }
$isWindowsHost = ($PSVersionTable.PSEdition -eq 'Desktop') -or
  ($null -ne (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue) -and $IsWindows)
if ($isWindowsHost -and $PSVersionTable.PSEdition -ne 'Desktop') {
  $windowsPowerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $windowsPowerShellPlan = & $windowsPowerShell -NoProfile -File $identitySetup
  if ($LASTEXITCODE -ne 0 -or $windowsPowerShellPlan -notmatch 'executionRequired') {
    throw 'Age identity setup must parse in Windows PowerShell 5.1.'
  }
}
$identitySource = Get-Content -LiteralPath $identitySetup -Raw
if ($identitySource -notmatch 'CelebrateDeal.Backup.AgeIdentityPath' -or $identitySource -notmatch 'SaveFileDialog') {
  throw 'Age identity setup must use a protected reference and interactive offline destination selection.'
}
if ($identitySource -notmatch 'UsePreparedOfflineDestination' -or $identitySource -notmatch '\[IO\.DriveInfo\]::GetDrives') {
  throw 'Age identity setup must support a non-interactive prepared offline destination without exposing its path.'
}
if ($identitySource -notmatch "Test-CelebrateDealCommand -Name 'age-keygen'" -or $identitySource -notmatch '&\s+\$ageKeygenExecutable') {
  throw 'Age identity setup must invoke age-keygen for key generation.'
}
if ($identitySource -match '\$ageKeygenExecutable[^\r\n]*2>&1') {
  throw 'Age identity setup must not promote age-keygen success output on stderr to a terminating error.'
}
if ($identitySource -notmatch '&\s+\$ageKeygenExecutable\s+''-y''' -or $identitySource -match '&\s+\$ageExecutable\s+''-y''') {
  throw 'Age identity setup must derive the public recipient with age-keygen -y.'
}
$identityRegistration = Join-Path $root 'Register-CelebrateDealAgeIdentityPath.ps1'
$identityRegistrationPlan = & $identityRegistration
if ($LASTEXITCODE -ne 0 -or $identityRegistrationPlan -notmatch 'executionRequired') { throw 'Age identity path registration must remain plan-only without -Execute.' }
if ($isWindowsHost -and $PSVersionTable.PSEdition -ne 'Desktop') {
  $identityRegistrationWindowsPlan = & $windowsPowerShell -NoProfile -File $identityRegistration
  if ($LASTEXITCODE -ne 0 -or $identityRegistrationWindowsPlan -notmatch 'executionRequired') {
    throw 'Age identity path registration must parse in Windows PowerShell 5.1.'
  }
}
$identityRegistrationSource = Get-Content -LiteralPath $identityRegistration -Raw
if ($identityRegistrationSource -notmatch 'UsePreparedOfflineDestination' -or $identityRegistrationSource -notmatch '&\s+\$ageKeygenExecutable\s+''-y''') {
  throw 'Age identity registration must support the prepared offline destination and validate with age-keygen -y.'
}
$restoreSource = Get-Content -LiteralPath (Join-Path $root 'Invoke-CelebrateDealRestoreDrill.ps1') -Raw
if ($restoreSource -notmatch 'CelebrateDeal.Backup.AgeIdentityPath' -or $restoreSource -notmatch 'Get-CelebrateDealSecretText') {
  throw 'Restore drill must support a protected age identity path reference.'
}
if ($restoreSource -notmatch 'ApplicationSchema' -or $restoreSource -notmatch '--schema=') {
  throw 'Isolated restore must support application-only schema recovery on plain PostgreSQL.'
}
$evidenceScript = Join-Path $root 'Test-CelebrateDealRestoreEvidence.ps1'
$evidencePlan = & $evidenceScript
if ($LASTEXITCODE -ne 0 -or $evidencePlan -notmatch 'executionRequired') {
  throw 'Restore evidence validation must remain plan-only without -Execute.'
}
$evidenceSource = Get-Content -LiteralPath $evidenceScript -Raw
if ($evidenceSource -notmatch 'prismaMigrations' -or $evidenceSource -notmatch 'nonSensitiveAggregates') {
  throw 'Restore evidence validation must cover schema, migrations, and non-sensitive aggregates.'
}
Write-Output 'backup_tooling_static_checks_passed'
