[CmdletBinding()]
param(
    [string]$ReportRoot = ".ai-team\reports",
    # Exercises only pure preflight guards. It never snapshots, connects to a
    # database, or creates workspace artifacts.
    [switch]$PreflightSelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# WP-48 never reads or copies .env files. Every child receives this bounded,
# synthetic environment, and the database URL is passed only in its environment.
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$approvedBranch = "chore/ai-team-v5.1-migration"
$approvedHead = "a06fe1720b2e9d4eb17b59bdd67ebe5b9281f466"
$playwrightBrowserCache = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) "ms-playwright"
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssfff")
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$snapshotRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot "CelebrateDeal-WP47-$runId"))
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot "CelebrateDeal-WP47-runtime-$runId"))
$snapshotMarker = ".wp47-snapshot-$runId"
$runtimeMarker = ".wp47-runtime-$runId"
$schema = "wp48_$runId"
$schemaMarker = "wp47:$runId"
$reportDirectory = Join-Path ([IO.Path]::GetFullPath((Join-Path $workspaceRoot $ReportRoot))) "wp-48-accountant-foreign-message-template-edit-direct-url-$runId"
$logDirectory = Join-Path $workspaceRoot ".ai-team\logs\wp-47\$runId"

if (-not $snapshotRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
    -not $runtimeRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $snapshotRoot -eq $runtimeRoot) {
    throw "WP-48 temporary paths must be distinct children of the system temporary directory."
}
if ($schema -notmatch '^wp48_[a-z0-9_]+$') { throw "WP-48 schema name is invalid." }

$receipts = [System.Collections.Generic.List[object]]::new()
$snapshotCreated = $false
$runtimeCreated = $false
$schemaCreated = $false
$schemaCleanup = "NOT_RUN"
$snapshotCleanup = "NOT_RUN"
$runtimeCleanup = "NOT_RUN"
$runnerFailure = $null
$preflight = $null
$sourceManifestPreflight = @()
$protectedPreflight = @()
$preserveOnlyPreflight = @()
$packageLockPreflight = $null

