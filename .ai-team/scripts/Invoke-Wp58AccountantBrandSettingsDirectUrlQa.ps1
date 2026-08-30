[CmdletBinding()]
param([switch]$PreflightSelfTest)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$id = Get-Date -Format 'yyyyMMddHHmmssfff'
$schema = "wp58_$id"
$marker = "wp58:$id"
$temp = [IO.Path]::GetTempPath()
$snapshot = Join-Path $temp "CelebrateDeal-WP58-$id"
$runtime = Join-Path $temp "CelebrateDeal-WP58-runtime-$id"
$report = Join-Path $root ".ai-team\reports\wp-58-accountant-brand-settings-direct-url-$id"
$receipts = [Collections.Generic.List[object]]::new()
$schemaCreated = $false
$failure = $null

function Safe([string]$value) {
  if ($null -eq $value) { return '' }
  $safe = $value -replace '(?i)postgres(?:ql)?://\S+', '[REDACTED_DATABASE_URL]'
  $safe = $safe -replace '(?i)(token|secret|password|authorization)\s*[:=]\s*[^\s,;]+', '$1=[REDACTED]'
  return $safe -replace '(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[REDACTED_EMAIL]'
}

function Write-Json([string]$name, $value) {
  $value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $report $name) -Encoding utf8
}

function Get-Environment {
  $url = "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"
  return [ordered]@{
    PATH = $env:PATH
    SystemRoot = $env:SystemRoot
    ComSpec = $env:ComSpec
    PATHEXT = $env:PATHEXT
    NODE_ENV = 'test'
    CI = 'true'
    DATABASE_URL = $url
    DIRECT_URL = $url
    E2E_PORT = '31058'
    E2E_BASE_URL = 'http://127.0.0.1:31058'
    RATE_LIMIT_PROVIDER = 'memory'
    PAYMENT_PROVIDER = 'demo'
    SENTRY_DSN = ''
    NEXT_PUBLIC_SENTRY_DSN = ''
    SENTRY_AUTH_TOKEN = ''
    RESEND_API_KEY = ''
    EMAIL_FROM = ''
    SENTRY_DISABLE_AUTO_UPLOAD = 'true'
    PLAYWRIGHT_BROWSERS_PATH = (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'ms-playwright')
    PLAYWRIGHT_JSON_OUTPUT_FILE = (Join-Path $snapshot '.wp58-browser.json')
    TEMP = (Join-Path $runtime 'temp')
    TMP = (Join-Path $runtime 'tmp')
    HOME = (Join-Path $runtime 'home')
    USERPROFILE = (Join-Path $runtime 'home')
    NPM_CONFIG_CACHE = (Join-Path $runtime 'npm-cache')
  }
}

function Invoke-Child([string]$name, [string]$file, [string[]]$arguments, [hashtable]$environment) {
  $prior = @{}
  foreach ($key in $environment.Keys) {
    $prior[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, [string]$environment[$key], 'Process')
  }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $old = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $file @arguments 2>&1 | Out-String
    $code = $LASTEXITCODE
  } finally {
    $watch.Stop()
    $ErrorActionPreference = $old
    foreach ($key in $environment.Keys) {
      [Environment]::SetEnvironmentVariable($key, $prior[$key], 'Process')
    }
  }
  $receipts.Add([ordered]@{
    name = $name
    exit_code = $code
    duration_ms = $watch.ElapsedMilliseconds
    classification = if ($code -eq 0) { 'PASS' } else { 'FAIL' }
    sanitized_summary = (Safe $output)
  })
  return $code
}

