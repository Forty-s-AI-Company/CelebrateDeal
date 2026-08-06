[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssfff")
$cleanDb = "celebratedeal_wp89_${runId}_clean"
$staleDb = "celebratedeal_wp89_${runId}_stale"
$receiptPath = Join-Path $root ".ai-team\reports\wp89-migration-drift-receipt.json"
$migrationPath = Join-Path $root "prisma\migrations\20260725230000_encrypt_payout_bank_accounts\migration.sql"
$readModelFixture = "tests/recovery/wp89-platform-finance-read-model.ts"
$driftFixture = "tests/recovery/wp89-payout-bank-column-drift.ts"
$owned = @(
  "src/app/admin/billing/dashboard/page.tsx",
  "tests/e2e/wp88-direct-url-guard-matrix.spec.ts",
  $readModelFixture,
  $driftFixture,
  ".ai-team/scripts/Invoke-Wp89MigrationDriftQa.ps1",
  ".ai-team/reports/wp89-migration-drift-receipt.json",
  "docs/ai-team/evidence/wp-89-migration-drift-platform-finance.md"
)
$records = [Collections.Generic.List[object]]::new()
$container = $null
$cleanCreated = $false
$staleCreated = $false
$status = "BLOCKED_OR_FAILED"
$failure = $null

function Quote-ProcessArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ($Value -replace '(\\*)"', '$1$1\\"') + '"'
}
function Same($Left, $Right) { (($Left | ConvertTo-Json -Depth 16 -Compress) -eq ($Right | ConvertTo-Json -Depth 16 -Compress)) }
function Get-SyntheticEnvironment([string]$DatabaseName) {
  if ($DatabaseName -notmatch '^celebratedeal_wp89_[0-9]{17}_(clean|stale)$') { throw "Disposable database name rejected." }
  $url = "postgresql://postgres:postgres@127.0.0.1:54329/${DatabaseName}?schema=public"
  [ordered]@{
    PATH = $env:PATH; SystemRoot = $env:SystemRoot; ComSpec = $env:ComSpec; PATHEXT = $env:PATHEXT
    DATABASE_URL = $url; DIRECT_URL = $url; NODE_ENV = "test"; CI = ""; PSQLRC = ""
    NPM_CONFIG_OFFLINE = "true"; HOME = (Join-Path ([IO.Path]::GetTempPath()) "wp89-home-$runId"); USERPROFILE = (Join-Path ([IO.Path]::GetTempPath()) "wp89-home-$runId")
  }
}
function Invoke-Child([string]$Name, [string]$File, [string[]]$Arguments, [Collections.IDictionary]$Environment, [bool]$RequireSuccess = $true) {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.WorkingDirectory = $root; $info.UseShellExecute = $false; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true; $info.CreateNoWindow = $true
  $info.Environment.Clear()
  foreach ($key in $Environment.Keys) { [void]$info.Environment.Add($key, [string]$Environment[$key]) }
  $info.FileName = $File
  foreach ($argument in $Arguments) { [void]$info.ArgumentList.Add([string]$argument) }
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
  $watch = [Diagnostics.Stopwatch]::StartNew(); [void]$process.Start(); $out = $process.StandardOutput.ReadToEnd(); $err = $process.StandardError.ReadToEnd(); $process.WaitForExit(); $watch.Stop()
  $summary = ($out + "`n" + $err) -replace '(?i)postgres(?:ql)?://[^\s"''`]+', '[REDACTED_DATABASE_URL]'
  $summary = $summary -replace 'celebratedeal_wp89_[a-z0-9_]+', '[WP89_DISPOSABLE_DB]'
  $records.Add([ordered]@{ name = $Name; exit_code = $process.ExitCode; duration_ms = $watch.ElapsedMilliseconds; summary = $summary.Substring(0, [Math]::Min(400, $summary.Length)) }) | Out-Null
  if ($RequireSuccess -and $process.ExitCode -ne 0) { throw "$Name failed." }
  return [ordered]@{ exit_code = $process.ExitCode; stdout = $out }
}
function Invoke-Psql([string]$Name, [string]$DatabaseName, [string]$Sql, [Collections.IDictionary]$Environment, [bool]$RequireSuccess = $true) {
  if (-not $script:container) { throw "Pinned PostgreSQL 16 container unavailable." }
  Invoke-Child $Name (Get-Command docker -ErrorAction Stop).Source @("exec", "-e", "PGPASSWORD=postgres", $script:container, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", $DatabaseName, "-c", $Sql) $Environment $RequireSuccess
}
function Get-PreserveManifest {
  $rows = @(& git -C $root status --porcelain=v1 --untracked-files=all)
  $items = [Collections.Generic.List[string]]::new()
  foreach ($row in $rows) {
    if ($row.Length -lt 4) { throw "Unexpected git status row." }
    $path = $row.Substring(3).Replace("\", "/")
    if ($path -in $owned) { continue }
    if ($path -match '(^|/|\\)\.env') { throw "Sensitive environment path in dirty inventory." }
    $items.Add("$($row.Substring(0, 2)) $path") | Out-Null
  }
  return @($items | Sort-Object)
}
function Save-Receipt($Value) { [IO.File]::WriteAllText($receiptPath, ($Value | ConvertTo-Json -Depth 16), [Text.UTF8Encoding]::new($false)) }

$pre = @(); $post = @(); $migrationHashBefore = $null; $migrationHashAfter = $null; $cleanDrift = $false; $staleDriftRejected = $false; $cleanReadModel = $false; $staleReadModel = $false
try {
  if (@(& git -C $root diff --cached --name-only).Count -ne 0) { throw "Staged index is not empty." }
  foreach ($path in $owned) { if (-not (Test-Path -LiteralPath (Join-Path $root $path) -PathType Leaf)) { throw "Expected WP-89 owned path missing: $path" } }
  $pre = Get-PreserveManifest
  $migrationHashBefore = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
  $docker = (Get-Command docker -ErrorAction Stop).Source
  $containers = @(& $docker ps --filter 'ancestor=postgres:16-alpine' --format '{{.ID}}' | Where-Object { $_ -match '^[a-f0-9]{12,64}$' })
  if ($containers.Count -ne 1) { throw "Exactly one existing postgres:16-alpine container is required." }
  $container = $containers[0]
  $version = Invoke-Child "postgres-version" $docker @("exec", $container, "psql", "--version") (Get-SyntheticEnvironment "celebratedeal_wp89_${runId}_clean") $true
  if ($version.stdout -notmatch 'PostgreSQL\) 16\.') { throw "PostgreSQL major 16 required." }
  $cleanEnv = Get-SyntheticEnvironment $cleanDb; $staleEnv = Get-SyntheticEnvironment $staleDb
  Invoke-Psql "create-clean-db" "postgres" ("CREATE DATABASE {0};" -f $cleanDb) $cleanEnv; $cleanCreated = $true
  Invoke-Child "migrate-clean-db" (Get-Command npx.cmd -ErrorAction Stop).Source @("prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma") $cleanEnv $true | Out-Null
  Invoke-Child "drift-clean-db" (Get-Command node.exe -ErrorAction Stop).Source @("--import", "tsx", $driftFixture) $cleanEnv $true | Out-Null; $cleanDrift = $true
  Invoke-Child "read-model-clean-db" (Get-Command node.exe -ErrorAction Stop).Source @("--import", "tsx", $readModelFixture) $cleanEnv $true | Out-Null; $cleanReadModel = $true
  Invoke-Psql "create-stale-db" "postgres" ("CREATE DATABASE {0};" -f $staleDb) $staleEnv; $staleCreated = $true
  Invoke-Child "migrate-stale-db" (Get-Command npx.cmd -ErrorAction Stop).Source @("prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma") $staleEnv $true | Out-Null
  Invoke-Psql "remove-column-on-disposable-stale-db" $staleDb 'ALTER TABLE "PayoutItem" DROP COLUMN "bankAccountEncrypted";' $staleEnv
  $staleDrift = Invoke-Child "drift-stale-db-must-fail" (Get-Command node.exe -ErrorAction Stop).Source @("--import", "tsx", $driftFixture) $staleEnv $false
  if ($staleDrift.exit_code -eq 0) { throw "Stale schema drift detector did not fail closed." }; $staleDriftRejected = $true
  Invoke-Child "read-model-stale-db" (Get-Command node.exe -ErrorAction Stop).Source @("--import", "tsx", $readModelFixture) $staleEnv $true | Out-Null; $staleReadModel = $true
  $migrationHashAfter = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
  if ($migrationHashBefore -ne $migrationHashAfter) { throw "Canonical migration changed." }
  $status = "PASS"
} catch {
  $failure = $_.Exception.Message
} finally {
  try { if ($staleCreated) { Invoke-Psql "drop-stale-db" "postgres" ("DROP DATABASE IF EXISTS {0};" -f $staleDb) (Get-SyntheticEnvironment $staleDb) | Out-Null } } catch { $failure = "Stale disposable DB cleanup failed."; $status = "BLOCKED_OR_FAILED" }
  try { if ($cleanCreated) { Invoke-Psql "drop-clean-db" "postgres" ("DROP DATABASE IF EXISTS {0};" -f $cleanDb) (Get-SyntheticEnvironment $cleanDb) | Out-Null } } catch { $failure = "Clean disposable DB cleanup failed."; $status = "BLOCKED_OR_FAILED" }
  try { $post = Get-PreserveManifest; if (-not (Same $pre $post)) { $failure = "PRESERVE_ONLY inventory changed."; $status = "BLOCKED_OR_FAILED" } } catch { $failure = "Post-run ownership inventory failed."; $status = "BLOCKED_OR_FAILED" }
  Save-Receipt ([ordered]@{
    schema_version = 1; work_package = "WP-89"; workflow_mode = "PRELAUNCH_DEV"; status = $status
    database_boundary = "two disposable loopback PostgreSQL 16 databases only"; clean_drift_check = $cleanDrift; stale_drift_rejected = $staleDriftRejected
    clean_read_model = $cleanReadModel; stale_read_model_without_column = $staleReadModel; canonical_migration_unchanged = ($migrationHashBefore -eq $migrationHashAfter)
    existing_local_dev_migrated = $false; production_operation = $false; external_network_used = $false; environment_file_contents_read = $false
    ownership_pre = $pre; ownership_post = $post; staged_index_empty = (@(& git -C $root diff --cached --name-only).Count -eq 0); checks = @($records); failure = $failure
  })
}
if ($status -ne "PASS") { exit 1 }
Write-Output "WP-89 migration drift QA PASS"
