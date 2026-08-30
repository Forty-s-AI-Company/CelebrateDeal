[CmdletBinding()]
param([switch]$PreflightSelfTest)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$id = Get-Date -Format 'yyyyMMddHHmmssfff'
$schema = "wp63_$id"
$marker = "wp63:$id"
$temp = [IO.Path]::GetTempPath()
$snapshot = Join-Path $temp "CelebrateDeal-WP63-$id"
$runtime = Join-Path $temp "CelebrateDeal-WP63-runtime-$id"
$report = Join-Path $root ".ai-team\reports\wp-63-accountant-interaction-scripts-index-direct-url-$id"
$receipts = [Collections.Generic.List[object]]::new()
$schemaCreated = $false
$failure = $null
$baselineStatus = @()
$preserveManifest = @()

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
    E2E_PORT = '31063'
    E2E_BASE_URL = 'http://127.0.0.1:31063'
    RATE_LIMIT_PROVIDER = 'memory'
    PAYMENT_PROVIDER = 'demo'
    SENTRY_DSN = ''
    NEXT_PUBLIC_SENTRY_DSN = ''
    SENTRY_AUTH_TOKEN = ''
    RESEND_API_KEY = ''
    EMAIL_FROM = ''
    SENTRY_DISABLE_AUTO_UPLOAD = 'true'
    PLAYWRIGHT_BROWSERS_PATH = (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'ms-playwright')
    PLAYWRIGHT_JSON_OUTPUT_FILE = (Join-Path $snapshot '.wp63-browser.json')
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