function Preflight {
  if ($schema -notmatch '^wp58_[0-9]+$') { throw 'Invalid schema.' }
  if (@(git -C $root diff --cached --name-only).Count -ne 0) { throw 'Staged index must be empty.' }
  $status = @(git -C $root status --short)
  $owned = @(
    '?? .ai-team/scripts/Invoke-Wp58AccountantBrandSettingsDirectUrlQa.ps1',
    '?? tests/e2e/accountant-brand-settings-direct-url.spec.ts'
  )
  if (@($status | Where-Object { $_ -in $owned }).Count -ne 2) { throw 'WP-58 owned paths missing.' }
  if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port 54329 -InformationLevel Quiet)) { throw 'Local disposable DB unavailable.' }
  foreach ($contract in @(
    @('src/app/(app)/settings/brand/page.tsx', 'requireVendorManager'),
    @('src/app/(app)/settings/brand/page.tsx', 'saveBrandSettingsAction'),
    @('src/app/actions.ts', 'export async function saveBrandSettingsAction'),
    @('src/app/actions.ts', 'await assertServerActionSecurity(formData);'),
    @('src/app/actions.ts', 'const vendor = await requireVendorManager();'),
    @('src/app/actions.ts', 'where: { id: vendor.id }'),
    @('src/lib/auth.ts', '/dashboard?error=insufficient_role')
  )) {
    if (-not (Select-String -LiteralPath $contract[0] -Pattern $contract[1] -SimpleMatch -Quiet)) {
      throw "Source contract drift: $($contract[0])"
    }
  }
  $action = Get-Content -LiteralPath 'src/app/actions.ts' -Raw
  $start = $action.IndexOf('export async function saveBrandSettingsAction')
  if ($start -lt 0 -or
      $action.IndexOf('await assertServerActionSecurity(formData);', $start) -gt
      $action.IndexOf('const vendor = await requireVendorManager();', $start)) {
    throw 'Action guard order drift.'
  }
  return $status
}

if ($PreflightSelfTest) {
  $null = Preflight
  Write-Output 'WP-58 preflight PASS'
  exit 0
}

