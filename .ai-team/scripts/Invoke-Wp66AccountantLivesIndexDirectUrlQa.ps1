[CmdletBinding()]
param([switch]$PreflightSelfTest)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$id = Get-Date -Format 'yyyyMMddHHmmssfff'
$schema = "wp66_$id"
$marker = "wp66:$id"
$temp = [IO.Path]::GetTempPath()
$snapshot = Join-Path $temp "CelebrateDeal-WP66-$id"
$runtime = Join-Path $temp "CelebrateDeal-WP66-runtime-$id"
$report = Join-Path $root ".ai-team\reports\wp-66-accountant-lives-index-direct-url-$id"
$receipts = [Collections.Generic.List[object]]::new()
$schemaCreated = $false
$failure = $null
$baselineStatus = @()
$preserveManifest = @()
$ownedManifest = @()

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
    E2E_PORT = '31066'
    E2E_BASE_URL = 'http://127.0.0.1:31066'
    RATE_LIMIT_PROVIDER = 'memory'
    PAYMENT_PROVIDER = 'demo'
    SENTRY_DSN = ''
    NEXT_PUBLIC_SENTRY_DSN = ''
    SENTRY_AUTH_TOKEN = ''
    RESEND_API_KEY = ''
    EMAIL_FROM = ''
    SENTRY_DISABLE_AUTO_UPLOAD = 'true'
    PLAYWRIGHT_BROWSERS_PATH = (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'ms-playwright')
    PLAYWRIGHT_JSON_OUTPUT_FILE = (Join-Path $snapshot '.wp66-browser.json')
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
  $oldPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $file @arguments 2>&1 | Out-String
    $code = $LASTEXITCODE
  } finally {
    $watch.Stop()
    $ErrorActionPreference = $oldPreference
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

function Get-OwnedPaths {
  return @(
    '.ai-team/scripts/Invoke-Wp66AccountantLivesIndexDirectUrlQa.ps1',
    'src/app/(app)/dashboard/page.tsx',
    'src/lib/dashboard-checklist.ts',
    'src/lib/dashboard-checklist.test.ts',
    'tests/e2e/accountant-lives-index-direct-url.spec.ts'
  )
}

function Get-Manifest([string[]]$status, [bool]$owned) {
  $ownedPaths = Get-OwnedPaths
  return @($status | ForEach-Object {
    $relative = $_.Substring(3).Replace('\', '/')
    $isOwned = $relative -in $ownedPaths
    if ($isOwned -eq $owned) {
      $full = Join-Path $root $relative
      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Manifest path missing: $relative" }
      [ordered]@{ path = $relative; sha256 = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash }
    }
  })
}

function Assert-SourceContract {
  $page = Get-Content -LiteralPath 'src/app/(app)/lives/page.tsx' -Raw
  $guard = $page.IndexOf('const vendor = await requireVendorManager();')
  $query = $page.IndexOf('getDb().live.findMany')
  $render = $page.IndexOf('<PageHeader title="直播間管理"', $query)
  if ($guard -lt 0 -or $query -lt $guard -or $render -lt $query) {
    throw 'Lives index guard/query/render order drift.'
  }
  foreach ($required in @(
    'where: { vendorId: vendor.id }',
    'orderBy: { scheduledAt: "desc" }',
    'include: { video: true, form: true, products: true }',
    'href="/lives/new"',
    'href={`/lives/${live.id}/edit`}',
    'href={`/lives/${live.id}/preview`}',
    'href={`/lives/${live.id}/analytics`}',
    '/live/{live.slug}'
  )) {
    if (-not $page.Contains($required)) { throw "Lives index contract drift: $required" }
  }

  $shell = Get-Content -LiteralPath 'src/components/app-shell.tsx' -Raw
  foreach ($required in @(
    '{ href: "/lives", label: "直播間", icon: Radio, managerOnly: true }',
    '{ href: "/videos", label: "影片", icon: PlaySquare, managerOnly: true }',
    '{ href: "/products", label: "商品", icon: Boxes, managerOnly: true }',
    '{ href: "/messages/templates", label: "訊息模板", icon: Bell, managerOnly: true }'
  )) {
    if (-not $shell.Contains($required)) { throw "Manager navigation contract drift: $required" }
  }

  $dashboard = Get-Content -LiteralPath 'src/app/(app)/dashboard/page.tsx' -Raw
  foreach ($required in @(
    'const isManager = isDashboardManagerRole(auth.member?.role ?? null);',
    'action={isManager ? <ButtonLink href="/lives/new"',
    '{isManager ? <ButtonLink href="/lives" tone="secondary">查看全部</ButtonLink> : null}',
    'return isManager ? (',
    'href={`/lives/${live.id}/analytics`}',
    '{isManager ? (',
    '<Link href="/lives/new"'
  )) {
    if (-not $dashboard.Contains($required)) { throw "Dashboard live affordance contract drift: $required" }
  }

  $checklist = Get-Content -LiteralPath 'src/lib/dashboard-checklist.ts' -Raw
  foreach ($required in @(
    'export function isDashboardManagerRole(memberRole: string | null)',
    'return memberRole !== null && MANAGER_ROLES.has(memberRole);',
    'const isManager = isDashboardManagerRole(memberRole);'
  )) {
    if (-not $checklist.Contains($required)) { throw "Dashboard manager-role helper drift: $required" }
  }

  $checklistTest = Get-Content -LiteralPath 'src/lib/dashboard-checklist.test.ts' -Raw
  foreach ($required in @(
    'identifies %s as a dashboard manager',
    'does not identify non-manager role %s as a dashboard manager',
    'dashboardChecklistForRole'
  )) {
    if (-not $checklistTest.Contains($required)) { throw "Dashboard manager-role tests drift: $required" }
  }
}

function Preflight {
  if ($schema -notmatch '^wp66_[0-9]+$') { throw 'Invalid schema.' }
  if (@(git -C $root diff --cached --name-only).Count -ne 0) { throw 'Staged index must be empty.' }
  $status = @(git -C $root status --short)
  $ownedStatus = @(
    '?? .ai-team/scripts/Invoke-Wp66AccountantLivesIndexDirectUrlQa.ps1',
    ' M src/app/(app)/dashboard/page.tsx',
    '?? src/lib/dashboard-checklist.ts',
    '?? src/lib/dashboard-checklist.test.ts',
    '?? tests/e2e/accountant-lives-index-direct-url.spec.ts'
  )
  if (@($status | Where-Object { $_ -in $ownedStatus }).Count -ne 5) { throw 'WP-66 owned paths missing.' }
  if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port 54329 -InformationLevel Quiet)) {
    throw 'Local disposable DB unavailable.'
  }
  Assert-SourceContract
  return $status
}

