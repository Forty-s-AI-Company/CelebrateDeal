[CmdletBinding()]
param(
  [string]$SourceSecretName = 'CelebrateDeal.Production.DirectDatabaseUrl',
  [string]$IsolationTargetSecretName = 'CelebrateDeal.Isolated.RestoreUrl',
  [string]$SecretVault,
  [string]$PsqlPath = 'psql',
  [int]$MaxTables = 300,
  [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'CelebrateDeal.Backup.Common.psm1') -Force

if (-not $Execute) {
  @{ action = 'restore_evidence_validation'; executionRequired = $true } | ConvertTo-Json -Compress
  exit 0
}

Assert-CelebrateDealExecute -Execute:$Execute -Action 'Restore evidence validation'
$source = $null
$target = $null

function Invoke-CelebrateDealPsqlScalar {
  param(
    [Parameter(Mandatory)][string]$ConnectionString,
    [Parameter(Mandatory)][string]$Query,
    [switch]$AllowLocalNonTls
  )

  $previousEnvironment = $null
  $rawOutput = $null
  try {
    $previousEnvironment = Set-CelebrateDealPostgresEnvironment -ConnectionString $ConnectionString -AllowLocalNonTls:$AllowLocalNonTls
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $rawOutput = & $script:psqlExecutable '--no-psqlrc' '--tuples-only' '--no-align' '--set' 'ON_ERROR_STOP=1' '--command' $Query 2>&1 | Out-String
      $nativeExitCode = $LASTEXITCODE
    }
    finally {
      $ErrorActionPreference = $previousPreference
    }
    if ($nativeExitCode -ne 0) { throw 'Read-only evidence query failed.' }
    return $rawOutput.Trim()
  }
  finally {
    if ($previousEnvironment) { Restore-CelebrateDealPostgresEnvironment -Previous $previousEnvironment }
    $rawOutput = $null
    $nativeExitCode = $null
    $previousPreference = $null
  }
}

try {
  $script:psqlExecutable = Test-CelebrateDealCommand -Name $PsqlPath
  $source = Get-CelebrateDealSecretText -Name $SourceSecretName -Vault $SecretVault
  $target = Get-CelebrateDealSecretText -Name $IsolationTargetSecretName -Vault $SecretVault
  Assert-CelebrateDealIsolatedTarget -SourceConnectionString $source -TargetConnectionString $target -Confirmation 'RESTORE-TO-ISOLATED-TARGET'

  $schemaQuery = @'
SELECT coalesce(string_agg(
  table_name || ':' || ordinal_position::text || ':' || column_name || ':' ||
  data_type || ':' || is_nullable,
  E'\n' ORDER BY table_name, ordinal_position
), '')
FROM information_schema.columns
WHERE table_schema = 'public';
'@
  $migrationQuery = @'
SELECT coalesce(string_agg(
  migration_name || ':' ||
  CASE
    WHEN rolled_back_at IS NOT NULL THEN 'rolled_back'
    WHEN finished_at IS NOT NULL THEN 'finished'
    ELSE 'pending'
  END,
  E'\n' ORDER BY migration_name
), '')
FROM public._prisma_migrations;
'@
  $tableQuery = @'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
'@

  $sourceSchema = Invoke-CelebrateDealPsqlScalar -ConnectionString $source -Query $schemaQuery
  $targetSchema = Invoke-CelebrateDealPsqlScalar -ConnectionString $target -Query $schemaQuery -AllowLocalNonTls
  $sourceMigrations = Invoke-CelebrateDealPsqlScalar -ConnectionString $source -Query $migrationQuery
  $targetMigrations = Invoke-CelebrateDealPsqlScalar -ConnectionString $target -Query $migrationQuery -AllowLocalNonTls
  $sourceTables = @((Invoke-CelebrateDealPsqlScalar -ConnectionString $source -Query $tableQuery) -split "`r?`n" | Where-Object { $_ })
  $targetTables = @((Invoke-CelebrateDealPsqlScalar -ConnectionString $target -Query $tableQuery -AllowLocalNonTls) -split "`r?`n" | Where-Object { $_ })
  if ($sourceTables.Count -gt $MaxTables -or $targetTables.Count -gt $MaxTables) {
    throw 'Restore evidence table limit exceeded.'
  }

  $tableSetMatches = (@($sourceTables) -join "`n") -ceq (@($targetTables) -join "`n")
  $aggregatesMatch = $tableSetMatches
  if ($tableSetMatches) {
    foreach ($table in $sourceTables) {
      $quotedTable = '"' + $table.Replace('"', '""') + '"'
      $countQuery = "SELECT count(*)::text FROM public.$quotedTable;"
      $sourceCount = Invoke-CelebrateDealPsqlScalar -ConnectionString $source -Query $countQuery
      $targetCount = Invoke-CelebrateDealPsqlScalar -ConnectionString $target -Query $countQuery -AllowLocalNonTls
      if ($sourceCount -cne $targetCount) {
        $aggregatesMatch = $false
        break
      }
    }
  }

  $result = [ordered]@{
    schema = if ($sourceSchema -ceq $targetSchema) { 'passed' } else { 'failed' }
    prismaMigrations = if ($sourceMigrations -ceq $targetMigrations) { 'passed' } else { 'failed' }
    nonSensitiveAggregates = if ($aggregatesMatch) { 'passed' } else { 'failed' }
  }
  $result.overall = if ($result.Values -notcontains 'failed') { 'passed' } else { 'failed' }
  $result | ConvertTo-Json -Compress
}
catch {
  [ordered]@{
    schema = 'unable_to_determine'
    prismaMigrations = 'unable_to_determine'
    nonSensitiveAggregates = 'unable_to_determine'
    overall = 'failed'
    safeCategory = 'validation'
  } | ConvertTo-Json -Compress
  exit 1
}
finally {
  $source = $null
  $target = $null
  $sourceSchema = $null
  $targetSchema = $null
  $sourceMigrations = $null
  $targetMigrations = $null
  $sourceTables = $null
  $targetTables = $null
  $sourceCount = $null
  $targetCount = $null
  $script:psqlExecutable = $null
  [GC]::Collect()
}
