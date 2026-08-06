[CmdletBinding()]
param(
  [switch]$PreflightSelfTest,
  [string]$CleanupResidualRunId
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$id = Get-Date -Format 'yyyyMMddHHmmssfff'
$schema = "wp75_$id"
$marker = "wp75:$id"
$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$snapshot = Join-Path $temp "CelebrateDeal-WP75-$id"
$runtime = Join-Path $temp "CelebrateDeal-WP75-runtime-$id"
$report = Join-Path $root ".ai-team\reports\wp-75-accountant-affiliate-detail-direct-url-$id"
$preserveBaselineEvidence = Join-Path $root '.ai-team\reports\wp-74-accountant-affiliates-new-direct-url-20260730081256906\final-runner-summary.sanitized.json'
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
    (Join-Path $path '.wp75-marker'),
    $marker,
    [Text.UTF8Encoding]::new($false)
  )
}

function Assert-TemporaryArtifact([string]$path) {
  $full = [IO.Path]::GetFullPath($path)
  if (-not $full.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Temporary path escaped OS temp: $full"
  }
  if ($full.IndexOf($id, [StringComparison]::Ordinal) -lt 0) {
    throw "Temporary path is not run-scoped: $full"
  }
  $markerFile = Join-Path $full '.wp75-marker'
  if (-not (Test-Path -LiteralPath $markerFile -PathType Leaf)) {
    throw "Temporary marker missing: $full"
  }
  if ([IO.File]::ReadAllText($markerFile) -ne $marker) {
    throw "Temporary marker mismatch: $full"
  }
}

function Remove-ResidualArtifacts([string]$runId) {
  if ($runId -notmatch '^[0-9]{17}$') {
    throw 'Residual cleanup run ID must be exactly 17 digits.'
  }
  $residualMarker = "wp75:$runId"
  $targets = @(
    (Join-Path $temp "CelebrateDeal-WP75-$runId"),
    (Join-Path $temp "CelebrateDeal-WP75-runtime-$runId")
  )
  foreach ($target in $targets) {
    $full = [IO.Path]::GetFullPath($target)
    if (-not $full.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Residual target escaped OS temp: $full"
    }
    if ($full.IndexOf($runId, [StringComparison]::Ordinal) -lt 0) {
      throw "Residual target is not run-scoped: $full"
    }
    $markerFile = Join-Path $full '.wp75-marker'
    if (-not (Test-Path -LiteralPath $markerFile -PathType Leaf)) {
      throw "Residual marker missing: $full"
    }
    if ([IO.File]::ReadAllText($markerFile) -ne $residualMarker) {
      throw "Residual marker mismatch: $full"
    }
    Remove-Item -LiteralPath $full -Recurse -Force
    if (Test-Path -LiteralPath $full) {
      throw "Residual cleanup failed: $full"
    }
    Write-Output "WP-75 residual cleanup PASS: $full"
  }
}

if ($CleanupResidualRunId) {
  Remove-ResidualArtifacts $CleanupResidualRunId
  exit 0
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
    E2E_PORT = '31075'
    E2E_BASE_URL = 'http://127.0.0.1:31075'
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
    PLAYWRIGHT_JSON_OUTPUT_FILE = (Join-Path $snapshot '.wp75-browser.json')
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
    '.ai-team/scripts/Invoke-Wp75AccountantAffiliateDetailDirectUrlQa.ps1',
    'tests/e2e/accountant-affiliate-detail-direct-url.spec.ts'
  )
}

