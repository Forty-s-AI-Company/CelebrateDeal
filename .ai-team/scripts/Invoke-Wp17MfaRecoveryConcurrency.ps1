[CmdletBinding()]
param([string]$ReportRoot = '.ai-team/reports')

# This runner creates a disposable, no-dotenv snapshot and never contacts a
# deployed database. It leaves failed evidence in place and only removes a
# schema after its run-specific marker is verified.
$ErrorActionPreference = 'Stop'
$runId = Get-Date -Format 'yyyyMMddHHmmssfff'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$reportDirectory = Join-Path (Resolve-Path $ReportRoot).Path "wp-17-mfa-recovery-concurrency-$runId"
$logDirectory = Join-Path $sourceRoot ".ai-team/logs/wp-17/$runId"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "CelebrateDeal-WP17-$runId"
$snapshotRoot = Join-Path $tempRoot 'snapshot'
$schema = "wp17_$runId"
$marker = "wp17:$runId"
$targetFiles = @('src/app/actions.mfa-db.test.ts', '.ai-team/scripts/Invoke-Wp17MfaRecoveryConcurrency.ps1')
$receipts = [Collections.Generic.List[object]]::new()
$environment = $null
$cleanup = 'NOT_ATTEMPTED'

function Write-Utf8([string]$Path, [string]$Text) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Sanitize([string]$Text) {
  $safe = $Text -replace '(?i)postgres(?:ql)?://[^\s"''`]+', '[REDACTED_DATABASE_URL]'
  $safe = $safe -replace '(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[REDACTED_EMAIL]'
  return $safe
}

function Get-TargetManifest {
  return @($targetFiles | ForEach-Object {
    $path = Join-Path $sourceRoot $_
    [ordered]@{ path = $_; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash; bytes = (Get-Item -LiteralPath $path).Length }
  })
}

function Copy-SafeSnapshot {
  New-Item -ItemType Directory -Force -Path $snapshotRoot | Out-Null
  # robocopy excludes these directories before descending into them. A generic
  # Get-ChildItem -Recurse filter would still enumerate node_modules first.
  & robocopy $sourceRoot $snapshotRoot /E /XD .git node_modules .next coverage reports logs /XF .env* | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Fail-closed: snapshot copy failed with exit code $LASTEXITCODE." }
  if (Get-ChildItem -LiteralPath $snapshotRoot -Recurse -Force -Filter '.env*' | Select-Object -First 1) {
    throw 'Fail-closed: snapshot contains a .env file.'
  }
}

