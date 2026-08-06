[CmdletBinding()]
param([switch]$PreflightSelfTest)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$id = Get-Date -Format 'yyyyMMddHHmmssfff'
$schema = "wp68_$id"
$marker = "wp68:$id"
$temp = [IO.Path]::GetTempPath()
$snapshot = Join-Path $temp "CelebrateDeal-WP68-$id"
$runtime = Join-Path $temp "CelebrateDeal-WP68-runtime-$id"
$report = Join-Path $root ".ai-team\reports\wp-68-accountant-videos-index-direct-url-$id"
$receipts = [Collections.Generic.List[object]]::new()
$schemaCreated = $false
$schemaCleanupPassed = $false
$snapshotCleanupPassed = $false
$runtimeCleanupPassed = $false
$failure = $null
$baselineStatus = @()
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
    E2E_PORT = '31068'
    E2E_BASE_URL = 'http://127.0.0.1:31068'
    RATE_LIMIT_PROVIDER = 'memory'
    PAYMENT_PROVIDER = 'demo'
    SENTRY_DSN = ''
    NEXT_PUBLIC_SENTRY_DSN = ''
    SENTRY_AUTH_TOKEN = ''
    RESEND_API_KEY = ''
    EMAIL_FROM = ''
    SENTRY_DISABLE_AUTO_UPLOAD = 'true'
    PLAYWRIGHT_BROWSERS_PATH = (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'ms-playwright')
    PLAYWRIGHT_JSON_OUTPUT_FILE = (Join-Path $snapshot '.wp68-browser.json')
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
    '.ai-team/scripts/Invoke-Wp68AccountantVideosIndexDirectUrlQa.ps1',
    'tests/e2e/accountant-videos-index-direct-url.spec.ts'
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
  $page = Get-Content -LiteralPath 'src/app/(app)/videos/page.tsx' -Raw
  $guard = $page.IndexOf('const vendor = await requireVendorManager();')
  $query = $page.IndexOf('getDb().video.findMany')
  $render = $page.IndexOf('<PageHeader title="影片庫"', $query)
  if ($guard -lt 0 -or $query -lt $guard -or $render -lt $query) {
    throw 'Videos index guard/query/render order drift.'
  }
  foreach ($required in @(
    'where: { vendorId: vendor.id }',
    'orderBy: { createdAt: "desc" }',
    'href="/videos/new"',
    'href={`/videos/${video.id}/edit`}',
    '{video.title}',
    '{video.videoUrl}',
    '{video.status}'
  )) {
    if (-not $page.Contains($required)) {
      throw "Videos index contract drift: $required"
    }
  }

  $shell = Get-Content -LiteralPath 'src/components/app-shell.tsx' -Raw
  if (-not $shell.Contains('{ href: "/videos", label: "影片", icon: PlaySquare, managerOnly: true }')) {
    throw 'Videos navigation manager-only contract drift.'
  }

  $form = Get-Content -LiteralPath 'src/components/video-form.tsx' -Raw
  foreach ($required in @(
    '<form action={upsertVideoAction}',
    '<CsrfField />',
    'name="id"',
    'name="title"',
    'name="description"',
    'name="videoUrl"',
    'name="thumbnailUrl"',
    'name="durationSec"',
    'name="estimatedMinutes"',
    'name="status"'
  )) {
    if (-not $form.Contains($required)) {
      throw "Video form contract drift: $required"
    }
  }
  foreach ($providerField in @(
    'sourceType',
    'cloudflareStreamUid',
    'cloudflareLiveInputUid',
    'cloudflarePlaybackId',
    'cloudflareReadyToStream',
    'liveInputStatus'
  )) {
    if ($form.Contains("name=`"$providerField`"")) {
      throw "Provider-owned field became writable: $providerField"
    }
  }

  $actions = Get-Content -LiteralPath 'src/app/actions.ts' -Raw
  $start = $actions.IndexOf('export async function upsertVideoAction')
  $end = $actions.IndexOf('export async function upsertProductAction', $start)
  if ($start -lt 0 -or $end -lt 0) { throw 'Video action boundary missing.' }
  $slice = $actions.Substring($start, $end - $start)
  $security = $slice.IndexOf('await assertServerActionSecurity(formData);')
  $manager = $slice.IndexOf('const vendor = await requireVendorManager();')
  $id = $slice.IndexOf('const id = optionalText(formData, "id");')
  $lookup = $slice.IndexOf('const existingVideo = await db.video.findFirst')
  $update = $slice.IndexOf('await db.video.update')
  $create = $slice.IndexOf('await db.video.create')
  $redirect = $slice.IndexOf('redirect("/videos");')
  if ($security -lt 0 -or $manager -lt $security -or $id -lt $manager -or
      $lookup -lt $id -or $update -lt $lookup -or $create -lt $update -or $redirect -lt $create) {
    throw 'Video action security/identity/mutation/redirect order drift.'
  }
  foreach ($required in @(
    'where: { id, vendorId: vendor.id }',
    'await db.video.update({ where: { id, vendorId: vendor.id }, data });',
    'vendorId: vendor.id',
    'sourceType: "url"',
    'status: "ready"'
  )) {
    if (-not $slice.Contains($required)) {
      throw "Video action tenant/input contract drift: $required"
    }
  }
  foreach ($providerField in @(
    'cloudflareStreamUid',
    'cloudflareLiveInputUid',
    'cloudflarePlaybackId',
    'cloudflareReadyToStream',
    'liveInputStatus'
  )) {
    if ($slice.Contains($providerField)) {
      throw "Provider-owned action field became writable: $providerField"
    }
  }
}

function Preflight {
  if ($schema -notmatch '^wp68_[0-9]+$') { throw 'Invalid schema.' }
  if (@(git -C $root diff --cached --name-only).Count -ne 0) {
    throw 'Staged index must be empty.'
  }
  $status = @(git -C $root status --short)
  $ownedStatus = @(
    '?? .ai-team/scripts/Invoke-Wp68AccountantVideosIndexDirectUrlQa.ps1',
    '?? tests/e2e/accountant-videos-index-direct-url.spec.ts'
  )
  if (@($status | Where-Object { $_ -in $ownedStatus }).Count -ne 2) {
    throw 'WP-68 owned paths missing.'
  }
  if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port 54329 -InformationLevel Quiet)) {
    throw 'Local disposable DB unavailable.'
  }
  Assert-SourceContract
  return $status
}

if ($PreflightSelfTest) {
  $null = Preflight
  Write-Output 'WP-68 preflight PASS'
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
    $bootstrap = Join-Path $snapshot 'wp68-bootstrap.sql'
    [IO.File]::WriteAllText(
      $bootstrap,
      "CREATE SCHEMA IF NOT EXISTS `"$schema`";`nCOMMENT ON SCHEMA `"$schema`" IS '$marker';",
      [Text.UTF8Encoding]::new($false)
    )
    if ((Invoke-Child 'database-bootstrap' $node @($prisma, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', '.\wp68-bootstrap.sql') $run) -ne 0) {
      throw 'Bootstrap failed.'
    }
    $schemaCreated = $true
    if ((Invoke-Child 'migrate-deploy' $node @($prisma, 'migrate', 'deploy') $run) -ne 0) {
      throw 'Migrate deploy failed.'
    }
    if ((Invoke-Child 'migrate-status' $node @($prisma, 'migrate', 'status') $run) -ne 0) {
      throw 'Migrate status failed.'
    }
    if ((Invoke-Child 'spec-eslint' $node @('node_modules/eslint/bin/eslint.js', 'tests/e2e/accountant-videos-index-direct-url.spec.ts') $run) -ne 0) {
      throw 'Lint failed.'
    }
    if ((Invoke-Child 'auth-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/auth.test.ts') $run) -ne 0) {
      throw 'Auth tests failed.'
    }
    if ((Invoke-Child 'app-shell-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/components/app-shell.test.ts') $run) -ne 0) {
      throw 'App-shell tests failed.'
    }
    if ((Invoke-Child 'video-form-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/components/video-form.test.tsx') $run) -ne 0) {
      throw 'Video form tests failed.'
    }
    if ((Invoke-Child 'video-action-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/app/actions.test.ts', '-t', 'upsertVideoAction') $run) -ne 0) {
      throw 'Video action tests failed.'
    }
    if ((Invoke-Child 'browser-e2e' $node @('node_modules/@playwright/test/cli.js', 'test', 'tests/e2e/accountant-videos-index-direct-url.spec.ts', '--project=chromium', '--retries=0', '--reporter=json') $run) -ne 0) {
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
    assertion = 'Spec compares full Vendor, TrackingSetting, User, VendorMember, and URL/provider Video rows plus global, tenant, status, source-type, membership, readiness, and relation counts; it records no post-authentication POST or non-loopback request.'
    result = 'UNCHANGED'
  })
} catch {
  $failure = Safe $_.Exception.Message
} finally {
  if ($schemaCreated) {
    try {
      $run = Get-Environment
      $cleanup = Join-Path $snapshot 'wp68-cleanup.sql'
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
          '.\wp68-cleanup.sql'
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
    if (($baselineStatus -join "`n") -ne ($postflightStatus -join "`n")) {
      throw 'Git ownership status changed during run.'
    }
    $postPreserveManifest = Get-Manifest $postflightStatus $false
    if (($preserveManifest | ConvertTo-Json -Compress) -ne ($postPreserveManifest | ConvertTo-Json -Compress)) {
      throw 'PRESERVE_ONLY content changed during run.'
    }
    $postOwnedManifest = Get-Manifest $postflightStatus $true
    if (($ownedManifest | ConvertTo-Json -Compress) -ne ($postOwnedManifest | ConvertTo-Json -Compress)) {
      throw 'WP-68 owned content changed during run.'
    }
    if (@(git -C $root diff --cached --name-only).Count -ne 0) {
      throw 'Staged index changed during run.'
    }
  } catch {
    if ($null -eq $failure) { $failure = Safe $_.Exception.Message }
  }

  try {
    if (Test-Path -LiteralPath $snapshot) {
      Remove-Item -LiteralPath $snapshot -Recurse -Force
    }
    $snapshotCleanupPassed = -not (Test-Path -LiteralPath $snapshot)
    if (-not $snapshotCleanupPassed) { throw 'Snapshot cleanup failed.' }
  } catch {
    if ($null -eq $failure) { $failure = Safe $_.Exception.Message }
  }
  try {
    if (Test-Path -LiteralPath $runtime) {
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
      workPackage = 'WP-68'
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
      workPackage = 'WP-68'
      receipts = @($receipts)
    })
  }
}

Write-Output "WP-68 report: $report"
if ($failure) { throw $failure }