function Get-OwnershipInventory([string[]]$status) {
  $ownedPaths = Get-OwnedPaths
  if (-not (Test-Path -LiteralPath $preserveBaselineEvidence -PathType Leaf)) {
    throw 'Accepted WP-74 preserve baseline evidence is missing.'
  }
  $baselineEvidence = Get-Content -LiteralPath $preserveBaselineEvidence -Raw | ConvertFrom-Json
  if ($null -ne $baselineEvidence.finalRunnerError) {
    throw 'Accepted WP-74 preserve baseline is not a successful run.'
  }
  $baselineStatus = @($baselineEvidence.postflightStatus)
  $baselineStatusSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $baselinePathSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($line in $baselineStatus) {
    [void]$baselineStatusSet.Add([string]$line)
    [void]$baselinePathSet.Add(([string]$line).Substring(3).Replace('\', '/'))
  }
  $currentStatusSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $entries = @($status | ForEach-Object {
    $line = [string]$_
    [void]$currentStatusSet.Add($line)
    $relative = $line.Substring(3).Replace('\', '/')
    $classification = if ($relative -in $ownedPaths) {
      if ($baselinePathSet.Contains($relative)) { 'MIXED_HUNKS' } else { 'WP_OWNED' }
    } elseif ($baselineStatusSet.Contains($line)) {
      'PRESERVE_ONLY'
    } else {
      'UNKNOWN'
    }
    [ordered]@{
      status = $line.Substring(0, 2)
      path = $relative
      classification = $classification
    }
  })
  $missingBaseline = @($baselineStatus | Where-Object {
    -not $currentStatusSet.Contains([string]$_)
  })
  return [ordered]@{
    entries = $entries
    preserveOnly = @($entries | Where-Object classification -eq 'PRESERVE_ONLY')
    owned = @($entries | Where-Object classification -eq 'WP_OWNED')
    unknown = @($entries | Where-Object classification -eq 'UNKNOWN')
    mixedHunks = @($entries | Where-Object classification -eq 'MIXED_HUNKS')
    missingBaseline = $missingBaseline
  }
}

function Get-Manifest([string[]]$status, [string]$classification) {
  $inventory = Get-OwnershipInventory $status
  return @($inventory.entries | Where-Object classification -eq $classification | ForEach-Object {
    $relative = $_.path
    $full = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      throw "Manifest path missing: $relative"
    }
    [ordered]@{
      path = $relative
      sha256 = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
    }
  })
}

function Assert-SourceContract {
  $page = Get-Content -LiteralPath 'src/app/(app)/affiliates/[id]/page.tsx' -Raw
  $guard = $page.IndexOf('const vendor = await requireVendorManager();')
  $params = $page.IndexOf('const { id } = await params;', $guard)
  $query = $page.IndexOf('const affiliate = await getDb().affiliate.findFirst({', $params)
  $notFound = $page.IndexOf('if (!affiliate) notFound();', $query)
  $render = $page.IndexOf('title={affiliate.name}', $notFound)
  if ($guard -lt 0 -or $params -lt $guard -or $query -lt $params -or
      $notFound -lt $query -or $render -lt $notFound) {
    throw 'Affiliate detail guard/params/query/render order drift.'
  }
  foreach ($required in @(
    'where: { id, vendorId: vendor.id }',
    'clicks: { orderBy: { createdAt: "desc" }, take: 20 }',
    'commissions: { orderBy: { attributedAt: "desc" }, take: 20 }',
    'payouts: { orderBy: { createdAt: "desc" }, take: 10 }',
    'description={`推廣碼 ${affiliate.code} · ${affiliate.source ?? "未設定來源"}`}',
    'href={`/affiliates/${affiliate.id}/edit`}',
    '>佣金紀錄</h2>',
    '>推廣設定</h2>',
    '>最近來源事件</h2>',
    'href="/affiliates/commissions"',
    '查看完整分潤報表'
  )) {
    if (-not $page.Contains($required)) {
      throw "Affiliate detail contract drift: $required"
    }
  }

  $auth = Get-Content -LiteralPath 'src/lib/auth.ts' -Raw
  $managerStart = $auth.IndexOf('export async function requireVendorManager()')
  $managerEnd = $auth.IndexOf('export async function requireFinanceAdmin()', $managerStart)
  if ($managerStart -lt 0 -or $managerEnd -lt 0) {
    throw 'Vendor-manager authorization boundary missing.'
  }
  $managerSlice = $auth.Substring($managerStart, $managerEnd - $managerStart)
  foreach ($required in @(
    'auth.member.status !== ACTIVE_MEMBER_STATUS',
    'VENDOR_MANAGER_ROLES.includes',
    'redirect("/dashboard?error=insufficient_role");'
  )) {
    if (-not $managerSlice.Contains($required)) {
      throw "Vendor-manager authorization contract drift: $required"
    }
  }

  $shell = Get-Content -LiteralPath 'src/components/app-shell.tsx' -Raw
  foreach ($required in @(
    '{ href: "/affiliates", label: "聯盟夥伴", icon: Handshake, managerOnly: true }',
    '{ href: "/affiliates/commissions", label: "聯盟佣金", icon: Handshake, financeOnly: true }',
    'const isFinance = isManager || memberRole === "accountant";',
    'if ("financeOnly" in item && item.financeOnly && !isFinance) return false;',
    'return !("managerOnly" in item && item.managerOnly) || isManager;'
  )) {
    if (-not $shell.Contains($required)) {
      throw "Affiliate manager/finance navigation contract drift: $required"
    }
  }

  $dashboard = Get-Content -LiteralPath 'src/app/(app)/dashboard/page.tsx' -Raw
  foreach ($required in @(
    'db.affiliate.findMany({ where: { vendorId: vendor.id }, include: { clicks: true }, take: 5 })',
    '>聯盟來源摘要</h2>',
    '{affiliate.code}',
    '{affiliate.name}',
    '{affiliate.clicks.length}',
    '>點擊</span>'
  )) {
    if (-not $dashboard.Contains($required)) {
      throw "Lawful Dashboard affiliate-summary contract drift: $required"
    }
  }
}

function Preflight {
  if ($schema -notmatch '^wp75_[0-9]+$') { throw 'Invalid schema.' }
  if (@(git -C $root diff --cached --name-only).Count -ne 0) {
    throw 'Staged index must be empty.'
  }
  $status = @(git -C $root status --short)
  $ownedStatus = @(
    '?? .ai-team/scripts/Invoke-Wp75AccountantAffiliateDetailDirectUrlQa.ps1',
    '?? tests/e2e/accountant-affiliate-detail-direct-url.spec.ts'
  )
  if (@($status | Where-Object { $_ -in $ownedStatus }).Count -ne 2) {
    throw 'WP-75 owned paths missing or ownership is ambiguous.'
  }
  $inventory = Get-OwnershipInventory $status
  if (@($inventory.owned).Count -ne 2) {
    throw 'WP-75 ownership inventory does not contain both approved owned paths.'
  }
  if (@($inventory.unknown).Count -ne 0) {
    throw "Unknown ownership paths found: $(@($inventory.unknown).path -join ', ')"
  }
  if (@($inventory.mixedHunks).Count -ne 0) {
    throw "Mixed ownership paths found: $(@($inventory.mixedHunks).path -join ', ')"
  }
  if (@($inventory.missingBaseline).Count -ne 0) {
    throw "PRESERVE_ONLY baseline paths are missing or changed status: $($inventory.missingBaseline -join ', ')"
  }
  if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port 54329 -InformationLevel Quiet)) {
    throw 'Local disposable DB unavailable.'
  }
  if (Test-NetConnection -ComputerName '127.0.0.1' -Port 31075 -InformationLevel Quiet -WarningAction SilentlyContinue) {
    throw 'WP-75 release port 31075 is already in use.'
  }
  Push-Location $root
  try {
    Assert-SourceContract
  } finally {
    Pop-Location
  }
  return $status
}