function Write-Utf8File([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Sanitize-Text([string]$Value) {
    if ($null -eq $Value) { return "" }
    $safe = $Value -replace '(?i)postgres(?:ql)?://[^\s"''`]+', '[REDACTED_DATABASE_URL]'
    $safe = $safe -replace '(?i)(api[_-]?key|token|secret|password|authorization)\s*([=:])\s*[^\s,;]+', '$1$2[REDACTED]'
    $safe = $safe -replace '(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[REDACTED_EMAIL]'
    $safe = $safe -replace '(?i)wp44-(?:own|foreign)-[a-f0-9]+', '[REDACTED_SYNTHETIC_CANARY]'
    return $safe
}

function Add-Receipt([string]$Name, [int]$ExitCode, [long]$DurationMs, [string]$Stdout, [string]$Stderr) {
    $sanitized = Sanitize-Text (($Stdout + "`n" + $Stderr).Trim())
    $receipts.Add([ordered]@{
        name = $Name
        exit_code = $ExitCode
        duration_ms = $DurationMs
        classification = if ($ExitCode -eq 0) { "PASS" } else { "FAIL" }
        raw_stdout_log = "$Name.stdout.log"
        raw_stderr_log = "$Name.stderr.log"
        sanitized_summary = $sanitized.Substring(0, [Math]::Min(4000, $sanitized.Length))
    }) | Out-Null
}

function Add-BlockedReceipt([string]$Name, [string]$Reason) {
    $receipts.Add([ordered]@{ name = $Name; exit_code = $null; duration_ms = 0; classification = "BLOCKED_BY_TEST_INFRA"; raw_stdout_log = $null; raw_stderr_log = $null; sanitized_summary = Sanitize-Text $Reason }) | Out-Null
}

function Get-GitState {
    return [ordered]@{
        branch = ((& git -C $workspaceRoot branch --show-current) -join "`n")
        head = ((& git -C $workspaceRoot rev-parse HEAD) -join "`n")
        status = @(& git -C $workspaceRoot status --porcelain=v1)
        staged = @(& git -C $workspaceRoot diff --cached --name-only)
    }
}

function Get-ProtectedManifest {
    $items = @(
        [ordered]@{ path = "tests/e2e/smoke.spec.ts"; expected_sha256 = "85F369DA012D4CB1098F8E0D2B95D5A01E92860D7C640231F48A7B6DD3B42AF8" },
        [ordered]@{ path = "docs/ai-team/handoff-schema.md"; expected_sha256 = "107A9E0ADD0E2BEEF14968F07EFC439E5C3851F243794F5EF02610DC17B6DC4F" },
        [ordered]@{ path = "docs/launch/wp08-product-browser-qa-20260728.md"; expected_sha256 = "0182241204849EE3B290653E4344F01FB33B608D81C66EBC1C8D53C53D123CED" }
    )
    return @($items | ForEach-Object {
        $fullPath = Join-Path $workspaceRoot $_.path
        $hash = if (Test-Path -LiteralPath $fullPath -PathType Leaf) { (Get-FileHash -Algorithm SHA256 -LiteralPath $fullPath).Hash } else { $null }
        [ordered]@{ path = $_.path; expected_sha256 = $_.expected_sha256; sha256 = $hash; match = $hash -eq $_.expected_sha256 }
    })
}

function Get-OwnershipManifest {
    # Exact reviewed ownership prevents a later dirty path from being silently
    # absorbed into this evidence run.
    return [ordered]@{
        preserve_only = @(
            " M .agents/skills/ai-team-lite/SKILL.md",
            " M .ai-team/scripts/Invoke-AgyFast.ps1",
            " M AGENTS.md",
            " M docs/ai-team/ARCHITECTURE.md",
            " M docs/ai-team/GOAL-PROTOCOL.md",
            " M docs/ai-team/README.md",
            " M docs/ai-team/ROUTING.md",
            " M docs/ai-team/handoff-schema.md",
            " M docs/ai-team/master-execution-plan.md",
            " M docs/ai-team/prompts/executor-prompt.md",
            " M docs/ai-team/prompts/planner-prompt.md",
            " M docs/ai-team/workflow-mode.md",
            " M docs/ai-team/workflow-policy.md",
            " M docs/launch/evidence-index.md",
            " M docs/launch/next-work-packages.md",
            " M docs/launch/production-readiness-baseline.md",
            " M docs/launch/wp08-product-browser-qa-20260728.md",
            " M src/app/(app)/billing/plans/page.tsx",
            " M src/app/(app)/lives/[id]/preview/page.tsx",
            " M src/components/ui.tsx",
            " M tests/e2e/smoke.spec.ts",
            "?? .ai-team/scripts/Invoke-Wp25WebinarOwnerBoundaryQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp28AccountantManagerDirectUrlQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp29AdminManagerDirectUrlQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp30AccountantPlatformAdminDirectUrlQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp31AdminCrossTenantProductEditQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp32AdminCrossTenantFormSubmissionsQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp33AccountantFormsNewDirectUrlQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp34AdminCrossTenantFormEditQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp35AdminFormsIndexTenantIsolationQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp36AdminCrossTenantAffiliateEditQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp37OwnerCrossTenantMessageTemplateEditQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp38OwnerBlacklistIndexTenantIsolationQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp39OwnerCrossTenantLiveAnalyticsQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp40AdminCrossTenantVideoEditQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp41AdminCrossTenantLivePreviewQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp42AdminCrossTenantInteractionScriptEditQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp43AccountantForeignInteractionRoleDirectUrlQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp44AccountantForeignProductEditDirectUrlQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp45AccountantForeignVideoEditDirectUrlQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp46AccountantForeignLiveEditDirectUrlQa.ps1",
            "?? .ai-team/scripts/Invoke-Wp47AccountantForeignAffiliateEditDirectUrlQa.ps1",
            "?? docs/launch/m2-security-authorization-inventory-20260729.md",
            "?? tests/e2e/accountant-manager-direct-url.spec.ts",
            "?? tests/e2e/admin-manager-direct-url.spec.ts",
            "?? tests/e2e/accountant-platform-admin-direct-url.spec.ts",
            "?? tests/e2e/admin-cross-tenant-product-edit.spec.ts",
            "?? tests/e2e/admin-cross-tenant-form-submissions.spec.ts",
            "?? tests/e2e/accountant-forms-new-direct-url.spec.ts",
            "?? tests/e2e/admin-cross-tenant-form-edit.spec.ts",
            "?? tests/e2e/admin-forms-index-tenant-isolation.spec.ts",
            "?? tests/e2e/admin-cross-tenant-affiliate-edit.spec.ts",
            "?? tests/e2e/owner-cross-tenant-message-template-edit.spec.ts",
            "?? tests/e2e/owner-blacklist-index-tenant-isolation.spec.ts",
            "?? tests/e2e/owner-cross-tenant-live-analytics.spec.ts",
            "?? tests/e2e/admin-cross-tenant-video-edit.spec.ts",
            "?? tests/e2e/admin-cross-tenant-live-preview.spec.ts",
            "?? tests/e2e/admin-cross-tenant-interaction-script-edit.spec.ts",
            "?? tests/e2e/accountant-foreign-interaction-role-direct-url.spec.ts",
            "?? tests/e2e/accountant-foreign-product-edit-direct-url.spec.ts",
            "?? tests/e2e/accountant-foreign-video-edit-direct-url.spec.ts",
            "?? tests/e2e/accountant-foreign-live-edit-direct-url.spec.ts",
            "?? tests/e2e/accountant-foreign-affiliate-edit-direct-url.spec.ts",
            "?? tests/e2e/webinar-owner-boundary.spec.ts"
        )
        wp_owned = @(
            "?? .ai-team/scripts/Invoke-Wp48AccountantForeignMessageTemplateEditDirectUrlQa.ps1",
            "?? tests/e2e/accountant-foreign-message-template-edit-direct-url.spec.ts"
        )
    }
}

function Assert-GitBaseline([string]$Branch, [string]$Head, [string]$Phase) {
    if ($Branch -ne $approvedBranch) { throw "WP-48 branch mismatch during $Phase." }
    if ($Head -ne $approvedHead) { throw "WP-48 HEAD mismatch during $Phase." }
}

function Assert-OwnershipInventory([string[]]$Status, [string]$Phase) {
    $manifest = Get-OwnershipManifest
    $expected = @($manifest.preserve_only + $manifest.wp_owned | Sort-Object)
    $actual = @($Status | Sort-Object)
    if (($actual -join "`n") -ne ($expected -join "`n")) {
        $unexpected = @($actual | Where-Object { $_ -notin $expected })
        $missing = @($expected | Where-Object { $_ -notin $actual })
        throw "WP-48 ownership mismatch during $Phase. unexpected=$($unexpected -join ';'); missing=$($missing -join ';')"
    }
    return [ordered]@{ phase = $Phase; preserve_only_count = $manifest.preserve_only.Count; wp_owned_count = $manifest.wp_owned.Count; total_count = $expected.Count; status = $actual }
}

function Get-PreserveOnlyManifest {
    $manifest = Get-OwnershipManifest
    return @($manifest.preserve_only | ForEach-Object {
        $relative = $_.Substring(3).Replace('/', [IO.Path]::DirectorySeparatorChar)
        $fullPath = Join-Path $workspaceRoot $relative
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Preserve-only path is missing: $relative" }
        [ordered]@{ path = $relative.Replace('\', '/'); sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $fullPath).Hash }
    })
}

function Assert-ManifestStable($Before, $After, [string]$Name) {
    if (($Before | ConvertTo-Json -Compress) -ne ($After | ConvertTo-Json -Compress)) { throw "WP-48 $Name changed during the execution window." }
}

function Assert-Rejected([scriptblock]$Action, [string]$Name) {
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    if (-not $rejected) { throw "WP-48 preflight self-test accepted: $Name" }
}

function Invoke-PreflightSelfTest {
    $manifest = Get-OwnershipManifest
    $expected = @($manifest.preserve_only + $manifest.wp_owned)
    Assert-GitBaseline $approvedBranch $approvedHead "self-test-positive"
    [void](Assert-OwnershipInventory $expected "self-test-positive")
    Assert-Rejected { Assert-GitBaseline $approvedBranch "8a78acd1b6cf22978a71eff4d7448a3730006d44" "self-test-old-head" } "old HEAD"
    Assert-Rejected { Assert-GitBaseline "other-branch" $approvedHead "self-test-other-branch" } "other branch"
    Assert-Rejected { [void](Assert-OwnershipInventory @($expected + "?? __wp48_unknown_path__") "self-test-unknown") } "unknown path"
    Assert-Rejected { [void](Assert-OwnershipInventory @($expected | Where-Object { $_ -ne " M tests/e2e/smoke.spec.ts" }) "self-test-missing") } "missing preserve-only path"
    Assert-Rejected { Assert-ManifestStable @([ordered]@{ path = "tests/e2e/smoke.spec.ts"; sha256 = "before" }) @([ordered]@{ path = "tests/e2e/smoke.spec.ts"; sha256 = "after" }) "preserve-only manifest" } "preserve-only mutation"
    Write-Output "WP-48 preflight self-test PASS: fixed branch/HEAD plus 64 PRESERVE_ONLY and 2 WP_OWNED guards."
}

function Get-SourceManifest {
    $untrackedAllowlist = @(
        "docs/launch/m2-security-authorization-inventory-20260729.md",
        ".ai-team/scripts/Invoke-Wp25WebinarOwnerBoundaryQa.ps1",
        ".ai-team/scripts/Invoke-Wp28AccountantManagerDirectUrlQa.ps1",
        ".ai-team/scripts/Invoke-Wp29AdminManagerDirectUrlQa.ps1",
        ".ai-team/scripts/Invoke-Wp30AccountantPlatformAdminDirectUrlQa.ps1",
        ".ai-team/scripts/Invoke-Wp31AdminCrossTenantProductEditQa.ps1",
        ".ai-team/scripts/Invoke-Wp32AdminCrossTenantFormSubmissionsQa.ps1",
        ".ai-team/scripts/Invoke-Wp33AccountantFormsNewDirectUrlQa.ps1",
        ".ai-team/scripts/Invoke-Wp34AdminCrossTenantFormEditQa.ps1",
        ".ai-team/scripts/Invoke-Wp35AdminFormsIndexTenantIsolationQa.ps1",
        ".ai-team/scripts/Invoke-Wp36AdminCrossTenantAffiliateEditQa.ps1",
        ".ai-team/scripts/Invoke-Wp37OwnerCrossTenantMessageTemplateEditQa.ps1",
        ".ai-team/scripts/Invoke-Wp38OwnerBlacklistIndexTenantIsolationQa.ps1",
        ".ai-team/scripts/Invoke-Wp39OwnerCrossTenantLiveAnalyticsQa.ps1",
        ".ai-team/scripts/Invoke-Wp40AdminCrossTenantVideoEditQa.ps1",
        ".ai-team/scripts/Invoke-Wp41AdminCrossTenantLivePreviewQa.ps1",
        ".ai-team/scripts/Invoke-Wp42AdminCrossTenantInteractionScriptEditQa.ps1",
        ".ai-team/scripts/Invoke-Wp43AccountantForeignInteractionRoleDirectUrlQa.ps1",
        ".ai-team/scripts/Invoke-Wp44AccountantForeignProductEditDirectUrlQa.ps1",
        ".ai-team/scripts/Invoke-Wp45AccountantForeignVideoEditDirectUrlQa.ps1",
        ".ai-team/scripts/Invoke-Wp46AccountantForeignLiveEditDirectUrlQa.ps1",
        ".ai-team/scripts/Invoke-Wp47AccountantForeignAffiliateEditDirectUrlQa.ps1",
        ".ai-team/scripts/Invoke-Wp48AccountantForeignMessageTemplateEditDirectUrlQa.ps1",
        "tests/e2e/accountant-manager-direct-url.spec.ts",
        "tests/e2e/admin-manager-direct-url.spec.ts",
        "tests/e2e/accountant-platform-admin-direct-url.spec.ts",
        "tests/e2e/webinar-owner-boundary.spec.ts",
        "tests/e2e/admin-cross-tenant-product-edit.spec.ts",
        "tests/e2e/admin-cross-tenant-form-submissions.spec.ts",
        "tests/e2e/accountant-forms-new-direct-url.spec.ts",
        "tests/e2e/admin-cross-tenant-form-edit.spec.ts",
        "tests/e2e/admin-forms-index-tenant-isolation.spec.ts",
        "tests/e2e/admin-cross-tenant-affiliate-edit.spec.ts",
        "tests/e2e/owner-cross-tenant-message-template-edit.spec.ts",
        "tests/e2e/owner-blacklist-index-tenant-isolation.spec.ts",
        "tests/e2e/owner-cross-tenant-live-analytics.spec.ts",
        "tests/e2e/admin-cross-tenant-video-edit.spec.ts",
        "tests/e2e/admin-cross-tenant-live-preview.spec.ts",
        "tests/e2e/admin-cross-tenant-interaction-script-edit.spec.ts",
        "tests/e2e/accountant-foreign-interaction-role-direct-url.spec.ts",
        "tests/e2e/accountant-foreign-product-edit-direct-url.spec.ts",
        "tests/e2e/accountant-foreign-video-edit-direct-url.spec.ts",
        "tests/e2e/accountant-foreign-live-edit-direct-url.spec.ts",
        "tests/e2e/accountant-foreign-affiliate-edit-direct-url.spec.ts",
        "tests/e2e/accountant-foreign-message-template-edit-direct-url.spec.ts"
    )
    $paths = @((@(& git -C $workspaceRoot ls-files --cached) + $untrackedAllowlist) | Sort-Object -Unique)
    return @($paths | ForEach-Object {
        $relative = $_.Replace('/', [IO.Path]::DirectorySeparatorChar)
        $fullPath = [IO.Path]::GetFullPath((Join-Path $workspaceRoot $relative))
        if (-not $fullPath.StartsWith("$workspaceRoot$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) { throw "Source manifest path escaped the workspace." }
        # A tracked template such as `.env.example` is not source integrity
        # input for this no-dotenv runner. Exclude it by path without opening
        # or hashing its contents.
        if ($relative -notmatch '(^|[\\/])\.env') {
            if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Source manifest path is missing: $($_)" }
            [ordered]@{ path = $_.Replace('\', '/'); sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $fullPath).Hash; bytes = (Get-Item -LiteralPath $fullPath).Length }
        }
    })
}

function Write-Json([string]$Name, $Value) {
    $Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $reportDirectory $Name) -Encoding utf8
}

function Remove-MarkedTemporaryDirectory([string]$Path, [string]$Marker, [string]$Kind) {
    # Validate once before deletion; a recursive remove can delete the marker
    # before Windows releases a child file handle, so retries must keep the
    # already-validated exact path instead of weakening the boundary check.
    $normalizedTempRoot = $tempRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    if (-not $Path.StartsWith($normalizedTempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetDirectoryName($Path) -ne $normalizedTempRoot -or
        -not (Test-Path -LiteralPath (Join-Path $Path $Marker) -PathType Leaf)) {
        throw "WP-48 $Kind cleanup marker or path check failed."
    }
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            if (-not (Test-Path -LiteralPath $Path)) { return "PASS" }
        } catch {
            if ($attempt -eq 5) { throw }
            Start-Sleep -Milliseconds 1000
        }
    }
    throw "WP-48 $Kind cleanup left an unexpected path."
}

function Assert-Preflight([System.Collections.IDictionary]$GitState, $ProtectedManifest) {
    if (@($GitState.staged).Count -ne 0) { throw "WP-48 requires an empty staged index." }
    Assert-GitBaseline $GitState.branch $GitState.head "preflight"
    [void](Assert-OwnershipInventory $GitState.status "preflight")
}

function Assert-MessageTemplateEditSourceGuard {
    $sourcePath = Join-Path $workspaceRoot "src/app/(app)/messages/templates/[id]/edit/page.tsx"
    $source = Get-Content -LiteralPath $sourcePath -Raw
    $roleGuardIndex = $source.IndexOf("requireVendorManager()", [StringComparison]::Ordinal)
    $lookupIndex = $source.IndexOf("messageTemplate.findFirst", [StringComparison]::Ordinal)
    if ($roleGuardIndex -lt 0 -or $lookupIndex -lt 0 -or $roleGuardIndex -gt $lookupIndex) { throw "WP-48 template role guard precedence drifted." }
    if ($source -notmatch 'where:\s*\{\s*id,\s*vendorId:\s*vendor\.id\s*\}') { throw "WP-48 template tenant query drifted." }
}

function Get-SyntheticEnvironment {
    $databaseUrl = "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"
    return [ordered]@{
        PATH = $env:PATH
        SystemRoot = $env:SystemRoot
        ComSpec = $env:ComSpec
        PATHEXT = $env:PATHEXT
        NODE_ENV = "test"
        CI = "true"
        DATABASE_URL = $databaseUrl
        DIRECT_URL = $databaseUrl
        E2E_PORT = "31048"
        E2E_BASE_URL = "http://127.0.0.1:31048"
        E2E_SMOKE_TEST_EMAIL = "wp44-synthetic@celebratedeal.test"
        RATE_LIMIT_PROVIDER = "memory"
        PAYMENT_PROVIDER = "demo"
        JOB_SECRET = "wp44-job-secret-at-least-16-chars"
        CSRF_SECRET = "wp44-csrf-secret-at-least-16-chars"
        SENTRY_DISABLE_AUTO_UPLOAD = "true"
        SENTRY_DSN = ""
        NEXT_PUBLIC_SENTRY_DSN = ""
        SENTRY_AUTH_TOKEN = ""
        RESEND_API_KEY = ""
        EMAIL_FROM = ""
        TEMP = (Join-Path $runtimeRoot "temp")
        TMP = (Join-Path $runtimeRoot "tmp")
        HOME = (Join-Path $runtimeRoot "home")
        USERPROFILE = (Join-Path $runtimeRoot "home")
        XDG_CACHE_HOME = (Join-Path $runtimeRoot "cache")
        NPM_CONFIG_CACHE = (Join-Path $runtimeRoot "npm-cache")
        PLAYWRIGHT_BROWSERS_PATH = $playwrightBrowserCache
    }
}

function Assert-DatabaseSafety([System.Collections.IDictionary]$Environment) {
    $uri = [Uri]$Environment.DATABASE_URL
    $query = [Web.HttpUtility]::ParseQueryString($uri.Query)
    if ($uri.Host -ne "127.0.0.1" -or $uri.Port -ne 54329 -or $uri.AbsolutePath.Trim('/') -ne "celebratedeal_ci" -or $query["schema"] -ne $schema -or $schema -notmatch '^wp48_[a-z0-9_]+$') {
        throw "WP-48 database boundary rejected."
    }
}

function Invoke-IsolatedCommand {
    param([string]$Name, [string]$FilePath, [string[]]$ArgumentList, [System.Collections.IDictionary]$Environment)
    $stdoutPath = Join-Path $logDirectory "$Name.stdout.log"
    $stderrPath = Join-Path $logDirectory "$Name.stderr.log"
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.WorkingDirectory = $snapshotRoot
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.CreateNoWindow = $true
    $info.Environment.Clear()
    foreach ($key in $Environment.Keys) { [void]($info.Environment[$key] = [string]$Environment[$key]) }
    $commandArguments = ($ArgumentList -join " ")
    if ($FilePath.EndsWith(".cmd", [StringComparison]::OrdinalIgnoreCase)) {
        # npm/npx are Windows command shims. Run them through cmd.exe while
        # preserving the same explicitly allowlisted child environment.
        $info.FileName = $env:ComSpec
        $info.Arguments = "/d /c `"$FilePath`" $commandArguments"
    } else {
        $info.FileName = $FilePath
        $info.Arguments = $commandArguments
    }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    $watch = [Diagnostics.Stopwatch]::StartNew(); [void]$process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync(); $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit(); $stdout = $stdoutTask.GetAwaiter().GetResult(); $stderr = $stderrTask.GetAwaiter().GetResult(); $watch.Stop()
    Write-Utf8File $stdoutPath $stdout; Write-Utf8File $stderrPath $stderr
    Add-Receipt $Name $process.ExitCode $watch.ElapsedMilliseconds $stdout $stderr
    return $process.ExitCode
}

if ($PreflightSelfTest) {
    Invoke-PreflightSelfTest
    exit 0
}

try {
    New-Item -ItemType Directory -Force -Path $reportDirectory, $logDirectory | Out-Null
    $preflight = Get-GitState
    $protectedPreflight = Get-ProtectedManifest
    Assert-Preflight $preflight $protectedPreflight
    Assert-MessageTemplateEditSourceGuard
    $ownershipPreflight = Assert-OwnershipInventory $preflight.status "preflight"
    $preserveOnlyPreflight = Get-PreserveOnlyManifest
    $sourceManifestPreflight = Get-SourceManifest
    $packageLockPreflight = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $workspaceRoot "package-lock.json")).Hash
    Write-Json "preflight-git-state.json" ([ordered]@{ git = $preflight; ownership = $ownershipPreflight; preserve_only = $preserveOnlyPreflight; protected = $protectedPreflight; protected_pre_existing_mismatches = @($protectedPreflight | Where-Object { -not $_.match } | ForEach-Object { $_.path }) })
    Write-Json "source-preflight-manifest.json" $sourceManifestPreflight

    New-Item -ItemType Directory -Force -Path $snapshotRoot, $runtimeRoot | Out-Null
    $snapshotCreated = $true; $runtimeCreated = $true
    Write-Utf8File (Join-Path $snapshotRoot $snapshotMarker) "WP-48 snapshot marker: $runId"
    Write-Utf8File (Join-Path $runtimeRoot $runtimeMarker) "WP-48 runtime marker: $runId"
    $copyLog = Join-Path $logDirectory "snapshot-copy.log"
    # Copy only the top-level source entries required for a build. Excluding
    # every `.env*` entry happens before Copy-Item receives a path, so neither
    # source nor snapshot environment files are opened or copied.
    $snapshotExcluded = @(".git", ".ai-team", ".next", "node_modules", "test-results")
    $snapshotInputs = @(Get-ChildItem -LiteralPath $workspaceRoot -Force | Where-Object { $_.Name -notin $snapshotExcluded -and $_.Name -notlike ".env*" })
    foreach ($input in $snapshotInputs) { Copy-Item -LiteralPath $input.FullName -Destination $snapshotRoot -Recurse -Force }
    # The source dependency tree is immutable input. Next.js 16 defaults to
    # Turbopack, which rejects this external junction; the disposable
    # Playwright config below explicitly uses the documented Webpack opt-out.
    New-Item -ItemType Junction -Path (Join-Path $snapshotRoot "node_modules") -Target (Join-Path $workspaceRoot "node_modules") | Out-Null
    $snapshotPlaywrightConfig = Join-Path $snapshotRoot "playwright.config.ts"
    $playwrightConfig = Get-Content -Raw -LiteralPath $snapshotPlaywrightConfig
    $playwrightBuild = "npx prisma generate && npx next build && npx next start --port `${port}"
    if (-not $playwrightConfig.Contains($playwrightBuild)) { throw "Snapshot Playwright build command did not match the reviewed contract." }
    Write-Utf8File $snapshotPlaywrightConfig $playwrightConfig.Replace($playwrightBuild, "npx prisma generate && npx next build --webpack && npx next start --port `${port}")
    Write-Utf8File $copyLog "PowerShell Copy-Item completed with no .env* source entries; snapshot Playwright uses documented Next.js Webpack build mode."
    $copyExitCode = 0
    Write-Json "snapshot-copy-result.json" ([ordered]@{ exit_code = $copyExitCode })
    if ($copyExitCode -gt 7) { throw "Snapshot copy failed." }
    $snapshotEnvFiles = @(Get-ChildItem -LiteralPath $snapshotRoot -Recurse -Force -File -Filter ".env*" | ForEach-Object { $_.FullName.Substring($snapshotRoot.Length).TrimStart([char[]]@(92, 47)) })
    Write-Json "snapshot-env-file-names.json" $snapshotEnvFiles
    if ($snapshotEnvFiles.Count -ne 0) { throw "Snapshot contains an environment file." }

    $syntheticEnvironment = Get-SyntheticEnvironment
    Assert-DatabaseSafety $syntheticEnvironment
    if (-not (Test-Path -LiteralPath (Join-Path $playwrightBrowserCache "chromium_headless_shell-1228\chrome-headless-shell-win64\chrome-headless-shell.exe"))) { throw "Required local Chromium browser is unavailable." }
    New-Item -ItemType Directory -Force -Path $syntheticEnvironment.TEMP, $syntheticEnvironment.TMP, $syntheticEnvironment.HOME, $syntheticEnvironment.XDG_CACHE_HOME, $syntheticEnvironment.NPM_CONFIG_CACHE | Out-Null
    Write-Json "environment-safety.json" ([ordered]@{ work_package = "WP-48"; source_env_contents_read = $false; source_env_files_copied = $false; synthetic_environment_only = $true; database = [ordered]@{ host = "127.0.0.1"; port = 54329; database = "celebratedeal_ci"; schema = $schema; schema_pattern = "^wp48_[a-z0-9_]+$" } })

    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $npx = (Get-Command npx.cmd -ErrorAction Stop).Source
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $prismaCli = "node_modules/prisma/build/index.js"
    $git = (Get-Command git -ErrorAction Stop).Source
    # The scanner enumerates Git paths. A disposable repository is sufficient
    # because its `git ls-files -co` query includes untracked snapshot files;
    # no snapshot staging is needed or performed.
    $snapshotGitInitOutput = @(Invoke-IsolatedCommand "snapshot-git-init" $git @("init", "--quiet") $syntheticEnvironment)
    $snapshotGitInitExit = [int]$snapshotGitInitOutput[-1]
    Write-Json "snapshot-git-init-result.json" ([ordered]@{ output_count = $snapshotGitInitOutput.Count; exit_code = $snapshotGitInitExit })
    if ($snapshotGitInitExit -ne 0) { throw "Snapshot Git initialization failed." }
    # The snapshot owns its copied dependency tree, avoiding a registry call
    # while preserving the package-lock bytes of the source workspace.
    if ((Invoke-IsolatedCommand "secret-scan" $npm @("run", "secret:scan") $syntheticEnvironment) -ne 0) { throw "secret scan failed." }
    if ((Invoke-IsolatedCommand "prisma-validate" $node @($prismaCli, "validate") $syntheticEnvironment) -ne 0) { throw "Prisma validate failed." }
    if ((Invoke-IsolatedCommand "prisma-generate" $node @($prismaCli, "generate") $syntheticEnvironment) -ne 0) { throw "Prisma generate failed." }

    $bootstrapSql = Join-Path $snapshotRoot "wp48-bootstrap.sql"
    Write-Utf8File $bootstrapSql "CREATE SCHEMA IF NOT EXISTS `"$schema`";`nCOMMENT ON SCHEMA `"$schema`" IS '$schemaMarker';`n"
    if ((Invoke-IsolatedCommand "database-bootstrap" $node @($prismaCli, "db", "execute", "--schema", "prisma/schema.prisma", "--file", ".\wp48-bootstrap.sql") $syntheticEnvironment) -ne 0) { throw "Schema bootstrap failed." }
    $schemaCreated = $true
    if ((Invoke-IsolatedCommand "prisma-migrate-deploy" $node @($prismaCli, "migrate", "deploy") $syntheticEnvironment) -ne 0) { throw "Disposable migration deploy failed." }
    if ((Invoke-IsolatedCommand "prisma-migrate-status" $node @($prismaCli, "migrate", "status") $syntheticEnvironment) -ne 0) { throw "Disposable migration status failed." }
    if ((Invoke-IsolatedCommand "spec-eslint" $node @("node_modules/eslint/bin/eslint.js", "tests/e2e/accountant-foreign-message-template-edit-direct-url.spec.ts") $syntheticEnvironment) -ne 0) { throw "WP-48 spec ESLint failed." }
    if ((Invoke-IsolatedCommand "auth-unit" $node @("node_modules/vitest/vitest.mjs", "run", "src/lib/auth.test.ts") $syntheticEnvironment) -ne 0) { throw "WP-48 auth unit gate failed." }
    if ((Invoke-IsolatedCommand "browser-e2e" $node @("node_modules/@playwright/test/cli.js", "test", "tests/e2e/accountant-foreign-message-template-edit-direct-url.spec.ts", "--project=chromium", "--retries=0") $syntheticEnvironment) -ne 0) { throw "Release-mode Browser gate failed." }
    $browserOutput = (Get-Content -Raw -LiteralPath (Join-Path $logDirectory "browser-e2e.stdout.log")) + "`n" + (Get-Content -Raw -LiteralPath (Join-Path $logDirectory "browser-e2e.stderr.log"))
    $browserVerdict = [ordered]@{ exactly_one_passed = $browserOutput -match '\b1\s+passed\b'; no_failed = $browserOutput -notmatch '\b(?:[1-9]\d*)\s+failed\b'; no_skipped = $browserOutput -notmatch '\b(?:[1-9]\d*)\s+skipped\b'; external_delivery_indicator_absent = $browserOutput -notmatch '(?i)(sentry|posthog|resend|payuni|cloudflare)' }
    $browserVerdict.pass = $browserVerdict.exactly_one_passed -and $browserVerdict.no_failed -and $browserVerdict.no_skipped -and $browserVerdict.external_delivery_indicator_absent
    Write-Json "browser-verdict.sanitized.json" $browserVerdict
    if (-not $browserVerdict.pass) { throw "Browser verdict was not exactly 1 passed, 0 failed, 0 skipped, with no external delivery indicator." }
    if ((Invoke-IsolatedCommand "typecheck" $node @("node_modules/typescript/bin/tsc", "--noEmit") $syntheticEnvironment) -ne 0) { throw "Typecheck failed." }
    if ((Invoke-IsolatedCommand "git-diff-check" (Get-Command git -ErrorAction Stop).Source @("-C", $workspaceRoot, "diff", "--check") $syntheticEnvironment) -ne 0) { throw "Git diff check failed." }
    Write-Json "db-invariant-summary.sanitized.json" ([ordered]@{ source = "Browser spec DB assertions"; own_template_snapshot = "unchanged"; foreign_template_snapshot = "unchanged"; owner_vendor_template_count = "unchanged"; foreign_vendor_template_count = "unchanged"; fixture_cleanup = "asserted by spec finally" })
} catch {
    $runnerFailure = Sanitize-Text $_.Exception.Message
    Write-Utf8File (Join-Path $reportDirectory "runner-error.sanitized.txt") $runnerFailure
    Add-BlockedReceipt "runner-safety" $runnerFailure
} finally {
    if ($schemaCreated) {
        try {
            $syntheticEnvironment = Get-SyntheticEnvironment
            Assert-DatabaseSafety $syntheticEnvironment
            $cleanupSql = Join-Path $snapshotRoot "wp48-cleanup.sql"
            $sql = @"
DO `$cleanup`$
BEGIN
  -- Assert-DatabaseSafety already verifies the client URL is the fixed
  -- loopback disposable endpoint. The PostgreSQL backend may report its
  -- container address and internal listener port instead, so do not confuse
  -- that topology with the client-side boundary. The database and exact
  -- run-specific schema marker remain mandatory before any DROP.
  IF current_database() <> 'celebratedeal_ci' THEN
    RAISE EXCEPTION 'WP-48 database identity mismatch';
  END IF;
  IF (SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = '$schema') <> '$schemaMarker' THEN
    RAISE EXCEPTION 'WP-48 schema marker missing or mismatched';
  END IF;
  EXECUTE 'DROP SCHEMA "$schema" CASCADE';
END
`$cleanup`$;
"@
            Write-Utf8File $cleanupSql $sql
            $npx = (Get-Command npx.cmd -ErrorAction Stop).Source
            $exitCode = Invoke-IsolatedCommand "database-cleanup" $npx @("prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", ".\wp48-cleanup.sql") $syntheticEnvironment
            $schemaCleanup = if ($exitCode -eq 0) { "PASS" } else { "FAIL" }
        } catch { $schemaCleanup = "FAIL"; Add-BlockedReceipt "database-cleanup" $_.Exception.Message }
    } else { $schemaCleanup = "NOT_CREATED"; Add-BlockedReceipt "database-cleanup" "Schema was never created, so marker-gated cleanup did not run." }

    if ($snapshotCreated -and (Test-Path -LiteralPath $snapshotRoot)) {
        try { $snapshotCleanup = Remove-MarkedTemporaryDirectory $snapshotRoot $snapshotMarker "snapshot" } catch { $snapshotCleanup = "FAIL"; Add-BlockedReceipt "snapshot-cleanup" $_.Exception.Message }
    }
    if ($runtimeCreated -and (Test-Path -LiteralPath $runtimeRoot)) {
        try { $runtimeCleanup = Remove-MarkedTemporaryDirectory $runtimeRoot $runtimeMarker "runtime" } catch { $runtimeCleanup = "FAIL"; Add-BlockedReceipt "runtime-cleanup" $_.Exception.Message }
    }

    $postflight = Get-GitState
    $protectedPostflight = Get-ProtectedManifest
    $ownershipPostflight = Assert-OwnershipInventory $postflight.status "postflight"
    $preserveOnlyPostflight = Get-PreserveOnlyManifest
    $sourceManifestPostflight = Get-SourceManifest
    $packageLockPostflight = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $workspaceRoot "package-lock.json")).Hash
    $sourceUnchanged = (($sourceManifestPreflight | ConvertTo-Json -Compress) -eq ($sourceManifestPostflight | ConvertTo-Json -Compress))
    Assert-GitBaseline $postflight.branch $postflight.head "postflight"
    Assert-ManifestStable $protectedPreflight $protectedPostflight "protected manifest"
    Assert-ManifestStable $preserveOnlyPreflight $preserveOnlyPostflight "preserve-only manifest"
    $protectedUnchanged = $true
    $gitUnchanged = (($preflight.status -join "`n") -eq ($postflight.status -join "`n")) -and (($preflight.staged -join "`n") -eq ($postflight.staged -join "`n"))
    Write-Json "postflight-git-state.json" ([ordered]@{ git = $postflight; ownership = $ownershipPostflight; preserve_only = $preserveOnlyPostflight; protected = $protectedPostflight; protected_pre_existing_mismatches = @($protectedPostflight | Where-Object { -not $_.match } | ForEach-Object { $_.path }) })
    Write-Json "source-postflight-manifest.json" $sourceManifestPostflight
    $summary = [ordered]@{
        work_package = "WP-48"; run_id = $runId; final_runner_error = $runnerFailure
        source_env_contents_read = $false; source_env_files_copied = $false; synthetic_environment_only = $true
        source_manifest_unchanged = $sourceUnchanged; protected_hashes_unchanged = $protectedUnchanged; package_lock_unchanged = $packageLockPreflight -eq $packageLockPostflight; git_state_unchanged = $gitUnchanged
        schema_cleanup = $schemaCleanup; snapshot_cleanup = $snapshotCleanup; runtime_cleanup = $runtimeCleanup; receipts = @($receipts)
    }
    Write-Json "command-receipts.sanitized.json" $summary
    Write-Json "final-runner-summary.sanitized.json" $summary
}

Write-Output "WP-48 report: $reportDirectory"
$failed = @($receipts | Where-Object { $_.classification -in @("FAIL", "BLOCKED_BY_TEST_INFRA") }).Count -gt 0
if ($runnerFailure -or $failed -or $schemaCleanup -ne "PASS" -or $snapshotCleanup -ne "PASS" -or $runtimeCleanup -ne "PASS") { exit 1 }
exit 0