function Invoke-Scoped([string]$Name, [string]$FileName, [string[]]$Arguments, [hashtable]$ScopedEnvironment) {
  try {
    $started = Get-Date
    $logPath = Join-Path $logDirectory "$Name.log"
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FileName; $psi.WorkingDirectory = $snapshotRoot
    $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
    $psi.Environment.Clear()
    foreach ($pair in $ScopedEnvironment.GetEnumerator()) { $psi.Environment[$pair.Key] = [string]$pair.Value }
    # Windows PowerShell's ProcessStartInfo can expose a null ArgumentList;
    # these runner arguments are fixed tokens without whitespace, so use the
    # broadly compatible Arguments string instead.
    $psi.Arguments = ($Arguments -join ' ')
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $psi; [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync(); $process.WaitForExit()
    Write-Utf8 $logPath (Sanitize ($stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()))
    $classification = if ($process.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }
    $receipts.Add([ordered]@{ name=$Name; classification=$classification; exit_code=$process.ExitCode; elapsed_ms=[int](((Get-Date)-$started).TotalMilliseconds); log=$logPath; source_env_contents_read=$false; secret_details_emitted=$false }) | Out-Null
    return $process.ExitCode
  } catch {
    Write-Utf8 (Join-Path $logDirectory "$Name.runner-error.log") ("line=$($_.InvocationInfo.ScriptLineNumber); message=" + $_.Exception.Message)
    throw
  }
}

function Assert-LocalSchema {
  if ($schema -notmatch '^wp17_[a-z0-9_]+$') { throw 'Fail-closed: schema prefix rejected.' }
  $uri = [Uri]"postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"
  if ($uri.Host -ne '127.0.0.1' -or $uri.Port -ne 54329 -or $uri.AbsolutePath.TrimStart('/') -ne 'celebratedeal_ci') { throw 'Fail-closed: loopback database allowlist rejected.' }
}

New-Item -ItemType Directory -Force -Path $reportDirectory, $logDirectory | Out-Null
$preflightManifest = Get-TargetManifest
& git -C $sourceRoot -c core.longpaths=true status --porcelain=v1 --untracked-files=all | Set-Content -LiteralPath (Join-Path $reportDirectory 'preflight-git-status.txt') -Encoding utf8
& git -C $sourceRoot -c core.longpaths=true diff --cached --name-status | Set-Content -LiteralPath (Join-Path $reportDirectory 'preflight-cached-diff.txt') -Encoding utf8
& git -C $sourceRoot branch --show-current | Set-Content -LiteralPath (Join-Path $reportDirectory 'preflight-branch.txt') -Encoding utf8
& git -C $sourceRoot rev-parse HEAD | Set-Content -LiteralPath (Join-Path $reportDirectory 'preflight-head.txt') -Encoding utf8
Write-Utf8 (Join-Path $reportDirectory 'target-manifest.json') ($preflightManifest | ConvertTo-Json -Depth 4)

try {
  Assert-LocalSchema
  Copy-SafeSnapshot
  & git -C $snapshotRoot init --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Fail-closed: snapshot Git initialization failed.' }
  & git -C $snapshotRoot add -A
  if ($LASTEXITCODE -ne 0) { throw 'Fail-closed: snapshot Git inventory failed.' }
  $npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $npx = (Get-Command npx.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $environment = @{
    PATH = "$(Split-Path -Parent $node);$env:PATH"; SystemRoot = $env:SystemRoot; ComSpec = $env:ComSpec
    TEMP = (Join-Path $tempRoot 'temp'); TMP = (Join-Path $tempRoot 'temp'); USERPROFILE = (Join-Path $tempRoot 'profile')
    NPM_CONFIG_CACHE = (Join-Path $tempRoot 'npm-cache'); NPM_CONFIG_USERCONFIG = (Join-Path $tempRoot 'npmrc')
    DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"; DIRECT_URL = "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"
    WP17_DISPOSABLE_SCHEMA = $schema; NODE_ENV = 'test'; CI = 'true'; NO_PROXY = '*'; NEXT_TELEMETRY_DISABLED = '1'; NEXT_PUBLIC_APP_URL = 'https://wp17.invalid'
    CSRF_SECRET = 'wp17_synthetic_csrf_0123456789abcdef'; JOB_SECRET = ''; PAYMENT_PROVIDER = 'demo'; EMAIL_FROM = 'WP17 Test <noreply@invalid.test>'
    SENTRY_DSN = ''; SENTRY_AUTH_TOKEN = ''; SENTRY_DISABLE_AUTO_UPLOAD = 'true'; RATE_LIMIT_PROVIDER = 'memory'; E2E_TEST_MODE = 'true'
    BANK_ACCOUNT_KEYRING_JSON = '{"activeKeyId":"synthetic","keys":{"synthetic":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}}'
  }
  New-Item -ItemType Directory -Force -Path $environment.TEMP, $environment.USERPROFILE, $environment.NPM_CONFIG_CACHE | Out-Null
  Write-Utf8 $environment.NPM_CONFIG_USERCONFIG "audit=false`nfund=false`nupdate-notifier=false`n"
  Write-Utf8 (Join-Path $reportDirectory 'runner-safety.json') (([ordered]@{ source_env_contents_read=$false; fixture_data='synthetic_only'; database_host='127.0.0.1'; database_name='celebratedeal_ci'; schema=$schema; schema_prefix='wp17_'; marker_required_for_cleanup=$true; snapshot_env_files_copied=$false }) | ConvertTo-Json)
  $gates = @(
    @{n='npm-ci'; f=$npm; a=@('ci')}, @{n='prisma-validate'; f=$npx; a=@('prisma','validate')}, @{n='prisma-generate'; f=$npx; a=@('prisma','generate')}
  )
  foreach ($gate in $gates) { if ((Invoke-Scoped $gate.n $gate.f $gate.a $environment) -ne 0) { throw "$($gate.n) failed" } }
  Write-Utf8 (Join-Path $snapshotRoot 'wp17-marker.sql') "CREATE SCHEMA IF NOT EXISTS `"$schema`"; COMMENT ON SCHEMA `"$schema`" IS '$marker';"
  if ((Invoke-Scoped 'schema-marker' $npx @('prisma','db','execute','--schema','prisma/schema.prisma','--file','wp17-marker.sql') $environment) -ne 0) { throw 'schema marker failed' }
  $gates = @(
    @{n='migration-deploy'; f=$npx; a=@('prisma','migrate','deploy')}, @{n='migration-status'; f=$npx; a=@('prisma','migrate','status')},
    @{n='targeted-tests'; f=$npm; a=@('run','test','--','--run','src/app/actions.mfa-db.test.ts','src/app/actions.test.ts')}, @{n='lint'; f=$npm; a=@('run','lint')},
    @{n='typecheck'; f=$npm; a=@('run','typecheck')}, @{n='strict-index'; f=$npm; a=@('run','typecheck:strict-index')}, @{n='coverage'; f=$npm; a=@('run','test:coverage')}, @{n='secret-scan'; f=$npm; a=@('run','secret:scan')}
  )
  foreach ($gate in $gates) { if ((Invoke-Scoped $gate.n $gate.f $gate.a $environment) -ne 0) { throw "$($gate.n) failed" } }
  # Avoid Windows autocrlf warning text becoming a terminating PowerShell
  # error record; this remains the same read-only whitespace validation.
  $diffCheck = & git -C $sourceRoot -c core.longpaths=true -c core.autocrlf=false diff --check 2>&1
  Write-Utf8 (Join-Path $logDirectory 'git-diff-check.log') ($diffCheck -join [Environment]::NewLine)
  if ($LASTEXITCODE -ne 0) { throw 'git diff --check failed' }
  $receipts.Add([ordered]@{name='git-diff-check';classification='PASS';exit_code=0;source_env_contents_read=$false;secret_details_emitted=$false}) | Out-Null
} catch {
  $receipts.Add([ordered]@{name='runner';classification='FAIL';exit_code=1;detail=(Sanitize $_.Exception.Message);source_env_contents_read=$false;secret_details_emitted=$false}) | Out-Null
} finally {
  if ($environment) {
    $cleanupPath = Join-Path $tempRoot 'cleanup.sql'
    Write-Utf8 $cleanupPath "DO `$`$ BEGIN IF (SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = '$schema') <> '$marker' THEN RAISE EXCEPTION 'marker mismatch'; END IF; EXECUTE 'DROP SCHEMA `"$schema`" CASCADE'; END `$`$;"
    if ((Invoke-Scoped 'schema-cleanup' $npx @('prisma','db','execute','--schema',(Join-Path $snapshotRoot 'prisma/schema.prisma'),'--file',$cleanupPath) $environment) -eq 0) { $cleanup = 'PASS' } else { $cleanup = 'FAIL' }
  }
  $postflightManifest = Get-TargetManifest
  Write-Utf8 (Join-Path $reportDirectory 'postflight-target-manifest.json') ($postflightManifest | ConvertTo-Json -Depth 4)
  $unchanged = (($preflightManifest | ConvertTo-Json -Compress) -eq ($postflightManifest | ConvertTo-Json -Compress))
  $receipts.Add([ordered]@{name='source-target-hash';classification=$(if($unchanged){'PASS'}else{'FAIL'});exit_code=$(if($unchanged){0}else{1});source_env_contents_read=$false;secret_details_emitted=$false}) | Out-Null
  Write-Utf8 (Join-Path $reportDirectory 'schema-cleanup.sanitized.json') (([ordered]@{result=$cleanup;marker_required=$true;schema=$schema}) | ConvertTo-Json)
  $receipts | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $reportDirectory 'command-receipts.sanitized.json') -Encoding utf8
  & git -C $sourceRoot -c core.longpaths=true status --porcelain=v1 --untracked-files=all | Set-Content -LiteralPath (Join-Path $reportDirectory 'postflight-git-status.txt') -Encoding utf8
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}

Write-Output "WP-17 report: $reportDirectory"
if (@($receipts | Where-Object classification -eq 'FAIL').Count -gt 0 -or $cleanup -ne 'PASS') { exit 1 }