if ($PreflightSelfTest) {
  $null = Preflight
  Write-Output 'WP-66 preflight PASS'
  exit 0
}

try {
  $baselineStatus = Preflight
  $preserveManifest = Get-Manifest $baselineStatus $false
  $ownedManifest = Get-Manifest $baselineStatus $true
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
    $bootstrap = Join-Path $snapshot 'wp66-bootstrap.sql'
    [IO.File]::WriteAllText($bootstrap, "CREATE SCHEMA IF NOT EXISTS `"$schema`";`nCOMMENT ON SCHEMA `"$schema`" IS '$marker';", [Text.UTF8Encoding]::new($false))
    if ((Invoke-Child 'database-bootstrap' $node @($prisma, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', '.\wp66-bootstrap.sql') $run) -ne 0) { throw 'Bootstrap failed.' }
    $schemaCreated = $true
    if ((Invoke-Child 'migrate-deploy' $node @($prisma, 'migrate', 'deploy') $run) -ne 0) { throw 'Migrate deploy failed.' }
    if ((Invoke-Child 'migrate-status' $node @($prisma, 'migrate', 'status') $run) -ne 0) { throw 'Migrate status failed.' }
    if ((Invoke-Child 'owned-eslint' $node @('node_modules/eslint/bin/eslint.js', 'tests/e2e/accountant-lives-index-direct-url.spec.ts', 'src/app/(app)/dashboard/page.tsx', 'src/lib/dashboard-checklist.ts', 'src/lib/dashboard-checklist.test.ts') $run) -ne 0) { throw 'Lint failed.' }
    if ((Invoke-Child 'auth-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/auth.test.ts') $run) -ne 0) { throw 'Auth tests failed.' }
    if ((Invoke-Child 'app-shell-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/components/app-shell.test.ts') $run) -ne 0) { throw 'App-shell tests failed.' }
    if ((Invoke-Child 'dashboard-checklist-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/dashboard-checklist.test.ts') $run) -ne 0) { throw 'Dashboard checklist tests failed.' }
    if ((Invoke-Child 'format-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/format.test.ts') $run) -ne 0) { throw 'Format tests failed.' }
    if ((Invoke-Child 'live-countdown-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/live-countdown.test.ts') $run) -ne 0) { throw 'Live countdown tests failed.' }
    if ((Invoke-Child 'upsert-live-action-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/app/actions.test.ts', '-t', 'upsertLiveAction') $run) -ne 0) { throw 'Live action tests failed.' }
    if ((Invoke-Child 'browser-e2e' $node @('node_modules/@playwright/test/cli.js', 'test', 'tests/e2e/accountant-lives-index-direct-url.spec.ts', '--project=chromium', '--retries=0', '--reporter=json') $run) -ne 0) { throw 'Browser gate failed.' }
    if ((Invoke-Child 'typecheck' $node @('node_modules/typescript/bin/tsc', '--noEmit') $run) -ne 0) { throw 'Typecheck failed.' }
    $git = (Get-Command git.exe).Source
    if ((Invoke-Child 'git-diff-check' $git @('-C', $root, 'diff', '--check', '--', 'src/app/(app)/dashboard/page.tsx') $run) -ne 0) { throw 'Git diff check failed.' }
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
    assertion = 'Spec compares full Vendor, TrackingSetting, User, VendorMember, Video, RegistrationForm, Product, Live, and LiveProduct rows plus global, vendor, status, and relation counts; it records no post-authentication POST or non-loopback request.'
    result = 'UNCHANGED'
  })
} catch {
  $failure = Safe $_.Exception.Message
} finally {
  if ($schemaCreated) {
    try {
      $run = Get-Environment
      $cleanup = Join-Path $snapshot 'wp66-cleanup.sql'
      $sql = 'DO $$ BEGIN IF current_database() <> ''celebratedeal_ci'' THEN RAISE EXCEPTION ''database mismatch''; END IF; IF (SELECT obj_description(oid, ''pg_namespace'') FROM pg_namespace WHERE nspname = ''' + $schema + ''') <> ''' + $marker + ''' THEN RAISE EXCEPTION ''marker mismatch''; END IF; EXECUTE ''DROP SCHEMA "' + $schema + '" CASCADE''; END $$;'
      [IO.File]::WriteAllText($cleanup, $sql, [Text.UTF8Encoding]::new($false))
      Push-Location $snapshot
      try {
        $cleanupCode = Invoke-Child 'database-cleanup' $node @($prisma, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', '.\wp66-cleanup.sql') $run
      } finally {
        Pop-Location
      }
      if ($cleanupCode -ne 0) { throw 'Schema cleanup failed.' }
    } catch {
      if ($null -eq $failure) { $failure = Safe $_.Exception.Message }
    }
  }
  $postflightStatus = @(git -C $root status --short)
  try {
    if (($baselineStatus -join "`n") -ne ($postflightStatus -join "`n")) { throw 'Git ownership status changed during run.' }
    $postPreserveManifest = Get-Manifest $postflightStatus $false
    if (($preserveManifest | ConvertTo-Json -Compress) -ne ($postPreserveManifest | ConvertTo-Json -Compress)) {
      throw 'PRESERVE_ONLY content changed during run.'
    }
    $postOwnedManifest = Get-Manifest $postflightStatus $true
    if (($ownedManifest | ConvertTo-Json -Compress) -ne ($postOwnedManifest | ConvertTo-Json -Compress)) {
      throw 'WP-66 owned content changed during run.'
    }
  } catch {
    if ($null -eq $failure) { $failure = Safe $_.Exception.Message }
  }
  if (Test-Path $report) {
    Write-Json 'ownership-summary.sanitized.json' ([ordered]@{
      artifactType = 'ownership'
      stagedIndex = 'EMPTY'
      owned = $ownedManifest
      preserveOnlyHashCount = @($preserveManifest).Count
      prePostStatusIdentical = (($baselineStatus -join "`n") -eq ($postflightStatus -join "`n"))
    })
    Write-Json 'final-runner-summary.sanitized.json' ([ordered]@{
      artifactType = 'final-runner-summary'
      workPackage = 'WP-66'
      runId = $id
      finalRunnerError = $failure
      syntheticEnvironmentOnly = $true
      preflightStatus = $baselineStatus
      postflightStatus = $postflightStatus
      preserveOnlyHashCount = @($preserveManifest).Count
      schemaCleanup = if ($schemaCreated) { 'ATTEMPTED' } else { 'NOT_CREATED' }
    })
    Write-Json 'command-receipts.sanitized.json' ([ordered]@{
      artifactType = 'command-receipts'
      workPackage = 'WP-66'
      receipts = @($receipts)
    })
  }
  if (Test-Path $snapshot) { Remove-Item -LiteralPath $snapshot -Recurse -Force }
  if (Test-Path $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
}

Write-Output "WP-66 report: $report"
if ($failure) { throw $failure }