if ($PreflightSelfTest) {
  $null = Preflight
  Write-Output 'WP-75 preflight PASS'
  exit 0
}

try {
  $baselineStatus = Preflight
  $baselineBranch = (git -C $root branch --show-current | Out-String).Trim()
  $baselineHead = (git -C $root rev-parse HEAD | Out-String).Trim()
  $preserveManifest = Get-Manifest $baselineStatus 'PRESERVE_ONLY'
  $ownedManifest = Get-Manifest $baselineStatus 'WP_OWNED'
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
    Replace('timeout: 120_000', 'timeout: 300_000').
    Replace('reuseExistingServer: !process.env.CI', 'reuseExistingServer: false')
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
    $bootstrap = Join-Path $snapshot 'wp75-bootstrap.sql'
    [IO.File]::WriteAllText(
      $bootstrap,
      "CREATE SCHEMA IF NOT EXISTS `"$schema`";`nCOMMENT ON SCHEMA `"$schema`" IS '$marker';",
      [Text.UTF8Encoding]::new($false)
    )
    if ((Invoke-Child 'database-bootstrap' $node @($prisma, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', '.\wp75-bootstrap.sql') $run) -ne 0) {
      throw 'Bootstrap failed.'
    }
    $schemaCreated = $true
    if ((Invoke-Child 'migrate-deploy' $node @($prisma, 'migrate', 'deploy') $run) -ne 0) {
      throw 'Migrate deploy failed.'
    }
    if ((Invoke-Child 'migrate-status' $node @($prisma, 'migrate', 'status') $run) -ne 0) {
      throw 'Migrate status failed.'
    }
    if ((Invoke-Child 'spec-eslint' $node @('node_modules/eslint/bin/eslint.js', 'tests/e2e/accountant-affiliate-detail-direct-url.spec.ts') $run) -ne 0) {
      throw 'Spec lint failed.'
    }
    if ((Invoke-Child 'auth-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/auth.test.ts') $run) -ne 0) {
      throw 'Auth tests failed.'
    }
    if ((Invoke-Child 'app-shell-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/components/app-shell.test.ts') $run) -ne 0) {
      throw 'App-shell tests failed.'
    }
    if ((Invoke-Child 'affiliate-performance-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/affiliate-performance.test.ts') $run) -ne 0) {
      throw 'Affiliate performance tests failed.'
    }
    if ((Invoke-Child 'format-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/format.test.ts') $run) -ne 0) {
      throw 'Format tests failed.'
    }
    if ((Invoke-Child 'affiliate-commission-unit' $node @('node_modules/vitest/vitest.mjs', 'run', 'src/lib/affiliate-commission.test.ts') $run) -ne 0) {
      throw 'Affiliate commission invariant tests failed.'
    }
    if ((Invoke-Child 'browser-e2e' $node @('node_modules/@playwright/test/cli.js', 'test', 'tests/e2e/accountant-affiliate-detail-direct-url.spec.ts', '--project=chromium', '--retries=0', '--reporter=json') $run) -ne 0) {
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
    assertion = 'Spec compares complete Vendor, TrackingSetting, User, VendorMember, Affiliate, converted/unconverted AffiliateClick, pending/approved AffiliateCommission, and AffiliatePayout rows plus global, tenant, status, composite, membership, and relation counts; it records no post-authentication POST, non-loopback, or .invalid request.'
    result = 'UNCHANGED'
  })
  Write-Json 'coverage-boundary.sanitized.json' ([ordered]@{
    artifactType = 'coverage-boundary'
    detailPage = 'Static guard-before-params/query/render contract plus release-mode Browser denial.'
    detailQuery = 'Browser fixture and DB equality cover the queried Affiliate, AffiliateClick, AffiliateCommission, and AffiliatePayout rows.'
    commissionLedger = 'Not created or reviewed because the detail query does not include ledgerEntries; accounting lifecycle remains outside WP-75.'
    affiliatePerformance = 'Two dynamic unit tests.'
    affiliateCommission = 'Six dynamic invariant tests cover amount, identity, stable token, beneficiary, status-transition, and refund boundaries without reviewing ledger accounting.'
    format = 'Two dynamic format helper tests.'
  })
} catch {
  $failure = Safe $_.Exception.Message
} finally {
  if ($schemaCreated) {
    try {
      $run = Get-Environment
      $cleanup = Join-Path $snapshot 'wp75-cleanup.sql'
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
          '.\wp75-cleanup.sql'
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
    $postPreserveManifest = Get-Manifest $postflightStatus 'PRESERVE_ONLY'
    if (($preserveManifest | ConvertTo-Json -Compress) -ne ($postPreserveManifest | ConvertTo-Json -Compress)) {
      throw 'PRESERVE_ONLY content changed during run.'
    }
    $postOwnedManifest = Get-Manifest $postflightStatus 'WP_OWNED'
    if (($ownedManifest | ConvertTo-Json -Compress) -ne ($postOwnedManifest | ConvertTo-Json -Compress)) {
      throw 'WP-75 owned content changed during run.'
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
    $postOwnershipInventory = Get-OwnershipInventory $postflightStatus
    Write-Json 'ownership-summary.sanitized.json' ([ordered]@{
      artifactType = 'ownership'
      branch = $baselineBranch
      headUnchanged = ((git -C $root rev-parse HEAD | Out-String).Trim() -eq $baselineHead)
      stagedIndex = if (@(git -C $root diff --cached --name-only).Count -eq 0) { 'EMPTY' } else { 'NONEMPTY' }
      owned = $ownedManifest
      preserveOnlyHashCount = @($preserveManifest).Count
      preserveOnlyPaths = @($postOwnershipInventory.preserveOnly | ForEach-Object path)
      unknownPaths = @($postOwnershipInventory.unknown | ForEach-Object path)
      mixedHunkPaths = @($postOwnershipInventory.mixedHunks | ForEach-Object path)
      missingBaselineStatus = @($postOwnershipInventory.missingBaseline)
      unknownPathCount = @($postOwnershipInventory.unknown).Count
      mixedHunkCount = @($postOwnershipInventory.mixedHunks).Count
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
      workPackage = 'WP-75'
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
      workPackage = 'WP-75'
      receipts = @($receipts)
    })
  }
}

Write-Output "WP-75 report: $report"
if ($failure) { throw $failure }
