[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssfff")
$sourceDb = "celebratedeal_wp87_${runId}_source"
$restoreDb = "celebratedeal_wp87_${runId}_restore"
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$backupPath = Join-Path $tempRoot "celebratedeal-wp87-$runId.backup"
$containerBackupPath = "/tmp/celebratedeal_wp87_${runId}_source.dump"
$containerRestorePath = "/tmp/celebratedeal_wp87_${runId}_restore.dump"
$receiptPath = Join-Path $root ".ai-team\reports\wp87-g2-recovery-receipt.json"
$fixturePath = "tests/recovery/wp87-logical-forward-recovery.ts"
$owned = @(".ai-team/scripts/Invoke-Wp87G2RecoveryQa.ps1", $fixturePath, ".ai-team/reports/wp87-g2-recovery-receipt.json", "docs/ai-team/evidence/wp-87-g2-recovery-rehearsal.md")
$receipts = [Collections.Generic.List[object]]::new()
$status = "BLOCKED"
$failure = $null
$sourceCreated = $false; $restoreCreated = $false
$backupDuration = 0; $restoreDuration = 0; $forwardDuration = 0
$docker = $null; $pg16Container = $null

function Get-Sha([string]$Value) {
  $hash = [Security.Cryptography.SHA256]::Create()
  try { ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "") }
  finally { $hash.Dispose() }
}
function Quote-ProcessArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ($Value -replace '(\\*)"', '$1$1\\"') + '"'
}
function Test-DeniedPath([string]$Path) {
  foreach ($part in ($Path -split "[\\/]")) { if ($part.StartsWith(".env", [StringComparison]::OrdinalIgnoreCase) -or $part -match '(?i)\.(pem|key|pfx|p12|crt)$') { return $true } }
  return $false
}
function Get-PreserveManifest {
  $rows = @(& git -C $root status --porcelain=v1 --untracked-files=all)
  $list = foreach ($row in $rows) {
    if ($row.Length -lt 4) { throw "Unexpected git status row." }
    $path = $row.Substring(3).Replace("\\", "/")
    if ($path -in $owned) { continue }
    if (Test-DeniedPath $path) { throw "Dirty sensitive path blocks WP-87 inventory." }
    $full = Join-Path $root $path
    $sha = if (Test-Path -LiteralPath $full -PathType Leaf) { (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash } else { "NON_LEAF_OR_DELETED" }
    [ordered]@{ status = $row.Substring(0, 2); path = $path; sha256 = $sha }
  }
  @($list | Sort-Object path,status)
}
function Get-SyntheticEnvironment([string]$DatabaseName) {
  $url = "postgresql://postgres:postgres@127.0.0.1:54329/${DatabaseName}?schema=public"
  [ordered]@{
    PATH=$env:PATH; SystemRoot=$env:SystemRoot; ComSpec=$env:ComSpec; PATHEXT=$env:PATHEXT
    DATABASE_URL=$url; DIRECT_URL=$url; NODE_ENV="test"; CI=""; PGPASSWORD="postgres"; PGHOST="127.0.0.1"; PGPORT="54329"; PGUSER="postgres"; PSQLRC=""
    HOME=(Join-Path $tempRoot "wp87-home-$runId"); USERPROFILE=(Join-Path $tempRoot "wp87-home-$runId"); NPM_CONFIG_OFFLINE="true"
  }
}
function Invoke-Child([string]$Name, [string]$File, [string[]]$ArgumentList, [Collections.IDictionary]$Environment, [switch]$Capture) {
  $info = [Diagnostics.ProcessStartInfo]::new(); $info.WorkingDirectory=$root; $info.UseShellExecute=$false; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true; $info.CreateNoWindow=$true; $info.Environment.Clear()
  foreach ($key in $Environment.Keys) { [void]$info.Environment.Add($key, [string]$Environment[$key]) }
  $joinedArguments = (($ArgumentList | ForEach-Object { Quote-ProcessArgument ([string]$_) }) -join ' ')
  if ($File.EndsWith(".cmd", [StringComparison]::OrdinalIgnoreCase)) {
    $info.FileName=$env:ComSpec; $info.Arguments="/d /c `"$File`" $joinedArguments"
  } else {
    $info.FileName=$File
    foreach ($argument in $ArgumentList) { [void]$info.ArgumentList.Add([string]$argument) }
  }
  $process=[Diagnostics.Process]::new(); $process.StartInfo=$info; $watch=[Diagnostics.Stopwatch]::StartNew(); [void]$process.Start(); $out=$process.StandardOutput.ReadToEnd(); $err=$process.StandardError.ReadToEnd(); $process.WaitForExit(); $watch.Stop()
  $summary = ($out+"`n"+$err) -replace '(?i)postgres(?:ql)?://[^\s"''`]+', '[REDACTED_DATABASE_URL]'
  $summary = $summary -replace 'celebratedeal_wp87_[a-z0-9_]+', '[WP87_DISPOSABLE_DB]'
  if ($Name -like 'fingerprint-*') { $summary = '[ROW_CONTENT_REDACTED; HASH_ONLY]' }
  $receipts.Add([ordered]@{name=$Name;exit_code=$process.ExitCode;duration_ms=$watch.ElapsedMilliseconds;classification=if($process.ExitCode -eq 0){"PASS"}else{"FAIL"};sanitized_summary=$summary.Substring(0,[Math]::Min(500,$summary.Length))}) | Out-Null
  if ($process.ExitCode -ne 0) { throw "$Name failed." }
  if ($Capture) { return $out }
}
function Invoke-Psql([string]$Name,[string]$Database,[string]$Sql,[Collections.IDictionary]$Environment,[switch]$Capture) {
  if (-not $script:pg16Container) { throw "Pinned PostgreSQL 16 container is unavailable." }
  Invoke-Child -Name $Name -File $script:docker -ArgumentList @("exec","-e","PGPASSWORD=postgres",$script:pg16Container,"psql","-U","postgres","-X","-v","ON_ERROR_STOP=1","-A","-t","-q","-d",$Database,"-c",$Sql) -Environment $Environment -Capture:$Capture
}
function Invoke-Pg16Tool([string]$Name,[string]$Tool,[string[]]$ToolArgs,[Collections.IDictionary]$Environment,[switch]$Capture) {
  Invoke-Child -Name $Name -File $script:docker -ArgumentList (@("exec","-e","PGPASSWORD=postgres",$script:pg16Container,$Tool) + $ToolArgs) -Environment $Environment -Capture:$Capture
}
function Get-Fingerprint([string]$Database,[Collections.IDictionary]$Environment) {
  $tableLines = @((Invoke-Psql "fingerprint-tables-$Database" $Database "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name;" $Environment -Capture) -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
  $tables = foreach ($table in $tableLines) {
    if ($table -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw "Unsafe application table name." }
    $rows = @((Invoke-Psql "fingerprint-rows-$Database-$table" $Database ("SELECT to_jsonb(t)::text FROM public.`"{0}`" t ORDER BY to_jsonb(t)::text;" -f $table) $Environment -Capture) -split "`r?`n" | Where-Object { $_.Length -gt 0 })
    [ordered]@{ table=$table; row_count=$rows.Count; canonical_row_sha256=(Get-Sha ($rows -join "`n")) }
  }
  $migrations = @((Invoke-Psql "fingerprint-migrations-$Database" $Database 'SELECT to_jsonb(m)::text FROM public."_prisma_migrations" m ORDER BY to_jsonb(m)::text;' $Environment -Capture) -split "`r?`n" | Where-Object { $_.Length -gt 0 })
  $sequences = @((Invoke-Psql "fingerprint-sequences-$Database" $Database "SELECT sequencename || ':' || COALESCE(last_value::text,'') FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename;" $Environment -Capture) -split "`r?`n" | Where-Object { $_.Length -gt 0 })
  $fks = @((Invoke-Psql "fingerprint-fks-$Database" $Database "SELECT conname || ':' || convalidated::text FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace ORDER BY conname;" $Environment -Capture) -split "`r?`n" | Where-Object { $_.Length -gt 0 })
  [ordered]@{ application_table_count=@($tables).Count; tables=@($tables); migrations_sha256=(Get-Sha ($migrations -join "`n")); sequences_sha256=(Get-Sha ($sequences -join "`n")); sequence_count=@($sequences).Count; foreign_key_invariants=[ordered]@{constraint_count=@($fks).Count;validated_sha256=(Get-Sha ($fks -join "`n"))} }
}
function Same($A,$B) { (($A | ConvertTo-Json -Depth 12 -Compress) -eq ($B | ConvertTo-Json -Depth 12 -Compress)) }
function Save-Receipt($Data) { [IO.File]::WriteAllText($receiptPath, ($Data | ConvertTo-Json -Depth 14), [Text.UTF8Encoding]::new($false)) }

$pre = @(); $post = @(); $t0Source=$null; $t0Restore=$null; $t1Source=$null; $t1Restore=$null; $t1Second=$null; $backupHash=$null; $backupSize=0; $backupList=$false
try {
  if (@(& git -C $root diff --cached --name-only).Count -ne 0) { throw "Staged index is not empty." }
  # Terra's preflight proved these create-only paths were absent before this
  # WP. By runner time they must be exactly the four reviewed WP-owned files.
  foreach ($path in $owned) { if (-not (Test-Path -LiteralPath (Join-Path $root $path) -PathType Leaf)) { throw "Expected WP-87 owned path is missing." } }
  $pre = Get-PreserveManifest
  $envSource=Get-SyntheticEnvironment $sourceDb; $envRestore=Get-SyntheticEnvironment $restoreDb
  if ($sourceDb -notmatch '^celebratedeal_wp87_[0-9]+_source$' -or $restoreDb -notmatch '^celebratedeal_wp87_[0-9]+_restore$') { throw "Disposable DB name rejected." }
  foreach ($binary in @("node","npx","docker")) { if (-not (Get-Command $binary -ErrorAction SilentlyContinue)) { throw "Required local binary unavailable." } }
  $docker=(Get-Command docker -ErrorAction Stop).Source
  $containers=@(& $docker ps --filter 'ancestor=postgres:16-alpine' --format '{{.ID}}' | Where-Object { $_ -match '^[a-f0-9]{12,64}$' })
  if ($containers.Count -ne 1) { throw "Exactly one existing PostgreSQL 16 container is required." }
  $pg16Container=$containers[0]
  $versions=@(Invoke-Pg16Tool "pg16-toolchain-version" "psql" @("--version") (Get-SyntheticEnvironment "postgres") -Capture)
  if (($versions -join '') -notmatch 'PostgreSQL\) 16\.') { throw "Pinned container psql is not major 16." }
  foreach($tool in @("pg_dump","pg_restore")){ $v=@(Invoke-Pg16Tool "pg16-$tool-version" $tool @("--version") (Get-SyntheticEnvironment "postgres") -Capture); if(($v -join '') -notmatch 'PostgreSQL\) 16\.'){ throw "Pinned container toolchain is not major 16." } }
  Invoke-Psql "create-source" "postgres" ("CREATE DATABASE {0};" -f $sourceDb) $envSource; $sourceCreated=$true
  $npx=(Get-Command npx.cmd -ErrorAction Stop).Source; $node=(Get-Command node.exe -ErrorAction Stop).Source
  Invoke-Child -Name "prisma-migrate-source" -File $npx -ArgumentList @("prisma","migrate","deploy","--schema","prisma/schema.prisma") -Environment $envSource
  Invoke-Child -Name "fixture-eslint" -File $node -ArgumentList @("node_modules/eslint/bin/eslint.js",$fixturePath) -Environment $envSource
  Invoke-Child -Name "fixture-baseline" -File $node -ArgumentList @("--import","tsx",$fixturePath,"baseline") -Environment $envSource
  $t0Source=Get-Fingerprint $sourceDb $envSource
  $watch=[Diagnostics.Stopwatch]::StartNew(); Invoke-Pg16Tool "backup" "pg_dump" @("--username","postgres","--format=custom","--no-owner","--no-privileges","--file",$containerBackupPath,"--dbname",$sourceDb) $envSource; $watch.Stop(); $backupDuration=$watch.ElapsedMilliseconds
  Invoke-Child -Name "archive-export" -File $docker -ArgumentList @("cp","$pg16Container`:$containerBackupPath",$backupPath) -Environment $envSource
  Invoke-Pg16Tool "archive-source-remove" "rm" @("-f",$containerBackupPath) $envSource
  if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) { throw "Backup missing." }; $backupSize=(Get-Item -LiteralPath $backupPath).Length; if ($backupSize -le 0) { throw "Backup is empty." }; $backupHash=(Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
  Invoke-Child -Name "archive-import" -File $docker -ArgumentList @("cp",$backupPath,"$pg16Container`:$containerRestorePath") -Environment $envSource
  $null=Invoke-Pg16Tool "backup-list" "pg_restore" @("--list",$containerRestorePath) $envSource -Capture; $backupList=$true
  Invoke-Child -Name "source-journal" -File $node -ArgumentList @("--import","tsx",$fixturePath,"journal") -Environment $envSource; $t1Source=Get-Fingerprint $sourceDb $envSource
  Invoke-Psql "create-restore" "postgres" ("CREATE DATABASE {0};" -f $restoreDb) $envRestore; $restoreCreated=$true
  $watch=[Diagnostics.Stopwatch]::StartNew(); Invoke-Pg16Tool "restore" "pg_restore" @("--username","postgres","--exit-on-error","--no-owner","--no-privileges","--dbname",$restoreDb,$containerRestorePath) $envRestore; $watch.Stop(); $restoreDuration=$watch.ElapsedMilliseconds
  $t0Restore=Get-Fingerprint $restoreDb $envRestore; if (-not (Same $t0Source $t0Restore)) { throw "T0 restore fingerprint mismatch." }
  $watch=[Diagnostics.Stopwatch]::StartNew(); Invoke-Child -Name "restore-journal" -File $node -ArgumentList @("--import","tsx",$fixturePath,"journal") -Environment $envRestore; $watch.Stop(); $forwardDuration=$watch.ElapsedMilliseconds
  $t1Restore=Get-Fingerprint $restoreDb $envRestore; if (-not (Same $t1Source $t1Restore)) { throw "T1 forward recovery fingerprint mismatch." }
  Invoke-Child -Name "restore-journal-second-replay" -File $node -ArgumentList @("--import","tsx",$fixturePath,"journal") -Environment $envRestore; $t1Second=Get-Fingerprint $restoreDb $envRestore; if (-not (Same $t1Restore $t1Second)) { throw "Second journal replay is not idempotent." }
  $status="PASS"
} catch {
  $failure=$_.Exception.Message
  $status = if ($failure -eq "restore failed.") { "TOOL_BLOCKED" } else { "BLOCKED_OR_FAILED" }
} finally {
  try { if ($pg16Container) { Invoke-Pg16Tool "container-archive-cleanup" "rm" @("-f",$containerBackupPath,$containerRestorePath) (Get-SyntheticEnvironment "postgres") } } catch { $failure="Cleanup container archive failed."; $status="BLOCKED_OR_FAILED" }
  try { if ($restoreCreated) { $envRestore=Get-SyntheticEnvironment $restoreDb; Invoke-Psql "drop-restore" "postgres" ("DROP DATABASE IF EXISTS {0};" -f $restoreDb) $envRestore } } catch { $failure="Cleanup restore failed."; $status="BLOCKED_OR_FAILED" }
  try { if ($sourceCreated) { $envSource=Get-SyntheticEnvironment $sourceDb; Invoke-Psql "drop-source" "postgres" ("DROP DATABASE IF EXISTS {0};" -f $sourceDb) $envSource } } catch { $failure="Cleanup source failed."; $status="BLOCKED_OR_FAILED" }
  try { if (Test-Path -LiteralPath $backupPath) { Remove-Item -LiteralPath $backupPath -Force } } catch { $failure="Cleanup backup failed."; $status="BLOCKED_OR_FAILED" }
  $post=Get-PreserveManifest; if (-not (Same $pre $post)) { $failure="PRESERVE_ONLY inventory changed."; $status="BLOCKED_OR_FAILED" }
  $record=[ordered]@{work_package="WP-87";workflow_mode="PRELAUNCH_DEV";status=$status;recovery_mode="LOGICAL_FORWARD_REPLAY";toolchain_mode="DOCKER_EXEC_SAME_SERVER_CONTAINER";database_host_class="LOOPBACK_ONLY";fixture_chain_count=3;application_table_count=if($t0Source){$t0Source.application_table_count}else{0};backup_sha256=$backupHash;backup_size_bytes=$backupSize;backup_list_parse=$backupList;t0_fingerprint_match=(Same $t0Source $t0Restore);t1_forward_recovery_match=(Same $t1Source $t1Restore);second_replay_idempotent=(Same $t1Restore $t1Second);foreign_key_invariants=if($t1Restore){$t1Restore.foreign_key_invariants}else{$null};sequence_match=if($t1Restore -and $t1Source){$t1Source.sequences_sha256 -eq $t1Restore.sequences_sha256}else{$false};backup_duration_ms=$backupDuration;restore_duration_ms=$restoreDuration;forward_replay_duration_ms=$forwardDuration;cleanup=[ordered]@{source=$sourceCreated;restore=$restoreCreated;backup_removed=(-not (Test-Path -LiteralPath $backupPath))};ownership_pre=$pre;ownership_post=$post;staged_index_empty=(@(& git -C $root diff --cached --name-only).Count -eq 0);external_network_used=$false;production_resource_used=$false;environment_file_contents_read=$false;docker_pull_used=$false;container_restarted=$false;container_environment_read=$false;host_postgres_client_used=$false;archive_exported_to_local_temp=$backupList;limitations=@("LOGICAL_FORWARD_REPLAY only; not WAL/PITR or production recovery.");deterministic_checks=@($receipts);failure=$failure}
  Save-Receipt $record
}
if ($status -ne "PASS") { exit 1 }
Write-Output "WP-87 G2 recovery rehearsal PASS"
