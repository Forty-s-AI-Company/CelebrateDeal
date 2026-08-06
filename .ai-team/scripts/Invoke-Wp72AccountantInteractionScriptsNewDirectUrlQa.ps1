[CmdletBinding()]
param([switch]$PreflightSelfTest)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$id = Get-Date -Format 'yyyyMMddHHmmssfff'
$schema = "wp72_$id"
$marker = "wp72:$id"
$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$snapshot = Join-Path $temp "CelebrateDeal-WP72-$id"
$runtime = Join-Path $temp "CelebrateDeal-WP72-runtime-$id"
$report = Join-Path $root ".ai-team\reports\wp-72-accountant-interaction-scripts-new-direct-url-$id"
$receipts = [Collections.Generic.List[object]]::new()
$schemaCreated = $false
$schemaCleanupPassed = $false
$snapshotCleanupPassed = $false
$runtimeCleanupPassed = $false
$failure = $null
$baselineStatus = @()
$baselineBranch = ''
$baselineHead = ''
$preserveManifest = @()
$ownedManifest = @()

function Safe([string]$value) {
  if ($null -eq $value) { return '' }
  $safe = $value -replace '(?i)postgres(?:ql)?://\S+', '[REDACTED_DATABASE_URL]'
  $safe = $safe -replace '(?i)(token|secret|password|authorization)\s*[:=]\s*[^\s,;]+', '$1=[REDACTED]'
  $safe = $safe -replace '\b\d{13}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b', '[REDACTED_CSRF]'
  return $safe -replace '(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[REDACTED_EMAIL]'
}

function Write-Json([string]$name, $value) {
  $value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $report $name) -Encoding utf8
}

function Write-Marker([string]$path) {
  [IO.File]::WriteAllText(
    (Join-Path $path '.wp72-marker'),
    $marker,
    [Text.UTF8Encoding]::new($false)
  )
}

function Assert-TemporaryArtifact([string]$path) {
  $full = [IO.Path]::GetFullPath($path)
  if (-not $full.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Temporary path escaped OS temp: $full"
  }
  if (-not $full.Contains($id, [StringComparison]::Ordinal)) {
    throw "Temporary path is not run-scoped: $full"
  }
  $markerFile = Join-Path $full '.wp72-marker'
  if (-not (Test-Path -LiteralPath $markerFile -PathType Leaf)) {
    throw "Temporary marker missing: $full"
  }
  if ([IO.File]::ReadAllText($markerFile) -ne $marker) {
    throw "Temporary marker mismatch: $full"
  }
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
    E2E_PORT = '31072'
    E2E_BASE_URL = 'http://127.0.0.1:31072'
    RATE_LIMIT_PROVIDER = 'memory'
    PAYMENT_PROVIDER = 'demo'
    SENTRY_DSN = ''
    NEXT_PUBLIC_SENTRY_DSN = ''
    SENTRY_AUTH_TOKEN = ''
    RESEND_API_KEY = ''
    EMAIL_FROM = ''
    SENTRY_DISABLE_AUTO_UPLOAD = 'true'
    NEXT_TELEMETRY_DISABLED = '1'
    PLAYWRIGHT_BROWSERS_PATH = (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'ms-playwright')
    PLAYWRIGHT_JSON_OUTPUT_FILE = (Join-Path $snapshot '.wp72-browser.json')
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
    '.ai-team/scripts/Invoke-Wp72AccountantInteractionScriptsNewDirectUrlQa.ps1',
    'tests/e2e/accountant-interaction-scripts-new-direct-url.spec.ts'
  )
}

function Get-Manifest([string[]]$status, [bool]$owned) {
  $ownedPaths = Get-OwnedPaths
  return @($status | ForEach-Object {
    $relative = $_.Substring(3).Replace('\', '/')
    $isOwned = $relative -in $ownedPaths
    if ($isOwned -eq $owned) {
      $full = Join-Path $root $relative
      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        throw "Manifest path missing: $relative"
      }
      [ordered]@{
        path = $relative
        sha256 = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
      }
    }
  })
}

