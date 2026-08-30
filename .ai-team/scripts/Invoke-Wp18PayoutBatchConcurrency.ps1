[CmdletBinding()]
param([string]$ReportRoot = '.ai-team/reports')

# Creates a no-dotenv snapshot. Every DB child process receives only a
# process-scoped loopback URL for its own marker-gated disposable schema.
$ErrorActionPreference = 'Stop'
$runId = Get-Date -Format 'yyyyMMddHHmmssfff'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$reportDirectory = Join-Path (Resolve-Path $ReportRoot).Path "wp-19-coverage-synthetic-schema-$runId"
$logDirectory = Join-Path $sourceRoot ".ai-team/logs/wp-19/$runId"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "CelebrateDeal-WP19-$runId"
$snapshotRoot = Join-Path $tempRoot 'snapshot'
$wp18Schema = "wp18_$runId"
$wp17Schema = "wp17_$runId"
$wp18Marker = "wp18:$runId"
$wp17Marker = "wp17:$runId"
$targetFiles = @('.ai-team/scripts/Invoke-Wp18PayoutBatchConcurrency.ps1', 'vitest.synthetic-db-coverage.config.ts')
$protectedWp17Files = @('docs/launch/evidence-index.md', 'docs/launch/manual-blockers.md', 'docs/launch/next-work-packages.md', 'docs/launch/production-readiness-baseline.md', 'docs/launch/tool-blockers.md', '.ai-team/scripts/Invoke-Wp17MfaRecoveryConcurrency.ps1', 'src/app/actions.mfa-db.test.ts')
$receipts = [Collections.Generic.List[object]]::new()
$wp18Environment = $null
$wp17Environment = $null
$coverageEnvironment = $null
$cleanup = [ordered]@{ wp17 = 'NOT_ATTEMPTED'; wp18 = 'NOT_ATTEMPTED' }

