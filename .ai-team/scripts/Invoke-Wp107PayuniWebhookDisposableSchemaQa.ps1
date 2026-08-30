[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmssfff')
$nonce = -join (1..8 | ForEach-Object { ('{0:x}' -f (Get-Random -Maximum 16)) })
$schema = "wp107_${runId}_${nonce}"
$schemaMarker = "wp107:${runId}:$nonce"
$tempRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) "celebratedeal-wp107-$runId"))
$tempMarker = '.wp107-temp-marker'
$mirror = Join-Path $tempRoot 'mirror'
$receiptPath = Join-Path $root '.ai-team\reports\wp107-payuni-webhook-disposable-schema-receipt.json'
$suite = @(
  'src/app/api/webhooks/payments/route.test.ts',
  'src/lib/payment-webhooks.test.ts',
  'src/lib/payment-webhook-invariants.test.ts',
  'src/lib/payment-providers/payuni.test.ts',
  'scripts/payuni-sandbox-external-qa.test.mjs',
  'scripts/payuni-sandbox-payment-handoff.test.mjs'
)
$preservePaths = @('prisma/schema.prisma') + @((Get-ChildItem -LiteralPath (Join-Path $root 'prisma\migrations') -Recurse -File | ForEach-Object { $_.FullName.Substring($root.Length + 1).Replace('\','/') })) + $suite
$checks = [Collections.Generic.List[object]]::new()
$schemaCreated = $false
$tempCreated = $false
$status = 'BLOCKED_OR_FAILED'
$failureCategory = 'unknown'
$failure = $null
$container = $null

function Test-SameJson($left, $right) { (($left | ConvertTo-Json -Depth 32 -Compress) -eq ($right | ConvertTo-Json -Depth 32 -Compress)) }
function Quote-ProcessArgument([string]$value) {
  if ($value -notmatch '[\s"]') { return $value }
  return '"' + ($value -replace '(\\*)"', '$1$1\\"') + '"'
}
function Get-FileHashMap([string[]]$paths) {
  $map = [ordered]@{}
  foreach ($path in $paths) {
    $stream = [IO.File]::OpenRead((Join-Path $root $path))
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { $map[$path] = ([BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')).ToLowerInvariant() }
    finally { $sha256.Dispose(); $stream.Dispose() }
  }
  return $map
}
function Get-PreserveManifest {
  $rows = @(& git -C $root status --porcelain=v1 --untracked-files=all)
  return @($rows | ForEach-Object { $_.Replace('\','/') } | Sort-Object)
}
function Get-SyntheticEnvironment([string]$databaseUrl) {
  [ordered]@{
    PATH = $env:PATH; SystemRoot = $env:SystemRoot; ComSpec = $env:ComSpec; PATHEXT = $env:PATHEXT
    TEMP = (Join-Path $tempRoot 'tmp'); TMP = (Join-Path $tempRoot 'tmp'); HOME = (Join-Path $tempRoot 'home'); USERPROFILE = (Join-Path $tempRoot 'home')
    NODE_ENV = 'test'; CI = 'true'; DATABASE_URL = $databaseUrl; DIRECT_URL = $databaseUrl
    NPM_CONFIG_OFFLINE = 'true'; NPM_CONFIG_UPDATE_NOTIFIER = 'false'; PSQLRC = ''
  }
}
function Invoke-Child([string]$name, [string]$file, [string[]]$arguments, [Collections.IDictionary]$environment, [string]$workingDirectory, [bool]$requireSuccess = $true) {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.WorkingDirectory = $workingDirectory; $info.UseShellExecute = $false; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true; $info.CreateNoWindow = $true
  $info.Environment.Clear()
  foreach ($key in $environment.Keys) { [void]$info.Environment.Add($key, [string]$environment[$key]) }
  $info.FileName = $file
  $info.Arguments = (($arguments | ForEach-Object { Quote-ProcessArgument ([string]$_) }) -join ' ')
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
  $watch = [Diagnostics.Stopwatch]::StartNew(); [void]$process.Start()
  # Drain both streams concurrently: Docker can keep one pipe open while flushing the other.
  $stdoutTask = $process.StandardOutput.ReadToEndAsync(); $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit(); [Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask)); $stdout = $stdoutTask.Result; $stderr = $stderrTask.Result; $watch.Stop()
  $safeSummary = ("$stdout`n$stderr" -replace [regex]::Escape($schema), '[WP107_SCHEMA]' -replace [regex]::Escape(($tempRoot -replace '\\','/')), '[WP107_TEMP_ROOT]' -replace '(?i)postgres(?:ql)?://[^\s"''`]+', '[REDACTED_DATABASE_URL]').Trim()
  $checks.Add([ordered]@{ name = $name; exit_code = $process.ExitCode; duration_ms = $watch.ElapsedMilliseconds; detail = $safeSummary.Substring(0, [Math]::Min(280, $safeSummary.Length)) }) | Out-Null
  if ($requireSuccess -and $process.ExitCode -ne 0) { throw "$name failed." }
  return [ordered]@{ exit_code = $process.ExitCode; stdout = $stdout; stderr = $stderr }
}
function Invoke-Psql([string]$name, [string]$sql, [Collections.IDictionary]$environment, [bool]$requireSuccess = $true) {
  if (-not $script:container) { throw 'PostgreSQL container unavailable.' }
  return Invoke-Child $name (Get-Command docker -ErrorAction Stop).Source @('exec','-e','PGPASSWORD=postgres',$script:container,'psql','-U','postgres','-X','-v','ON_ERROR_STOP=1','-A','-t','-q','-d','celebratedeal_ci','-c',$sql) $environment $root $requireSuccess
}
function Save-Receipt($value) {
  $dir = Split-Path -Parent $receiptPath
  [IO.Directory]::CreateDirectory($dir) | Out-Null
  [IO.File]::WriteAllText($receiptPath, ($value | ConvertTo-Json -Depth 32), [Text.UTF8Encoding]::new($false))
}
function Remove-OwnedTemp {
  if (-not $tempCreated) { return 'NOT_CREATED' }
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $leaf = Split-Path -Leaf $tempRoot
  $markerPath = Join-Path $tempRoot $tempMarker
  if (-not $tempRoot.StartsWith("$parent\", [StringComparison]::OrdinalIgnoreCase)) { return 'BOUNDARY_MISMATCH' }
  if ($leaf -notmatch '^celebratedeal-wp107-[0-9]{17}$') { return 'LEAF_MISMATCH' }
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { return 'MARKER_MISSING' }
  if ([IO.File]::ReadAllText($markerPath, [Text.UTF8Encoding]::new($false)) -ne $schemaMarker) { return 'MARKER_MISMATCH' }
  Remove-Item -LiteralPath $tempRoot -Recurse -Force
  return 'PASS'
}

$preManifest = @(); $postManifest = @(); $hashBefore = [ordered]@{}; $hashAfter = [ordered]@{}
$suiteResult = [ordered]@{ files = 0; passed = 0; failed = 0; skipped = 0 }
$catalog = [ordered]@{ column = $false; index = $false; migrations = $false; pgcrypto = $false }
$schemaCleanup = 'NOT_CREATED'; $tempCleanup = 'NOT_CREATED'
$primaryFailure = $null; $cleanupFailure = $null
try {
  if ($schema -notmatch '^wp107_[0-9]{17}_[a-f0-9]{8}$') { throw 'Generated schema name rejected.' }
  if (@(& git -C $root diff --cached --name-only).Count -ne 0) { throw 'Staged index is not empty.' }
  $preManifest = Get-PreserveManifest
  $hashBefore = Get-FileHashMap $preservePaths
  $docker = (Get-Command docker -ErrorAction Stop).Source
  $containers = @(& $docker ps --filter 'ancestor=postgres:16-alpine' --format '{{.ID}}' | Where-Object { $_ -match '^[a-f0-9]{12,64}$' })
  if ($containers.Count -ne 1) { throw 'Exactly one existing PostgreSQL 16 container is required.' }
  $container = $containers[0]
  $databaseUrl = "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"
  $environment = Get-SyntheticEnvironment $databaseUrl
  if (Test-Path -LiteralPath $tempRoot) { throw 'Generated temp root collision detected.' }
  [IO.Directory]::CreateDirectory($tempRoot) | Out-Null
  $markerPath = Join-Path $tempRoot $tempMarker
  [IO.File]::WriteAllText($markerPath, $schemaMarker, [Text.UTF8Encoding]::new($false))
  if ([IO.File]::ReadAllText($markerPath, [Text.UTF8Encoding]::new($false)) -ne $schemaMarker) { throw 'Temp marker round-trip verification failed.' }
  $tempCreated = $true
  [IO.Directory]::CreateDirectory((Join-Path $tempRoot 'tmp')) | Out-Null; [IO.Directory]::CreateDirectory((Join-Path $tempRoot 'home')) | Out-Null
  $version = Invoke-Child 'postgres-version' $docker @('exec',$container,'psql','--version') $environment $root
  if ($version.stdout -notmatch 'PostgreSQL\) 16\.') { throw 'PostgreSQL major 16 is required.' }
  $pgcrypto = Invoke-Psql 'pgcrypto-preflight' "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto');" $environment
  if ($pgcrypto.stdout.Trim() -ne 't') { throw 'pgcrypto is unavailable; refusing database-global extension mutation.' }
  $catalog.pgcrypto = $true
  if ((Invoke-Psql 'schema-must-not-exist' "SELECT COUNT(*) FROM pg_namespace WHERE nspname = '$schema';" $environment).stdout.Trim() -ne '0') { throw 'Disposable schema collision detected.' }
  # $schema is generated from a strict lowercase/underscore allowlist, so unquoted
  # identifiers avoid Windows command-line quote escaping while staying injection-safe.
  Invoke-Psql 'schema-bootstrap' "CREATE SCHEMA $schema; COMMENT ON SCHEMA $schema IS '$schemaMarker';" $environment | Out-Null; $schemaCreated = $true

  [IO.Directory]::CreateDirectory($mirror) | Out-Null
  $robocopy = (Get-Command robocopy.exe -ErrorAction Stop).Source
  $copy = & $robocopy $root $mirror /E /R:0 /W:0 /XD '.git' 'node_modules' '.ai-team' /XF '.env' '.env.*'
  if ($LASTEXITCODE -gt 7) { throw 'Temp mirror copy failed.' }
  New-Item -ItemType Junction -Path (Join-Path $mirror 'node_modules') -Target (Join-Path $root 'node_modules') | Out-Null

  $npx = (Join-Path $mirror 'node_modules\.bin\prisma.cmd')
  $vitest = (Join-Path $mirror 'node_modules\.bin\vitest.cmd')
  if (-not (Test-Path -LiteralPath $npx) -or -not (Test-Path -LiteralPath $vitest)) { throw 'Required local Prisma/Vitest binaries unavailable.' }
  Invoke-Child 'prisma-validate' $npx @('validate','--schema','prisma/schema.prisma') $environment $mirror | Out-Null
  Invoke-Child 'prisma-generate' $npx @('generate','--schema','prisma/schema.prisma') $environment $mirror | Out-Null
  Invoke-Child 'prisma-migrate-deploy' $npx @('migrate','deploy','--schema','prisma/schema.prisma') $environment $mirror | Out-Null
  $migrationStatus = Invoke-Child 'prisma-migrate-status' $npx @('migrate','status','--schema','prisma/schema.prisma') $environment $mirror
  if ($migrationStatus.stdout -notmatch '13 migrations found in prisma/migrations') { throw 'Canonical migration count is not 13.' }
  $catalogResult = Invoke-Psql 'catalog-assertions' @"
SELECT CASE WHEN
  (SELECT is_nullable = 'NO' AND data_type = 'text' FROM information_schema.columns WHERE table_schema = '$schema' AND table_name = 'AffiliateCommission' AND column_name = 'deduplicationKey')
  AND (SELECT is_nullable = 'NO' FROM information_schema.columns WHERE table_schema = '$schema' AND table_name = 'AffiliateCommission' AND column_name = 'vendorId')
  AND (SELECT i.indisunique AND array_to_string(ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.ord), ',') = 'vendorId,deduplicationKey' FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='$schema' AND c.relname='AffiliateCommission_vendorId_deduplicationKey_key')
THEN 'PASS' ELSE 'FAIL' END;
"@ $environment
  if ($catalogResult.stdout.Trim() -ne 'PASS') { throw 'Canonical AffiliateCommission column/index assertions failed.' }
  $catalog.column = $true; $catalog.index = $true; $catalog.migrations = $true
  $suiteRun = Invoke-Child 'wp106-six-file-suite' $vitest (@('run') + $suite) $environment $mirror $false
  $text = "$($suiteRun.stdout)`n$($suiteRun.stderr)"
  $plainText = $text -replace '\x1B\[[0-?]*[ -/]*[@-~]', ''
  $match = [regex]::Match($plainText, 'Test Files\s+([0-9]+) passed.*?Tests\s+([0-9]+) passed', [Text.RegularExpressions.RegexOptions]::Singleline)
  if ($match.Success) { $suiteResult.files = [int]$match.Groups[1].Value; $suiteResult.passed = [int]$match.Groups[2].Value }
  if ($plainText -match '([0-9]+) failed') { $suiteResult.failed = [int]$Matches[1] }
  if ($plainText -match '([0-9]+) skipped') { $suiteResult.skipped = [int]$Matches[1] }
  if ($suiteRun.exit_code -ne 0 -or $suiteResult.files -ne 6 -or $suiteResult.passed -ne 109 -or $suiteResult.failed -ne 0 -or $suiteResult.skipped -ne 0) { throw 'WP-106 six-file deterministic suite did not reach 109/109.' }
  $hashAfter = Get-FileHashMap $preservePaths
  if (-not (Test-SameJson $hashBefore $hashAfter)) { throw 'PRESERVE_ONLY schema, migration, or suite hash changed.' }
  $status = 'PASS'; $failureCategory = 'none'
} catch {
  $primaryFailure = $_.Exception.Message; $failure = $primaryFailure
  if ($failure -match 'schema|migration|column|index') { $failureCategory = 'schema-or-migration' }
  elseif ($failure -match 'suite') { $failureCategory = 'deterministic-suite' }
  elseif ($failure -match 'container|PostgreSQL|pgcrypto') { $failureCategory = 'local-toolchain' }
  else { $failureCategory = 'preflight-or-runner' }
} finally {
  try {
    if ($schemaCreated) {
      $cleanupEnvironment = Get-SyntheticEnvironment "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"
      if ((Invoke-Psql 'schema-cleanup-marker' "SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') = '$schemaMarker' FROM pg_namespace WHERE nspname = '$schema';" $cleanupEnvironment).stdout.Trim() -ne 't') { throw 'Schema cleanup marker mismatch.' }
      Invoke-Psql 'schema-cleanup' "DROP SCHEMA $schema CASCADE;" $cleanupEnvironment | Out-Null
      $verify = Invoke-Psql 'schema-cleanup-verify' "SELECT COUNT(*) FROM pg_namespace WHERE nspname = '$schema';" (Get-SyntheticEnvironment "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema")
      if ($verify.stdout.Trim() -ne '0') { throw 'Schema cleanup verification failed.' }; $schemaCleanup = 'PASS'
    }
  } catch { $schemaCleanup = 'FAIL'; $cleanupFailure = 'Marker-owned schema cleanup failed.'; $status = 'BLOCKED_OR_FAILED'; if (-not $primaryFailure) { $failure = $cleanupFailure; $failureCategory = 'cleanup' } }
  try { $tempCleanup = Remove-OwnedTemp; if ($tempCleanup -ne 'PASS' -and $tempCleanup -ne 'NOT_CREATED') { throw 'Temp cleanup marker mismatch.' } } catch { $tempCleanup = 'FAIL'; $cleanupFailure = 'Marker-owned temp cleanup failed.'; $status = 'BLOCKED_OR_FAILED'; if (-not $primaryFailure) { $failure = $cleanupFailure; $failureCategory = 'cleanup' } }
  try { $postManifest = Get-PreserveManifest; if (-not (Test-SameJson $preManifest $postManifest)) { $status = 'BLOCKED_OR_FAILED'; $failure = 'PRESERVE_ONLY inventory changed.'; $failureCategory = 'ownership' } } catch { $status = 'BLOCKED_OR_FAILED'; $failure = 'Post-run ownership inventory failed.'; $failureCategory = 'ownership' }
  try { $hashAfter = Get-FileHashMap $preservePaths } catch { $hashAfter = [ordered]@{} }
  Save-Receipt ([ordered]@{ schemaVersion = 'celebratedeal-ai-team-wp107/v1'; workPackage = 'WP-107'; status = $status; failureCategory = $failureCategory; externalSideEffects = $false; environmentFileContentsRead = $false; sandboxPaymentCreated = $false; disposableBoundary = '127.0.0.1:54329/celebratedeal_ci marker-owned schema only'; migrationCount = if($catalog.migrations){13}else{0}; catalog = $catalog; suite = $suiteResult; schemaCleanup = $schemaCleanup; tempCleanup = $tempCleanup; stagedIndexEmpty = (@(& git -C $root diff --cached --name-only).Count -eq 0); preserveManifestUnchanged = (Test-SameJson $preManifest $postManifest); preserveHashesUnchanged = (Test-SameJson $hashBefore $hashAfter); checks = @($checks); primaryFailure = $primaryFailure; cleanupFailure = $cleanupFailure; failure = $failure })
}
if ($status -ne 'PASS') { exit 1 }
Write-Output 'WP-107 disposable webhook schema QA PASS'