function Get-DirtyManifest([string[]]$status) {
  $owned = @(
    '.ai-team/scripts/Invoke-Wp63AccountantInteractionScriptsIndexDirectUrlQa.ps1',
    'tests/e2e/accountant-interaction-scripts-index-direct-url.spec.ts'
  )
  return @($status | ForEach-Object {
    $relative = $_.Substring(3).Replace('\', '/')
    if ($relative -notin $owned) {
      $full = Join-Path $root $relative
      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Preserve-only path missing: $relative" }
      [ordered]@{ path = $relative; sha256 = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash }
    }
  })
}

function Assert-SourceContract {
  $page = Get-Content -LiteralPath 'src/app/(app)/interaction-scripts/page.tsx' -Raw
  $guard = $page.IndexOf('const vendor = await requireVendorManager();')
  if ($guard -lt 0) { throw 'Interaction-scripts manager guard missing.' }
  foreach ($afterGuard in @(
    'const params = await searchParams;',
    'getDb().interactionScript.count',
    'getDb().interactionScript.findMany',
    'skip: (page - 1) * pageSize',
    'take: pageSize',
    '<PageHeader title="留言組"'
  )) {
    $position = $page.IndexOf($afterGuard)
    if ($position -lt 0 -or $position -lt $guard) { throw "Interaction-scripts guard order drift: $afterGuard" }
  }
  foreach ($required in @(
    'count({ where: { vendorId: vendor.id } })',
    'where: { vendorId: vendor.id }',
    'events: { orderBy: { triggerSec: "asc" } }',
    'lives: { include: { video: true } }',
    'href={`/interaction-scripts/${script.id}/edit`}',
    'action={duplicateInteractionScriptAction}',
    'action={deleteInteractionScriptAction}',
    'name="id" value={script.id}'
  )) {
    if (-not $page.Contains($required)) { throw "Interaction-scripts page contract drift: $required" }
  }
  if (($page.Split('name="id" value={script.id}').Count - 1) -lt 2) {
    throw 'Interaction-script duplicate/delete hidden IDs missing.'
  }

  $actions = Get-Content -LiteralPath 'src/app/actions.ts' -Raw
  $duplicateStart = $actions.IndexOf('export async function duplicateInteractionScriptAction')
  $deleteStart = $actions.IndexOf('export async function deleteInteractionScriptAction', $duplicateStart)
  $blacklistStart = $actions.IndexOf('export async function upsertBlacklistAction', $deleteStart)
  if ($duplicateStart -lt 0 -or $deleteStart -lt 0 -or $blacklistStart -lt 0) {
    throw 'Interaction-script action boundaries missing.'
  }
  $duplicate = $actions.Substring($duplicateStart, $deleteStart - $duplicateStart)
  $duplicateSecurity = $duplicate.IndexOf('await assertServerActionSecurity(formData);')
  $duplicateManager = $duplicate.IndexOf('const vendor = await requireVendorManager();')
  $duplicateId = $duplicate.IndexOf('const id = text(formData, "id");')
  $duplicateLookup = $duplicate.IndexOf('getDb().interactionScript.findFirst')
  $duplicateMutation = $duplicate.IndexOf('await getDb().interactionScript.create')
  if ($duplicateSecurity -lt 0 -or $duplicateManager -lt $duplicateSecurity -or $duplicateId -lt $duplicateManager -or $duplicateLookup -lt $duplicateId -or $duplicateMutation -lt $duplicateLookup) {
    throw 'Interaction-script duplicate security/lookup/mutation order drift.'
  }
  if (-not $duplicate.Contains('where: { id, vendorId: vendor.id }') -or -not $duplicate.Contains('vendorId: vendor.id')) {
    throw 'Interaction-script duplicate tenant binding drift.'
  }

  $delete = $actions.Substring($deleteStart, $blacklistStart - $deleteStart)
  $deleteSecurity = $delete.IndexOf('await assertServerActionSecurity(formData);')
  $deleteManager = $delete.IndexOf('const vendor = await requireVendorManager();')
  $deleteId = $delete.IndexOf('const id = text(formData, "id");')
  $deleteMutation = $delete.IndexOf('await getDb().interactionScript.delete')
  if ($deleteSecurity -lt 0 -or $deleteManager -lt $deleteSecurity -or $deleteId -lt $deleteManager -or $deleteMutation -lt $deleteId) {
    throw 'Interaction-script delete security/parse/mutation order drift.'
  }
  if (-not $delete.Contains('where: { id, vendorId: vendor.id }')) {
    throw 'Interaction-script delete tenant binding drift.'
  }

  $upsertStart = $actions.IndexOf('export async function upsertInteractionScriptAction')
  $unbindStart = $actions.IndexOf('export async function unbindInteractionScriptFromLiveAction', $upsertStart)
  if ($upsertStart -lt 0 -or $unbindStart -lt 0) { throw 'Interaction-script upsert boundary missing.' }
  $upsert = $actions.Substring($upsertStart, $unbindStart - $upsertStart)
  $upsertSecurity = $upsert.IndexOf('await assertServerActionSecurity(formData);')
  $upsertManager = $upsert.IndexOf('const vendor = await requireVendorManager();')
  $roleValidation = $upsert.IndexOf('db.interactionRole.findMany')
  $productValidation = $upsert.IndexOf('db.product.findMany')
  $upsertMutation = $upsert.IndexOf('await db.interactionScript.create')
  if ($upsertSecurity -lt 0 -or $upsertManager -lt $upsertSecurity -or $roleValidation -lt $upsertManager -or $productValidation -lt $roleValidation -or $upsertMutation -lt $productValidation) {
    throw 'Interaction-script upsert security/reference/mutation order drift.'
  }
  if (-not $upsert.Contains('vendorId: vendor.id')) { throw 'Interaction-script upsert tenant binding drift.' }

  $shell = Get-Content -LiteralPath 'src/components/app-shell.tsx' -Raw
  if (-not $shell.Contains('{ href: "/interaction-scripts", label: "互動腳本", icon: ScrollText, managerOnly: true }')) {
    throw 'Interaction-scripts navigation manager-only contract drift.'
  }
}

function Preflight {
  if ($schema -notmatch '^wp63_[0-9]+$') { throw 'Invalid schema.' }
  if (@(git -C $root diff --cached --name-only).Count -ne 0) { throw 'Staged index must be empty.' }
  $status = @(git -C $root status --short)
  $ownedStatus = @(
    '?? .ai-team/scripts/Invoke-Wp63AccountantInteractionScriptsIndexDirectUrlQa.ps1',
    '?? tests/e2e/accountant-interaction-scripts-index-direct-url.spec.ts'
  )
  if (@($status | Where-Object { $_ -in $ownedStatus }).Count -ne 2) { throw 'WP-63 owned paths missing.' }
  if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port 54329 -InformationLevel Quiet)) {
    throw 'Local disposable DB unavailable.'
  }
  Assert-SourceContract
  return $status
}

if ($PreflightSelfTest) {
  $null = Preflight
  Write-Output 'WP-63 preflight PASS'
  exit 0
}

