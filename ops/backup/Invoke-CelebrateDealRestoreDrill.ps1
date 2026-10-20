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
  [string]$PsqlPath = 'psql',
  [string[]]$ApplicationSchema = @('public'),
  # F-074: 'auto' reads the archive's schema-only DDL to find where pg_trgm
  # operator classes are expected (Supabase usually uses `extensions`).
  [ValidateSet('auto', 'extensions', 'public')][string]$TrigramExtensionSchema = 'auto',
  [string]$WorkingDirectory = (Join-Path $PSScriptRoot 'runtime'),
  [string]$Confirmation,
  # Validates local inputs and prints the full step plan. Reads no secret,
  # decrypts nothing and connects to no database, even with -Execute.
  [switch]$DryRun,
  [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'CelebrateDeal.Backup.Common.psm1') -Force

function Get-CelebrateDealRestoreArguments {
  param([string[]]$Schema, [string]$Database, [string]$Dump)
  $arguments = @('--clean', '--if-exists', '--no-owner', '--no-privileges')
  foreach ($name in $Schema) { $arguments += "--schema=$name" }
  return $arguments + @('--dbname', $Database, $Dump)
}

$safeSchemas = $ApplicationSchema -and -not ($ApplicationSchema | Where-Object { $_ -notmatch '^[a-z_][a-z0-9_]*$' })

if ($DryRun) {
  $toolAvailable = {
    param([string]$Name)
    try { [void](Test-CelebrateDealCommand -Name $Name); return $true } catch { return $false }
  }
  $plannedTrigramSchema = if ($TrigramExtensionSchema -eq 'auto') { 'detected_from_archive_ddl' } else { $TrigramExtensionSchema }
  $previewSchema = if ($TrigramExtensionSchema -eq 'auto') { 'extensions' } else { $TrigramExtensionSchema }
  [ordered]@{
    action = 'isolated_restore_drill'
    mode = 'dry_run'
    archivePresent = (Test-Path -LiteralPath $EncryptedArchive -PathType Leaf)
    tools = [ordered]@{ age = (& $toolAvailable $AgePath); pg_restore = (& $toolAvailable $PgRestorePath); psql = (& $toolAvailable $PsqlPath) }
    applicationSchemasValid = [bool]$safeSchemas
    targetSecret = $IsolationTargetSecretName
    confirmationProvided = ($Confirmation -eq 'RESTORE-TO-ISOLATED-TARGET')
    trigramExtensionSchema = $plannedTrigramSchema
    steps = @(
      'resolve tools; read age identity path, source and target secrets at runtime',
      'reject a target equal to the source or with a production-looking host',
      'age -d into a temporary dump under the working directory',
      'pg_restore --schema-only to locate the pg_trgm schema (DDL only, not logged)',
      'psql: prepare extensions schema, pgcrypto and pg_trgm on the isolated target',
      'pg_restore application schemas into the isolated target',
      'report elapsed seconds for the RTO record; delete the temporary dump'
    )
    extensionPreparationSql = (Get-CelebrateDealExtensionPreparationSql -TrigramSchema $previewSchema)
    restoreArguments = (Get-CelebrateDealRestoreArguments -Schema $ApplicationSchema -Database '<isolated-target-database>' -Dump '<temporary-dump>')
    secretsRead = $false
    databaseContacted = $false
  } | ConvertTo-Json -Depth 4
  exit 0
}

if (-not $Execute) {
  @{ action = 'isolated_restore_drill'; targetSecret = $IsolationTargetSecretName; executionRequired = $true } | ConvertTo-Json -Compress
  exit 0
}
Assert-CelebrateDealExecute -Execute:$Execute -Action 'Isolated restore drill'
$temporaryDump = Join-Path $WorkingDirectory "restore-$([guid]::NewGuid().ToString('N')).dump"
$source = $null; $target = $null; $previousEnvironment = $null
$ageExecutable = $null; $pgRestoreExecutable = $null; $psqlExecutable = $null
$commandOutput = $null; $schemaOnlyDdl = $null; $preparationSql = $null
$stage = 'initializing'
$stopwatch = $null
$trigramSchema = $null
try {
  $ageExecutable = Test-CelebrateDealCommand -Name $AgePath
  $pgRestoreExecutable = Test-CelebrateDealCommand -Name $PgRestorePath
  $psqlExecutable = Test-CelebrateDealCommand -Name $PsqlPath
  if (-not $safeSchemas) {
    throw 'At least one safe application schema is required for the isolated restore drill.'
  }
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
  # RTO clock: decryption through a completed restore.
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
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

  $stage = 'extension_detection'
  if ($TrigramExtensionSchema -eq 'auto') {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      # Schema-only DDL carries no row data. It stays in memory and is cleared below.
      $schemaOnlyDdl = & $pgRestoreExecutable '--schema-only' '--file=-' $temporaryDump 2>$null | Out-String
      $nativeExitCode = $LASTEXITCODE
    }
    finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($nativeExitCode -ne 0) { throw 'Archive DDL could not be listed.' }
    $trigramSchema = Get-CelebrateDealTrigramSchema -SchemaOnlyDdl $schemaOnlyDdl
    if (-not $trigramSchema) { $trigramSchema = 'extensions' }
  }
  else {
    $trigramSchema = $TrigramExtensionSchema
  }
  $schemaOnlyDdl = $null

  # The isolated drill may use a local PostgreSQL instance without TLS.
  # The common helper permits this only for an explicit loopback host.
  $previousEnvironment = Set-CelebrateDealPostgresEnvironment -ConnectionString $target -AllowLocalNonTls
  $stage = 'extension_preparation'
  $preparationSql = Get-CelebrateDealExtensionPreparationSql -TrigramSchema $trigramSchema
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $commandOutput = & $psqlExecutable '--no-psqlrc' '--quiet' '--set' 'ON_ERROR_STOP=1' '--command' $preparationSql 2>&1 | Out-String
    $nativeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($nativeExitCode -ne 0) {
    $stage = "extension_preparation_$(Get-CelebrateDealRestoreFailureCategory -RawOutput $commandOutput)"
    throw 'Isolated target extension preparation failed.'
  }

  $stage = 'pg_restore'
  $restoreArguments = Get-CelebrateDealRestoreArguments -Schema $ApplicationSchema -Database $env:PGDATABASE -Dump $temporaryDump
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
  $stopwatch.Stop()
  Write-Output 'isolated_restore_drill_passed'
  [ordered]@{
    isolatedRestore = 'passed'
    elapsedSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 1)
    trigramExtensionSchema = $trigramSchema
  } | ConvertTo-Json -Compress
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
  $schemaOnlyDdl = $null
  $preparationSql = $null
  $previousErrorActionPreference = $null
  $nativeExitCode = $null
  $restoreArguments = $null
  Remove-Item -LiteralPath $temporaryDump -Force -ErrorAction SilentlyContinue
  [GC]::Collect()
}