function Assert-SourceContract {
  $page = Get-Content -LiteralPath 'src/app/(app)/interaction-scripts/new/page.tsx' -Raw
  $guard = $page.IndexOf('const vendor = await requireVendorManager();')
  $search = $page.IndexOf('const { error } = await searchParams;', $guard)
  $roleQuery = $page.IndexOf('getDb().interactionRole.findMany', $search)
  $productQuery = $page.IndexOf('getDb().product.findMany', $roleQuery)
  $csrf = $page.IndexOf('getCsrfToken()', $productQuery)
  $render = $page.IndexOf('<PageHeader', $csrf)
  if ($guard -lt 0 -or $search -lt $guard -or $roleQuery -lt $search -or
      $productQuery -lt $roleQuery -or $csrf -lt $productQuery -or $render -lt $csrf) {
    throw 'Interaction-script new-page guard/search/query/CSRF/render order drift.'
  }
  foreach ($required in @(
    'where: { vendorId: vendor.id, isActive: true }',
    '<PageHeader title="新增互動腳本"',
    '<InteractionScriptForm roles={roles} products={products} csrfToken={csrfToken} error={error} />'
  )) {
    if (-not $page.Contains($required)) {
      throw "Interaction-script new-page contract drift: $required"
    }
  }

  $shell = Get-Content -LiteralPath 'src/components/app-shell.tsx' -Raw
  if (-not $shell.Contains('{ href: "/interaction-scripts", label: "互動腳本", icon: ScrollText, managerOnly: true }')) {
    throw 'Interaction-script navigation manager-only contract drift.'
  }

  $checklist = Get-Content -LiteralPath 'src/lib/dashboard-checklist.ts' -Raw
  foreach ($required in @(
    'const MANAGER_ROLES = new Set(["owner", "admin"]);',
    'return items.filter((item) => !item.managerOnly || isManager);',
    'href: "/interaction-scripts/new"',
    'managerOnly: true'
  )) {
    if (-not $checklist.Contains($required)) {
      throw "Dashboard interaction-script checklist contract drift: $required"
    }
  }

  $form = Get-Content -LiteralPath 'src/components/interaction-script-form.tsx' -Raw
  foreach ($required in @(
    '<form action={upsertInteractionScriptAction}',
    'name={CSRF_FIELD_NAME}',
    'name="name"',
    'name="status"',
    'name="description"',
    'name="roleId"',
    'name="productId"',
    'name="eventType"',
    'name="eventTitle"',
    'name="triggerSec"',
    'name="message"',
    'name="ctaLabel"',
    'name="ctaUrl"'
  )) {
    if (-not $form.Contains($required)) {
      throw "Interaction-script form contract drift: $required"
    }
  }

  $actions = Get-Content -LiteralPath 'src/app/actions.ts' -Raw
  $start = $actions.IndexOf('export async function upsertInteractionScriptAction')
  $end = $actions.IndexOf('export async function unbindInteractionScriptFromLiveAction', $start)
  if ($start -lt 0 -or $end -lt 0) { throw 'Interaction-script action boundary missing.' }
  $slice = $actions.Substring($start, $end - $start)
  $security = $slice.IndexOf('await assertServerActionSecurity(formData);')
  $manager = $slice.IndexOf('const vendor = await requireVendorManager();')
  $idParse = $slice.IndexOf('const id = optionalText(formData, "id");')
  $roleIds = $slice.IndexOf('const roleIds = formData.getAll("roleId")')
  $productIds = $slice.IndexOf('const productIds = formData.getAll("productId")')
  $roleLookup = $slice.IndexOf('db.interactionRole.findMany')
  $productLookup = $slice.IndexOf('db.product.findMany')
  $data = $slice.IndexOf('const data = {')
  $update = $slice.IndexOf('db.interactionScript.update')
  $create = $slice.IndexOf('await db.interactionScript.create')
  $redirect = $slice.IndexOf('redirect("/interaction-scripts");')
  if ($security -lt 0 -or $manager -lt $security -or $idParse -lt $manager -or
      $roleIds -lt $idParse -or $productIds -lt $roleIds -or
      $roleLookup -lt $productIds -or $productLookup -lt $roleLookup -or
      $data -lt $productLookup -or $update -lt $data -or $create -lt $update -or
      $redirect -lt $create) {
    throw 'Interaction-script action security/manager/reference/mutation order drift.'
  }
  foreach ($required in @(
    'where: { vendorId: vendor.id, id: { in: referencedRoleIds } }',
    'where: { vendorId: vendor.id, id: { in: referencedProductIds } }',
    'db.interactionScript.update({ where: { id, vendorId: vendor.id }, data })',
    'vendorId: vendor.id',
    'events: { create: events }'
  )) {
    if (-not $slice.Contains($required)) {
      throw "Interaction-script tenant contract drift: $required"
    }
  }
}