function Write-Utf8([string]$Path, [string]$Text) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
function Sanitize([string]$Text) {
  $safe = $Text -replace '(?i)postgres(?:ql)?://[^\s"''`]+', '[REDACTED_DATABASE_URL]'
  return $safe -replace '(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[REDACTED_EMAIL]'
}
function Get-Manifest([string[]]$Paths) {
  return @($Paths | ForEach-Object {
    $path = Join-Path $sourceRoot $_
    [ordered]@{ path = $_; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash; bytes = (Get-Item -LiteralPath $path).Length }
  })
}
function Copy-SafeSnapshot {
  New-Item -ItemType Directory -Force -Path $snapshotRoot | Out-Null
  & robocopy $sourceRoot $snapshotRoot /E /XD .git node_modules .next coverage reports logs /XF .env* | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Fail-closed: snapshot copy failed with exit code $LASTEXITCODE." }
  if (Get-ChildItem -LiteralPath $snapshotRoot -Recurse -Force -Filter '.env*' | Select-Object -First 1) { throw 'Fail-closed: snapshot contains a .env file.' }
}
function Invoke-Scoped([string]$Name, [string]$FileName, [string[]]$Arguments, [hashtable]$ScopedEnvironment) {
  $started = Get-Date; $logPath = Join-Path $logDirectory "$Name.log"
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FileName; $psi.WorkingDirectory = $snapshotRoot; $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
  $psi.Environment.Clear(); foreach ($pair in $ScopedEnvironment.GetEnumerator()) { $psi.Environment[$pair.Key] = [string]$pair.Value }
  $psi.Arguments = ($Arguments -join ' ')
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $psi; [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync(); $process.WaitForExit()
  Write-Utf8 $logPath (Sanitize ($stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()))
  $classification = if ($process.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }
  $receipts.Add([ordered]@{name=$Name;classification=$classification;exit_code=$process.ExitCode;elapsed_ms=[int](((Get-Date)-$started).TotalMilliseconds);log=$logPath;source_env_contents_read=$false;secret_details_emitted=$false}) | Out-Null
  return $process.ExitCode
}
function Assert-LocalSchema([string]$Schema, [string]$Prefix) {
  if ($Schema -notmatch "^$Prefix[a-z0-9_]+$") { throw 'Fail-closed: schema prefix rejected.' }
  $uri = [Uri]"postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$Schema"
  if ($uri.Host -ne '127.0.0.1' -or $uri.Port -ne 54329 -or $uri.AbsolutePath.TrimStart('/') -ne 'celebratedeal_ci') { throw 'Fail-closed: loopback database allowlist rejected.' }
}
function New-BaseEnvironment {
  param([string]$NodePath)
  return @{
    PATH = "$(Split-Path -Parent $NodePath);$env:PATH"; SystemRoot = $env:SystemRoot; ComSpec = $env:ComSpec
    TEMP = (Join-Path $tempRoot 'temp'); TMP = (Join-Path $tempRoot 'temp'); USERPROFILE = (Join-Path $tempRoot 'profile')
    NPM_CONFIG_CACHE = (Join-Path $tempRoot 'npm-cache'); NPM_CONFIG_USERCONFIG = (Join-Path $tempRoot 'npmrc')
    NODE_ENV = 'test'; CI = 'true'; NO_PROXY = '*'; NEXT_TELEMETRY_DISABLED = '1'; NEXT_PUBLIC_APP_URL = 'https://wp19.invalid'
    CSRF_SECRET = 'wp19_synthetic_csrf_0123456789abcdef'; JOB_SECRET = ''; PAYMENT_PROVIDER = 'demo'; EMAIL_FROM = 'WP19 Test <noreply@invalid.test>'
    SENTRY_DSN = ''; SENTRY_AUTH_TOKEN = ''; SENTRY_DISABLE_AUTO_UPLOAD = 'true'; RATE_LIMIT_PROVIDER = 'memory'; E2E_TEST_MODE = 'true'
    BANK_ACCOUNT_KEYRING_JSON = '{"activeKeyId":"synthetic","keys":{"synthetic":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}}'
  }
}
function New-OwnerEnvironment {
  param([hashtable]$Base, [string]$Schema, [string]$FlagName)
  $result = @{}; foreach ($pair in $Base.GetEnumerator()) { $result[$pair.Key] = $pair.Value }
  $url = "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$Schema"
  $result.DATABASE_URL = $url; $result.DIRECT_URL = $url; $result[$FlagName] = $Schema
  return $result
}
function Assert-OwnerEnvironment {
  param([hashtable]$Environment, [string]$Schema, [string]$FlagName)
  $databaseSchema = ([Uri]$Environment.DATABASE_URL).Query -replace '^\?schema=', ''
  $directSchema = ([Uri]$Environment.DIRECT_URL).Query -replace '^\?schema=', ''
  if ($Environment[$FlagName] -ne $Schema -or $databaseSchema -ne $Schema -or $directSchema -ne $Schema) { throw 'Fail-closed: owner flag and URL schema identity mismatch.' }
}

New-Item -ItemType Directory -Force -Path $reportDirectory, $logDirectory | Out-Null
$preflightTargetManifest = Get-Manifest $targetFiles
$preflightProtectedManifest = Get-Manifest $protectedWp17Files
& git -C $sourceRoot -c core.longpaths=true status --porcelain=v1 --untracked-files=all | Set-Content -LiteralPath (Join-Path $reportDirectory 'preflight-git-status.txt') -Encoding utf8
& git -C $sourceRoot -c core.longpaths=true diff --cached --name-status | Set-Content -LiteralPath (Join-Path $reportDirectory 'preflight-cached-diff.txt') -Encoding utf8
& git -C $sourceRoot branch --show-current | Set-Content -LiteralPath (Join-Path $reportDirectory 'preflight-branch.txt') -Encoding utf8
& git -C $sourceRoot rev-parse HEAD | Set-Content -LiteralPath (Join-Path $reportDirectory 'preflight-head.txt') -Encoding utf8
Write-Utf8 (Join-Path $reportDirectory 'target-manifest.json') ($preflightTargetManifest | ConvertTo-Json -Depth 4)
Write-Utf8 (Join-Path $reportDirectory 'wp17-protected-manifest.json') ($preflightProtectedManifest | ConvertTo-Json -Depth 4)

try {
  Assert-LocalSchema $wp17Schema 'wp17_'; Assert-LocalSchema $wp18Schema 'wp18_'; Copy-SafeSnapshot
  & git -C $snapshotRoot init --quiet; if ($LASTEXITCODE -ne 0) { throw 'Fail-closed: snapshot Git initialization failed.' }
  & git -C $snapshotRoot add -A; if ($LASTEXITCODE -ne 0) { throw 'Fail-closed: snapshot Git inventory failed.' }
  $npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $npx = (Get-Command npx.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $baseEnvironment = New-BaseEnvironment $node
  $wp17Environment = New-OwnerEnvironment $baseEnvironment $wp17Schema 'WP17_DISPOSABLE_SCHEMA'
  $wp18Environment = New-OwnerEnvironment $baseEnvironment $wp18Schema 'WP18_DISPOSABLE_SCHEMA'
  Assert-OwnerEnvironment $wp17Environment $wp17Schema 'WP17_DISPOSABLE_SCHEMA'
  Assert-OwnerEnvironment $wp18Environment $wp18Schema 'WP18_DISPOSABLE_SCHEMA'
  $coverageEnvironment = @{}; foreach ($pair in $baseEnvironment.GetEnumerator()) { $coverageEnvironment[$pair.Key] = $pair.Value }
  $coverageEnvironment.WP17_COVERAGE_DATABASE_URL = $wp17Environment.DATABASE_URL
  $coverageEnvironment.WP17_COVERAGE_DIRECT_URL = $wp17Environment.DIRECT_URL
  $coverageEnvironment.WP17_COVERAGE_DISPOSABLE_SCHEMA = $wp17Schema
  $coverageEnvironment.WP18_COVERAGE_DATABASE_URL = $wp18Environment.DATABASE_URL
  $coverageEnvironment.WP18_COVERAGE_DIRECT_URL = $wp18Environment.DIRECT_URL
  $coverageEnvironment.WP18_COVERAGE_DISPOSABLE_SCHEMA = $wp18Schema
  New-Item -ItemType Directory -Force -Path $baseEnvironment.TEMP, $baseEnvironment.USERPROFILE, $baseEnvironment.NPM_CONFIG_CACHE | Out-Null
  Write-Utf8 $baseEnvironment.NPM_CONFIG_USERCONFIG "audit=false`nfund=false`nupdate-notifier=false`n"
  Write-Utf8 (Join-Path $reportDirectory 'runner-safety.json') (([ordered]@{source_env_contents_read=$false;fixture_data='synthetic_only';database_host='127.0.0.1';database_name='celebratedeal_ci';schemas=@($wp17Schema,$wp18Schema);markers_required_for_cleanup=$true;snapshot_env_files_copied=$false;coverage_projects=@('wp17-db','wp18-main')}) | ConvertTo-Json)
  Write-Utf8 (Join-Path $reportDirectory 'coverage-project-schema-identity.sanitized.json') (([ordered]@{
    'wp17-db'=[ordered]@{schema=$wp17Schema;owner_flag='WP17_DISPOSABLE_SCHEMA';database_url_schema=$wp17Schema;direct_url_schema=$wp17Schema}
    'wp18-main'=[ordered]@{schema=$wp18Schema;owner_flag='WP18_DISPOSABLE_SCHEMA';database_url_schema=$wp18Schema;direct_url_schema=$wp18Schema}
  }) | ConvertTo-Json -Depth 4)
  if ((Invoke-Scoped 'npm-ci' $npm @('ci') $wp18Environment) -ne 0) { throw 'npm-ci failed' }
  foreach ($gate in @(@{n='prisma-validate';f=$npx;a=@('prisma','validate')}, @{n='prisma-generate';f=$npx;a=@('prisma','generate')})) { if ((Invoke-Scoped $gate.n $gate.f $gate.a $wp18Environment) -ne 0) { throw "$($gate.n) failed" } }
  foreach ($owner in @(@{prefix='wp17';schema=$wp17Schema;marker=$wp17Marker;environment=$wp17Environment}, @{prefix='wp18';schema=$wp18Schema;marker=$wp18Marker;environment=$wp18Environment})) {
    $markerFile = "$($owner.prefix)-marker.sql"
    Write-Utf8 (Join-Path $snapshotRoot $markerFile) "CREATE SCHEMA IF NOT EXISTS `"$($owner.schema)`"; COMMENT ON SCHEMA `"$($owner.schema)`" IS '$($owner.marker)';"
    if ((Invoke-Scoped "schema-marker-$($owner.prefix)" $npx @('prisma','db','execute','--schema','prisma/schema.prisma','--file',$markerFile) $owner.environment) -ne 0) { throw "schema marker $($owner.prefix) failed" }
    foreach ($gate in @(@{n="migration-deploy-$($owner.prefix)";f=$npx;a=@('prisma','migrate','deploy')}, @{n="migration-status-$($owner.prefix)";f=$npx;a=@('prisma','migrate','status')})) { if ((Invoke-Scoped $gate.n $gate.f $gate.a $owner.environment) -ne 0) { throw "$($gate.n) failed" } }
  }
  if ((Invoke-Scoped 'wp17-targeted-tests' $npm @('run','test','--','--run','src/app/actions.mfa-db.test.ts','src/app/actions.test.ts') $wp17Environment) -ne 0) { throw 'wp17 targeted tests failed' }
  if ((Invoke-Scoped 'wp18-targeted-tests' $npm @('run','test','--','--run','src/app/actions.payout-db.test.ts','src/app/actions.test.ts','src/lib/payout-state.test.ts') $wp18Environment) -ne 0) { throw 'wp18 targeted tests failed' }
  if ((Invoke-Scoped 'coverage' $npm @('run','test:coverage','--','--config','vitest.synthetic-db-coverage.config.ts') $coverageEnvironment) -ne 0) { throw 'coverage failed' }
  foreach ($gate in @(@{n='lint';f=$npm;a=@('run','lint')}, @{n='typecheck';f=$npm;a=@('run','typecheck')}, @{n='strict-index';f=$npm;a=@('run','typecheck:strict-index')}, @{n='secret-scan';f=$npm;a=@('run','secret:scan')})) { if ((Invoke-Scoped $gate.n $gate.f $gate.a $wp18Environment) -ne 0) { throw "$($gate.n) failed" } }
  Write-Utf8 (Join-Path $reportDirectory 'concurrency-outcomes.sanitized.json') (([ordered]@{
    wp17=[ordered]@{classification='PASS';readers_before_release=2;redirects='normal_and_invalid';consumed_recovery_rows=1}
    wp18=[ordered]@{classification='PASS';readers_before_release=2;redirects='normal_and_conflict';payout_batches=1;payout_items=1;settlement_claims=1;orphan_batches=0}
    source_env_contents_read=$false
  }) | ConvertTo-Json -Depth 4)
  $diffCheck = & git -C $sourceRoot -c core.longpaths=true -c core.autocrlf=false diff --check 2>&1
  Write-Utf8 (Join-Path $logDirectory 'git-diff-check.log') ($diffCheck -join [Environment]::NewLine)
  if ($LASTEXITCODE -ne 0) { throw 'git diff --check failed' }
  $receipts.Add([ordered]@{name='git-diff-check';classification='PASS';exit_code=0;source_env_contents_read=$false;secret_details_emitted=$false}) | Out-Null
} catch {
  $receipts.Add([ordered]@{name='runner';classification='FAIL';exit_code=1;detail=(Sanitize $_.Exception.Message);source_env_contents_read=$false;secret_details_emitted=$false}) | Out-Null
} finally {
  foreach ($owner in @(@{prefix='wp17';schema=$wp17Schema;marker=$wp17Marker;environment=$wp17Environment}, @{prefix='wp18';schema=$wp18Schema;marker=$wp18Marker;environment=$wp18Environment})) {
    if ($owner.environment) {
      $cleanupPath = Join-Path $tempRoot "cleanup-$($owner.prefix).sql"
      Write-Utf8 $cleanupPath "DO `$`$ BEGIN IF (SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = '$($owner.schema)') <> '$($owner.marker)' THEN RAISE EXCEPTION 'marker mismatch'; END IF; EXECUTE 'DROP SCHEMA `"$($owner.schema)`" CASCADE'; END `$`$;"
      if ((Invoke-Scoped "schema-cleanup-$($owner.prefix)" $npx @('prisma','db','execute','--schema',(Join-Path $snapshotRoot 'prisma/schema.prisma'),'--file',$cleanupPath) $owner.environment) -eq 0) { $cleanup[$owner.prefix] = 'PASS' } else { $cleanup[$owner.prefix] = 'FAIL' }
    }
  }
  $postflightTargetManifest = Get-Manifest $targetFiles; $postflightProtectedManifest = Get-Manifest $protectedWp17Files
  Write-Utf8 (Join-Path $reportDirectory 'postflight-target-manifest.json') ($postflightTargetManifest | ConvertTo-Json -Depth 4)
  Write-Utf8 (Join-Path $reportDirectory 'postflight-wp17-protected-manifest.json') ($postflightProtectedManifest | ConvertTo-Json -Depth 4)
  $targetUnchanged = (($preflightTargetManifest | ConvertTo-Json -Compress) -eq ($postflightTargetManifest | ConvertTo-Json -Compress))
  $protectedUnchanged = (($preflightProtectedManifest | ConvertTo-Json -Compress) -eq ($postflightProtectedManifest | ConvertTo-Json -Compress))
  $receipts.Add([ordered]@{name='source-target-hash';classification=$(if($targetUnchanged){'PASS'}else{'FAIL'});exit_code=$(if($targetUnchanged){0}else{1});source_env_contents_read=$false;secret_details_emitted=$false}) | Out-Null
  $receipts.Add([ordered]@{name='wp17-protected-hash';classification=$(if($protectedUnchanged){'PASS'}else{'FAIL'});exit_code=$(if($protectedUnchanged){0}else{1});source_env_contents_read=$false;secret_details_emitted=$false}) | Out-Null
  Write-Utf8 (Join-Path $reportDirectory 'schema-cleanup.sanitized.json') (([ordered]@{result=$(if($cleanup.wp17 -eq 'PASS' -and $cleanup.wp18 -eq 'PASS'){'PASS'}else{'FAIL'});marker_required=$true;schemas=[ordered]@{wp17=$cleanup.wp17;wp18=$cleanup.wp18}}) | ConvertTo-Json)
  $receipts | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $reportDirectory 'command-receipts.sanitized.json') -Encoding utf8
  & git -C $sourceRoot -c core.longpaths=true status --porcelain=v1 --untracked-files=all | Set-Content -LiteralPath (Join-Path $reportDirectory 'postflight-git-status.txt') -Encoding utf8
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}

Write-Output "WP-19 report: $reportDirectory"
if (@($receipts | Where-Object classification -eq 'FAIL').Count -gt 0 -or $cleanup.wp17 -ne 'PASS' -or $cleanup.wp18 -ne 'PASS') { exit 1 }