try {
  $baselineStatus = Preflight
  $preserveManifest = Get-DirtyManifest $baselineStatus
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
    $bootstrap = Join-Path $snapshot 'wp63-bootstrap.sql'
    [IO.File]::WriteAllText($bootstrap, "CREATE SCHEMA IF NOT EXISTS `"$schema`";`nCOMMENT ON SCHEMA `"$schema`" IS '$marker';", [Text.UTF8Encoding]::new($false))
    if ((Invoke-Child 'database-bootstrap' $node @($prisma, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', '.\wp63-bootstrap.sql') $run) -ne 0) { throw 'Bootstrap failed.' }
    $schemaCreated = $true
    if ((Invoke-Child 'migrate-deploy' $node @($prisma, 'migrate', 'deploy') $run) -ne 0) { throw 'Migrate deploy failed.' }
    if ((Invoke-Child 'migrate-status' $node @($prisma, 'migrate', 'status') $run) -ne 0) { throw 'Migrate status failed.' }
    if ((Invoke-Child 'spec-eslint' $node @('node_modules/eslint/bin/eslint.js', 'tests/e2e/accountant-interaction-scripts-index-direct-url.spec.ts') $run) -ne 0) { throw 'Lint failed.' }
    if ((Invoke-Child 'auth-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/auth.test.ts') $run) -ne 0) { throw 'Auth tests failed.' }
    if ((Invoke-Child 'app-shell-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/components/app-shell.test.ts') $run) -ne 0) { throw 'App-shell tests failed.' }
    if ((Invoke-Child 'interaction-timeline-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/interaction-timeline.test.ts') $run) -ne 0) { throw 'Interaction timeline tests failed.' }
    if ((Invoke-Child 'interaction-script-form-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/components/interaction-script-form.test.tsx') $run) -ne 0) { throw 'Interaction script form tests failed.' }
    if ((Invoke-Child 'interaction-script-upsert-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/app/actions.test.ts', '-t', 'upsertInteractionScriptAction') $run) -ne 0) { throw 'Interaction script upsert tests failed.' }
    if ((Invoke-Child 'interaction-script-unbind-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/app/actions.test.ts', '-t', 'unbindInteractionScriptFromLiveAction') $run) -ne 0) { throw 'Interaction script unbind tests failed.' }
    if ((Invoke-Child 'browser-e2e' $node @('node_modules/@playwright/test/cli.js', 'test', 'tests/e2e/accountant-interaction-scripts-index-direct-url.spec.ts', '--project=chromium', '--retries=0', '--reporter=json') $run) -ne 0) { throw 'Browser gate failed.' }
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
    assertion = 'Spec compares full Vendor, User, VendorMember, InteractionRole, Product, Video, InteractionScript, InteractionEvent, and Live rows plus global, vendor, script, and relation counts; it records no post-login POST or non-loopback request.'
    result = 'UNCHANGED'
  })
} catch {
  $failure = Safe $_.Exception.Message
} finally {
  if ($schemaCreated) {
    try {
      $run = Get-Environment
      $cleanup = Join-Path $snapshot 'wp63-cleanup.sql'
      $sql = 'DO $$ BEGIN IF current_database() <> ''celebratedeal_ci'' THEN RAISE EXCEPTION ''database mismatch''; END IF; IF (SELECT obj_description(oid, ''pg_namespace'') FROM pg_namespace WHERE nspname = ''' + $schema + ''') <> ''' + $marker + ''' THEN RAISE EXCEPTION ''marker mismatch''; END IF; EXECUTE ''DROP SCHEMA "' + $schema + '" CASCADE''; END $$;'
      [IO.File]::WriteAllText($cleanup, $sql, [Text.UTF8Encoding]::new($false))
      Push-Location $snapshot
      try {
        $cleanupCode = Invoke-Child 'database-cleanup' $node @($prisma, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', '.\wp63-cleanup.sql') $run
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
    $postPreserveManifest = Get-DirtyManifest $postflightStatus
    if (($preserveManifest | ConvertTo-Json -Compress) -ne ($postPreserveManifest | ConvertTo-Json -Compress)) {
      throw 'PRESERVE_ONLY content changed during run.'
    }
  } catch {
    if ($null -eq $failure) { $failure = Safe $_.Exception.Message }
  }
  if (Test-Path $report) {
    Write-Json 'final-runner-summary.sanitized.json' ([ordered]@{
      artifactType = 'final-runner-summary'
      workPackage = 'WP-63'
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
      workPackage = 'WP-63'
      receipts = @($receipts)
    })
  }
  if (Test-Path $snapshot) { Remove-Item -LiteralPath $snapshot -Recurse -Force }
  if (Test-Path $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
}

Write-Output "WP-63 report: $report"
if ($failure) { throw $failure }