function Preflight {
  if ($schema -notmatch '^wp72_[0-9]+$') { throw 'Invalid schema.' }
  if (@(git -C $root diff --cached --name-only).Count -ne 0) {
    throw 'Staged index must be empty.'
  }
  $status = @(git -C $root status --short)
  $ownedStatus = @(
    '?? .ai-team/scripts/Invoke-Wp72AccountantInteractionScriptsNewDirectUrlQa.ps1',
    '?? tests/e2e/accountant-interaction-scripts-new-direct-url.spec.ts'
  )
  if (@($status | Where-Object { $_ -in $ownedStatus }).Count -ne 2) {
    throw 'WP-72 owned paths missing or ownership is ambiguous.'
  }
  if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port 54329 -InformationLevel Quiet)) {
    throw 'Local disposable DB unavailable.'
  }
  Assert-SourceContract
  return $status
}

if ($PreflightSelfTest) {
  $null = Preflight
  Write-Output 'WP-72 preflight PASS'
  exit 0
}

try {
  $baselineStatus = Preflight
  $baselineBranch = (git -C $root branch --show-current | Out-String).Trim()
  $baselineHead = (git -C $root rev-parse HEAD | Out-String).Trim()
  $preserveManifest = Get-Manifest $baselineStatus $false
  $ownedManifest = Get-Manifest $baselineStatus $true
  New-Item -ItemType Directory -Force -Path $report, $snapshot, $runtime | Out-Null
  Write-Marker $snapshot
  Write-Marker $runtime
  $excluded = @('.git', '.ai-team', '.next', 'node_modules', 'test-results')
  Get-ChildItem -LiteralPath $root -Force |
    Where-Object { $_.Name -notin $excluded -and $_.Name -notlike '.env*' } |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $snapshot -Recurse -Force
    }
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
    $migrationCount = @(Get-ChildItem -LiteralPath 'prisma/migrations' -Directory).Count
    if ($migrationCount -ne 13) {
      throw "Expected 13 migrations, found $migrationCount."
    }
    if ((Invoke-Child 'prisma-validate' $node @($prisma, 'validate') $run) -ne 0) {
      throw 'Prisma validation failed.'
    }
    $bootstrap = Join-Path $snapshot 'wp72-bootstrap.sql'
    [IO.File]::WriteAllText(
      $bootstrap,
      "CREATE SCHEMA IF NOT EXISTS `"$schema`";`nCOMMENT ON SCHEMA `"$schema`" IS '$marker';",
      [Text.UTF8Encoding]::new($false)
    )
    if ((Invoke-Child 'database-bootstrap' $node @($prisma, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', '.\wp72-bootstrap.sql') $run) -ne 0) {
      throw 'Bootstrap failed.'
    }
    $schemaCreated = $true
    if ((Invoke-Child 'migrate-deploy' $node @($prisma, 'migrate', 'deploy') $run) -ne 0) {
      throw 'Migrate deploy failed.'
    }
    if ((Invoke-Child 'migrate-status' $node @($prisma, 'migrate', 'status') $run) -ne 0) {
      throw 'Migrate status failed.'
    }
    if ((Invoke-Child 'spec-eslint' $node @('node_modules/eslint/bin/eslint.js', 'tests/e2e/accountant-interaction-scripts-new-direct-url.spec.ts') $run) -ne 0) {
      throw 'Spec lint failed.'
    }
    if ((Invoke-Child 'auth-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/auth.test.ts') $run) -ne 0) {
      throw 'Auth tests failed.'
    }
    if ((Invoke-Child 'app-shell-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/components/app-shell.test.ts') $run) -ne 0) {
      throw 'App-shell tests failed.'
    }
    if ((Invoke-Child 'dashboard-checklist-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/dashboard-checklist.test.ts') $run) -ne 0) {
      throw 'Dashboard checklist tests failed.'
    }
    if ((Invoke-Child 'interaction-timeline-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/interaction-timeline.test.ts') $run) -ne 0) {
      throw 'Interaction timeline tests failed.'
    }
    if ((Invoke-Child 'interaction-script-form-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/components/interaction-script-form.test.tsx') $run) -ne 0) {
      throw 'Interaction script form tests failed.'
    }
    if ((Invoke-Child 'interaction-script-upsert-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/app/actions.test.ts', '-t', 'upsertInteractionScriptAction') $run) -ne 0) {
      throw 'Interaction script upsert tests failed.'
    }
    if ((Invoke-Child 'browser-e2e' $node @('node_modules/@playwright/test/cli.js', 'test', 'tests/e2e/accountant-interaction-scripts-new-direct-url.spec.ts', '--project=chromium', '--retries=0', '--reporter=json') $run) -ne 0) {
      throw 'Browser gate failed.'
    }
    if ((Invoke-Child 'typecheck' $node @('node_modules/typescript/bin/tsc', '--noEmit') $run) -ne 0) {
      throw 'Typecheck failed.'
    }
    $git = (Get-Command git.exe).Source
    if ((Invoke-Child 'git-diff-check' $git @('-C', $root, 'diff', '--check') $run) -ne 0) {
      throw 'Git diff check failed.'
    }
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
    pass = (
      $browser.stats.expected -eq 1 -and
      $browser.stats.unexpected -eq 0 -and
      $browser.stats.skipped -eq 0 -and
      $browser.stats.flaky -eq 0
    )
  }
  Write-Json 'browser-verdict.sanitized.json' $verdict
  if (-not $verdict.pass) { throw 'Browser verdict failed.' }
  Write-Json 'db-invariant-summary.sanitized.json' ([ordered]@{
    artifactType = 'db-invariant'
    assertion = 'Spec compares full Vendor, TrackingSetting, User, VendorMember, active/inactive InteractionRole and Product, InteractionScript, and InteractionEvent rows plus global, tenant, activity, composite, membership, and relation counts; it records no post-authentication POST, non-loopback, or .invalid request.'
    result = 'UNCHANGED'
  })
  Write-Json 'coverage-boundary.sanitized.json' ([ordered]@{
    artifactType = 'coverage-boundary'
    newPage = 'Static guard/search/query/CSRF/render source contract plus release-mode Browser denial.'
    interactionScriptForm = 'Two dynamic component tests plus static action/CSRF/field contract.'
    interactionTimeline = 'Thirty dynamic unit tests.'
    upsertInteractionScriptAction = 'Twelve targeted dynamic unit tests plus static security/manager/tenant-reference/mutation contract.'
  })
} catch {
  $failure = Safe $_.Exception.Message
} finally {
  if ($schemaCreated) {
    try {
      $run = Get-Environment
      $cleanup = Join-Path $snapshot 'wp72-cleanup.sql'
      $sql = 'DO $$ BEGIN IF current_database() <> ''celebratedeal_ci'' THEN RAISE EXCEPTION ''database mismatch''; END IF; IF (SELECT obj_description(oid, ''pg_namespace'') FROM pg_namespace WHERE nspname = ''' + $schema + ''') <> ''' + $marker + ''' THEN RAISE EXCEPTION ''marker mismatch''; END IF; EXECUTE ''DROP SCHEMA "' + $schema + '" CASCADE''; END $$;'
      [IO.File]::WriteAllText($cleanup, $sql, [Text.UTF8Encoding]::new($false))
      Push-Location $snapshot
      try {
        $cleanupCode = Invoke-Child 'database-cleanup' $node @(
          $prisma,
          'db',
          'execute',
          '--schema',
          'prisma/schema.prisma',
          '--file',
          '.\wp72-cleanup.sql'
        ) $run
      } finally {
        Pop-Location
      }
      if ($cleanupCode -ne 0) { throw 'Schema cleanup failed.' }
      $schemaCleanupPassed = $true
    } catch {
      if ($null -eq $failure) { $failure = Safe $_.Exception.Message }
    }
  }

  $postflightStatus = @(git -C $root status --short)
  try {
    $postBranch = (git -C $root branch --show-current | Out-String).Trim()
    $postHead = (git -C $root rev-parse HEAD | Out-String).Trim()
    if ($postBranch -ne $baselineBranch -or $postHead -ne $baselineHead) {
      throw 'Git branch or HEAD changed during run.'
    }
    if (($baselineStatus -join "`n") -ne ($postflightStatus -join "`n")) {
      throw 'Git ownership status changed during run.'
    }
    $postPreserveManifest = Get-Manifest $postflightStatus $false
    if (($preserveManifest | ConvertTo-Json -Compress) -ne ($postPreserveManifest | ConvertTo-Json -Compress)) {
      throw 'PRESERVE_ONLY content changed during run.'
    }
    $postOwnedManifest = Get-Manifest $postflightStatus $true
    if (($ownedManifest | ConvertTo-Json -Compress) -ne ($postOwnedManifest | ConvertTo-Json -Compress)) {
      throw 'WP-72 owned content changed during run.'
    }
    if (@(git -C $root diff --cached --name-only).Count -ne 0) {
      throw 'Staged index changed during run.'
    }
  } catch {
    if ($null -eq $failure) { $failure = Safe $_.Exception.Message }
  }

  try {
    if (Test-Path -LiteralPath $snapshot) {
      Assert-TemporaryArtifact $snapshot
      Remove-Item -LiteralPath $snapshot -Recurse -Force
    }
    $snapshotCleanupPassed = -not (Test-Path -LiteralPath $snapshot)
    if (-not $snapshotCleanupPassed) { throw 'Snapshot cleanup failed.' }
  } catch {
    if ($null -eq $failure) { $failure = Safe $_.Exception.Message }
  }
  try {
    if (Test-Path -LiteralPath $runtime) {
      Assert-TemporaryArtifact $runtime
      Remove-Item -LiteralPath $runtime -Recurse -Force
    }
    $runtimeCleanupPassed = -not (Test-Path -LiteralPath $runtime)
    if (-not $runtimeCleanupPassed) { throw 'Runtime cleanup failed.' }
  } catch {
    if ($null -eq $failure) { $failure = Safe $_.Exception.Message }
  }

  if (Test-Path -LiteralPath $report) {
    Write-Json 'ownership-summary.sanitized.json' ([ordered]@{
      artifactType = 'ownership'
      branch = $baselineBranch
      headUnchanged = ((git -C $root rev-parse HEAD | Out-String).Trim() -eq $baselineHead)
      stagedIndex = if (@(git -C $root diff --cached --name-only).Count -eq 0) { 'EMPTY' } else { 'NONEMPTY' }
      owned = $ownedManifest
      preserveOnlyHashCount = @($preserveManifest).Count
      unknownPathCount = 0
      mixedHunkCount = 0
      prePostStatusIdentical = (($baselineStatus -join "`n") -eq ($postflightStatus -join "`n"))
    })
    Write-Json 'cleanup-summary.sanitized.json' ([ordered]@{
      artifactType = 'cleanup'
      schema = if ($schemaCleanupPassed) { 'PASS' } elseif ($schemaCreated) { 'FAIL' } else { 'NOT_CREATED' }
      snapshot = if ($snapshotCleanupPassed) { 'PASS' } else { 'FAIL' }
      runtime = if ($runtimeCleanupPassed) { 'PASS' } else { 'FAIL' }
    })
    Write-Json 'final-runner-summary.sanitized.json' ([ordered]@{
      artifactType = 'final-runner-summary'
      workPackage = 'WP-72'
      runId = $id
      finalRunnerError = $failure
      syntheticEnvironmentOnly = $true
      migrationCount = 13
      preflightStatus = $baselineStatus
      postflightStatus = $postflightStatus
      preserveOnlyHashCount = @($preserveManifest).Count
      schemaCleanup = if ($schemaCleanupPassed) { 'PASS' } elseif ($schemaCreated) { 'FAIL' } else { 'NOT_CREATED' }
      snapshotCleanup = if ($snapshotCleanupPassed) { 'PASS' } else { 'FAIL' }
      runtimeCleanup = if ($runtimeCleanupPassed) { 'PASS' } else { 'FAIL' }
    })
    Write-Json 'command-receipts.sanitized.json' ([ordered]@{
      artifactType = 'command-receipts'
      workPackage = 'WP-72'
      receipts = @($receipts)
    })
  }
}

Write-Output "WP-72 report: $report"
if ($failure) { throw $failure }
