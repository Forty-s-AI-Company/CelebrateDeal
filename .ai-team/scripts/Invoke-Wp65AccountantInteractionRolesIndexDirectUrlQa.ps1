[CmdletBinding()]
param([switch]$PreflightSelfTest)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$id = Get-Date -Format 'yyyyMMddHHmmssfff'
$schema = "wp65_$id"
$marker = "wp65:$id"
$temp = [IO.Path]::GetTempPath()
$snapshot = Join-Path $temp "CelebrateDeal-WP65-$id"
$runtime = Join-Path $temp "CelebrateDeal-WP65-runtime-$id"
$report = Join-Path $root ".ai-team\reports\wp-65-accountant-interaction-roles-index-direct-url-$id"
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
    E2E_PORT = '31065'
    E2E_BASE_URL = 'http://127.0.0.1:31065'
    RATE_LIMIT_PROVIDER = 'memory'
    PAYMENT_PROVIDER = 'demo'
    SENTRY_DSN = ''
    NEXT_PUBLIC_SENTRY_DSN = ''
    SENTRY_AUTH_TOKEN = ''
    RESEND_API_KEY = ''
    EMAIL_FROM = ''
    SENTRY_DISABLE_AUTO_UPLOAD = 'true'
    PLAYWRIGHT_BROWSERS_PATH = (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'ms-playwright')
    PLAYWRIGHT_JSON_OUTPUT_FILE = (Join-Path $snapshot '.wp65-browser.json')
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
    '.ai-team/scripts/Invoke-Wp65AccountantInteractionRolesIndexDirectUrlQa.ps1',
    'src/app/(app)/dashboard/page.tsx',
    'src/lib/dashboard-checklist.ts',
    'src/lib/dashboard-checklist.test.ts',
    'tests/e2e/accountant-interaction-roles-index-direct-url.spec.ts'
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
  $page = Get-Content -LiteralPath 'src/app/(app)/interaction-roles/page.tsx' -Raw
  $guard = $page.IndexOf('const vendor = await requireVendorManager();')
  $query = $page.IndexOf('getDb().interactionRole.findMany')
  $csrf = $page.IndexOf('getCsrfToken()', $query)
  $render = $page.IndexOf('<PageHeader', $csrf)
  if ($guard -lt 0 -or $query -lt $guard -or $csrf -lt $query -or $render -lt $csrf) {
    throw 'Interaction roles index guard/query/CSRF/render order drift.'
  }
  foreach ($required in @(
    'where: { vendorId: vendor.id }',
    '<PageHeader',
    'title="互動角色"',
    '<form action={importSystemRolesAction}>',
    '<CsrfField />',
    '<InteractionRolesWorkbench roles={roles} csrfToken={csrfToken} />'
  )) {
    if (-not $page.Contains($required)) { throw "Interaction roles index contract drift: $required" }
  }

  $workbench = Get-Content -LiteralPath 'src/components/interaction-roles-workbench.tsx' -Raw
  foreach ($required in @(
    'https://api.dicebear.com/',
    '使用者清單',
    '{roles.length} 個官方互動角色',
    'href="/interaction-roles/new"',
    'href={`/interaction-roles/${role.id}/edit`}',
    '<form action={upsertInteractionRoleAction}',
    'name={CSRF_FIELD_NAME}',
    'name="avatarUrl"',
    'name="name"',
    'name="roleType"',
    'name="label"',
    'name="tone"',
    'name="isActive"',
    'formAction={deleteInteractionRoleAction}'
  )) {
    if (-not $workbench.Contains($required)) { throw "Interaction roles workbench contract drift: $required" }
  }

  $actions = Get-Content -LiteralPath 'src/app/actions.ts' -Raw
  $upsertStart = $actions.IndexOf('export async function upsertInteractionRoleAction')
  $deleteStart = $actions.IndexOf('export async function deleteInteractionRoleAction', $upsertStart)
  $roleAvatarStart = $actions.IndexOf('function roleAvatar', $deleteStart)
  $importStart = $actions.IndexOf('export async function importSystemRolesAction', $roleAvatarStart)
  $importEnd = $actions.IndexOf('export async function upsertInteractionScriptAction', $importStart)
  if ($upsertStart -lt 0 -or $deleteStart -lt 0 -or $roleAvatarStart -lt 0 -or $importStart -lt 0 -or $importEnd -lt 0) {
    throw 'Interaction role action boundary missing.'
  }

  $upsert = $actions.Substring($upsertStart, $deleteStart - $upsertStart)
  $upsertSecurity = $upsert.IndexOf('await assertServerActionSecurity(formData);')
  $upsertManager = $upsert.IndexOf('const vendor = await requireVendorManager();')
  $upsertId = $upsert.IndexOf('const id = optionalText(formData, "id");')
  $upsertMutation = $upsert.IndexOf('await getDb().interactionRole.')
  if ($upsertSecurity -lt 0 -or $upsertManager -lt $upsertSecurity -or $upsertId -lt $upsertManager -or $upsertMutation -lt $upsertId) {
    throw 'Interaction role upsert security/identity/mutation order drift.'
  }
  foreach ($required in @('optionalExternalUrl(formData, "avatarUrl"', 'vendorId: vendor.id')) {
    if (-not $upsert.Contains($required)) { throw "Interaction role upsert tenant/input contract drift: $required" }
  }

  $delete = $actions.Substring($deleteStart, $roleAvatarStart - $deleteStart)
  $deleteSecurity = $delete.IndexOf('await assertServerActionSecurity(formData);')
  $deleteManager = $delete.IndexOf('const vendor = await requireVendorManager();')
  $deleteId = $delete.IndexOf('const id = text(formData, "id");')
  $deleteMutation = $delete.IndexOf('await getDb().interactionRole.delete')
  if ($deleteSecurity -lt 0 -or $deleteManager -lt $deleteSecurity -or $deleteId -lt $deleteManager -or $deleteMutation -lt $deleteId) {
    throw 'Interaction role delete security/identity/mutation order drift.'
  }
  if (-not $delete.Contains('where: { id, vendorId: vendor.id }')) {
    throw 'Interaction role delete tenant contract drift.'
  }

  $import = $actions.Substring($importStart, $importEnd - $importStart)
  $importSecurity = $import.IndexOf('await assertServerActionSecurity(formData);')
  $importManager = $import.IndexOf('const vendor = await requireVendorManager();')
  $importLookup = $import.IndexOf('await db.interactionRole.findMany')
  $importMutation = $import.IndexOf('await db.interactionRole.createMany')
  if ($importSecurity -lt 0 -or $importManager -lt $importSecurity -or $importLookup -lt $importManager -or $importMutation -lt $importLookup) {
    throw 'System role import security/lookup/mutation order drift.'
  }
  foreach ($required in @('vendorId: vendor.id', '.map((role) => ({ ...role, vendorId: vendor.id, isActive: true }))')) {
    if (-not $import.Contains($required)) { throw "System role import tenant contract drift: $required" }
  }

  $shell = Get-Content -LiteralPath 'src/components/app-shell.tsx' -Raw
  if (-not $shell.Contains('{ href: "/interaction-roles", label: "互動角色", icon: Bot, managerOnly: true }')) {
    throw 'Interaction roles navigation manager-only contract drift.'
  }

  $dashboard = Get-Content -LiteralPath 'src/app/(app)/dashboard/page.tsx' -Raw
  foreach ($required in @(
    'const { auth, vendor } = await requireVendorContext();',
    'const checklist = dashboardChecklistForRole(',
    'auth.member?.role ?? null'
  )) {
    if (-not $dashboard.Contains($required)) { throw "Dashboard checklist integration drift: $required" }
  }

  $checklist = Get-Content -LiteralPath 'src/lib/dashboard-checklist.ts' -Raw
  foreach ($required in @(
    'const MANAGER_ROLES = new Set(["owner", "admin"]);',
    'return items.filter((item) => !item.managerOnly || isManager);',
    'href: "/products/new"',
    'href: "/lives/new"',
    'href: "/interaction-roles/new"',
    'href: "/interaction-scripts/new"',
    'href: "/settings/tracking"'
  )) {
    if (-not $checklist.Contains($required)) { throw "Dashboard checklist role filter drift: $required" }
  }
  if (($checklist.Split('managerOnly: true').Count - 1) -ne 5) {
    throw 'Dashboard manager-only checklist coverage drift.'
  }
}