try {
  $baseline = Preflight
  New-Item -ItemType Directory -Force -Path $report, $snapshot, $runtime | Out-Null
  $excluded = @('.git', '.ai-team', '.next', 'node_modules', 'test-results')
  Get-ChildItem -LiteralPath $root -Force |
    Where-Object { $_.Name -notin $excluded -and $_.Name -notlike '.env*' } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $snapshot -Recurse -Force }
  New-Item -ItemType Junction -Path (Join-Path $snapshot 'node_modules') -Target (Join-Path $root 'node_modules') | Out-Null

  $config = Join-Path $snapshot 'playwright.config.ts'
  $configText = [IO.File]::ReadAllText($config).
    Replace('npx prisma generate && npx next build && npx next start --port ${port}', 'npx next build --webpack && npx next start --port ${port}').
    Replace('timeout: 120_000', 'timeout: 300_000')
  [IO.File]::WriteAllText($config, $configText, [Text.UTF8Encoding]::new($false))
  $run = Get-Environment
  New-Item -ItemType Directory -Force -Path $run.TEMP, $run.TMP, $run.HOME, $run.NPM_CONFIG_CACHE | Out-Null
  Push-Location $snapshot
  try {
    $node = (Get-Command node.exe).Source
    $prisma = 'node_modules/prisma/build/index.js'
    if ((Invoke-Child 'prisma-validate' $node @($prisma, 'validate') $run) -ne 0) { throw 'Prisma validation failed.' }
    $bootstrap = Join-Path $snapshot 'wp58-bootstrap.sql'
    [IO.File]::WriteAllText($bootstrap, "CREATE SCHEMA IF NOT EXISTS `"$schema`";`nCOMMENT ON SCHEMA `"$schema`" IS '$marker';", [Text.UTF8Encoding]::new($false))
    if ((Invoke-Child 'database-bootstrap' $node @($prisma, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', '.\wp58-bootstrap.sql') $run) -ne 0) { throw 'Bootstrap failed.' }
    $schemaCreated = $true
    if ((Invoke-Child 'migrate-deploy' $node @($prisma, 'migrate', 'deploy') $run) -ne 0) { throw 'Migrate deploy failed.' }
    if ((Invoke-Child 'migrate-status' $node @($prisma, 'migrate', 'status') $run) -ne 0) { throw 'Migrate status failed.' }
    if ((Invoke-Child 'spec-eslint' $node @('node_modules/eslint/bin/eslint.js', 'tests/e2e/accountant-brand-settings-direct-url.spec.ts') $run) -ne 0) { throw 'Lint failed.' }
    if ((Invoke-Child 'auth-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/auth.test.ts') $run) -ne 0) { throw 'Auth tests failed.' }
    if ((Invoke-Child 'browser-e2e' $node @('node_modules/@playwright/test/cli.js', 'test', 'tests/e2e/accountant-brand-settings-direct-url.spec.ts', '--project=chromium', '--retries=0', '--reporter=json') $run) -ne 0) { throw 'Browser gate failed.' }
    if ((Invoke-Child 'typecheck' $node @('node_modules/typescript/bin/tsc', '--noEmit') $run) -ne 0) { throw 'Typecheck failed.' }
  } finally {
    Pop-Location
  }
  $browser = Get-Content -LiteralPath $run.PLAYWRIGHT_JSON_OUTPUT_FILE -Raw | ConvertFrom-Json
  $verdict = [ordered]@{
    artifactType = 'browser-verdict'
    expected = [int]$browser.stats.expected
    unexpected = [int]$browser.stats.unexpected
    skipped = [int]$browser.stats.skipped
    flaky = [int]$browser.stats.flaky
    pass = ($browser.stats.expected -eq 1 -and $browser.stats.unexpected -eq 0 -and $browser.stats.skipped -eq 0 -and $browser.stats.flaky -eq 0)
  }
  Write-Json 'browser-verdict.sanitized.json' $verdict
  if (-not $verdict.pass) { throw 'Browser verdict failed.' }
  Write-Json 'db-invariant-summary.sanitized.json' ([ordered]@{
    artifactType = 'db-invariant'
    assertion = 'Spec compares the full vendor row and vendor count; it also records no post-login POST or non-loopback request.'
    result = 'UNCHANGED'
  })
} catch {
  $failure = Safe $_.Exception.Message
} finally {
  if ($schemaCreated) {
    try {
      $run = Get-Environment
      $cleanup = Join-Path $snapshot 'wp58-cleanup.sql'
      $sql = 'DO $$ BEGIN IF current_database() <> ''celebratedeal_ci'' THEN RAISE EXCEPTION ''database mismatch''; END IF; IF (SELECT obj_description(oid, ''pg_namespace'') FROM pg_namespace WHERE nspname = ''' + $schema + ''') <> ''' + $marker + ''' THEN RAISE EXCEPTION ''marker mismatch''; END IF; EXECUTE ''DROP SCHEMA "' + $schema + '" CASCADE''; END $$;'
      [IO.File]::WriteAllText($cleanup, $sql, [Text.UTF8Encoding]::new($false))
      Push-Location $snapshot
      try {
        $code = Invoke-Child 'database-cleanup' $node @($prisma, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', '.\wp58-cleanup.sql') $run
      } finally {
        Pop-Location
      }
      if ($code -ne 0) { throw 'Schema cleanup failed.' }
    } catch {
      if ($null -eq $failure) { $failure = Safe $_.Exception.Message }
    }
  }
  $postflight = @(git -C $root status --short)
  if (Test-Path $report) {
    Write-Json 'final-runner-summary.sanitized.json' ([ordered]@{
      artifactType = 'final-runner-summary'
      workPackage = 'WP-58'
      runId = $id
      finalRunnerError = $failure
      syntheticEnvironmentOnly = $true
      preflightStatus = $baseline
      postflightStatus = $postflight
      schemaCleanup = if ($schemaCreated) { 'ATTEMPTED' } else { 'NOT_CREATED' }
    })
    Write-Json 'command-receipts.sanitized.json' ([ordered]@{
      artifactType = 'command-receipts'
      workPackage = 'WP-58'
      receipts = @($receipts)
    })
  }
  if (Test-Path $snapshot) { Remove-Item -LiteralPath $snapshot -Recurse -Force }
  if (Test-Path $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
}

Write-Output "WP-58 report: $report"
if ($failure) { throw $failure }