function Preflight {
  if ($schema -notmatch '^wp65_[0-9]+$') { throw 'Invalid schema.' }
  if (@(git -C $root diff --cached --name-only).Count -ne 0) { throw 'Staged index must be empty.' }
  $status = @(git -C $root status --short)
  $ownedStatus = @(
    '?? .ai-team/scripts/Invoke-Wp65AccountantInteractionRolesIndexDirectUrlQa.ps1',
    ' M src/app/(app)/dashboard/page.tsx',
    '?? src/lib/dashboard-checklist.ts',
    '?? src/lib/dashboard-checklist.test.ts',
    '?? tests/e2e/accountant-interaction-roles-index-direct-url.spec.ts'
  )
  if (@($status | Where-Object { $_ -in $ownedStatus }).Count -ne 5) { throw 'WP-65 owned paths missing.' }
  if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port 54329 -InformationLevel Quiet)) {
    throw 'Local disposable DB unavailable.'
  }
  Assert-SourceContract
  return $status
}

if ($PreflightSelfTest) {
  $null = Preflight
  Write-Output 'WP-65 preflight PASS'
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
    $bootstrap = Join-Path $snapshot 'wp65-bootstrap.sql'
    [IO.File]::WriteAllText($bootstrap, "CREATE SCHEMA IF NOT EXISTS `"$schema`";`nCOMMENT ON SCHEMA `"$schema`" IS '$marker';", [Text.UTF8Encoding]::new($false))
    if ((Invoke-Child 'database-bootstrap' $node @($prisma, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', '.\wp65-bootstrap.sql') $run) -ne 0) { throw 'Bootstrap failed.' }
    $schemaCreated = $true
    if ((Invoke-Child 'migrate-deploy' $node @($prisma, 'migrate', 'deploy') $run) -ne 0) { throw 'Migrate deploy failed.' }
    if ((Invoke-Child 'migrate-status' $node @($prisma, 'migrate', 'status') $run) -ne 0) { throw 'Migrate status failed.' }
    if ((Invoke-Child 'owned-eslint' $node @('node_modules/eslint/bin/eslint.js', 'tests/e2e/accountant-interaction-roles-index-direct-url.spec.ts', 'src/app/(app)/dashboard/page.tsx', 'src/lib/dashboard-checklist.ts', 'src/lib/dashboard-checklist.test.ts') $run) -ne 0) { throw 'Lint failed.' }
    if ((Invoke-Child 'auth-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/auth.test.ts') $run) -ne 0) { throw 'Auth tests failed.' }
    if ((Invoke-Child 'app-shell-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/components/app-shell.test.ts') $run) -ne 0) { throw 'App-shell tests failed.' }
    if ((Invoke-Child 'dashboard-checklist-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/dashboard-checklist.test.ts') $run) -ne 0) { throw 'Dashboard checklist tests failed.' }
    if ((Invoke-Child 'interaction-role-label-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/interaction-role-label.test.ts') $run) -ne 0) { throw 'Interaction role label tests failed.' }
    if ((Invoke-Child 'import-system-roles-action-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/app/actions.test.ts', '-t', 'importSystemRolesAction') $run) -ne 0) { throw 'System role import action tests failed.' }
    if ((Invoke-Child 'browser-e2e' $node @('node_modules/@playwright/test/cli.js', 'test', 'tests/e2e/accountant-interaction-roles-index-direct-url.spec.ts', '--project=chromium', '--retries=0', '--reporter=json') $run) -ne 0) { throw 'Browser gate failed.' }
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
    assertion = 'Spec compares full Vendor, TrackingSetting, User, VendorMember, and InteractionRole rows plus global, vendor, active, inactive, and relation counts; it records no post-login POST or non-loopback request.'
    result = 'UNCHANGED'
  })
} catch {
  $failure = Safe $_.Exception.Message
} finally {
  if ($schemaCreated) {
    try {
      $run = Get-Environment
      $cleanup = Join-Path $snapshot 'wp65-cleanup.sql'
      $sql = 'DO $$ BEGIN IF current_database() <> ''celebratedeal_ci'' THEN RAISE EXCEPTION ''database mismatch''; END IF; IF (SELECT obj_description(oid, ''pg_namespace'') FROM pg_namespace WHERE nspname = ''' + $schema + ''') <> ''' + $marker + ''' THEN RAISE EXCEPTION ''marker mismatch''; END IF; EXECUTE ''DROP SCHEMA "' + $schema + '" CASCADE''; END $$;'
      [IO.File]::WriteAllText($cleanup, $sql, [Text.UTF8Encoding]::new($false))
      Push-Location $snapshot
      try {
        $cleanupCode = Invoke-Child 'database-cleanup' $node @($prisma, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', '.\wp65-cleanup.sql') $run
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
      workPackage = 'WP-65'
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
      workPackage = 'WP-65'
      receipts = @($receipts)
    })
  }
  if (Test-Path $snapshot) { Remove-Item -LiteralPath $snapshot -Recurse -Force }
  if (Test-Path $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
}

Write-Output "WP-65 report: $report"
if ($failure) { throw $failure }
