[CmdletBinding()]
param(
    [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# WP-86 owns this runner only. All product and existing QA files are frozen
# read-only inputs copied into a disposable snapshot.
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssfff")
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$snapshotRoot = Join-Path $tempRoot "CelebrateDeal-WP86-M2A01-$runId"
$runtimeRoot = Join-Path $tempRoot "CelebrateDeal-WP86-M2A01-runtime-$runId"
$schema = "wp86_m2a01_$runId"
$ownedRunner = ".ai-team/scripts/Invoke-Wp86M2A01DirectUrlClosureQa.ps1"
$reportRoot = ".ai-team/reports/wp-86-m2-a01-direct-url-closure-$runId"
$reportDirectory = Join-Path $workspaceRoot ($reportRoot -replace "/", "\")
$commandReceiptPath = Join-Path $reportDirectory "command-receipts.json"
$finalSummaryPath = Join-Path $reportDirectory "final-runner-summary.json"
$allowedTestInputs = @(
    "tests/e2e/webinar-owner-boundary.spec.ts",
    "tests/e2e/wp86-team-template-direct-url-owner-boundary.spec.ts",
    "tests/e2e/accountant-platform-admin-direct-url.spec.ts",
    "tests/e2e/smoke.spec.ts"
)
$commandReceipts = [Collections.Generic.List[object]]::new()
$preserveBefore = @()
$preserveAfter = @()
$sourceManifest = @()
$sourceDigestBefore = $null
$sourceDigestAfter = $null
$excludedPathHashes = @()
$snapshotCreated = $false
$runtimeCreated = $false
$schemaCreated = $false
$status = "BLOCKED"
$failure = $null
$browserSummary = $null
$cleanupError = $null

function Write-Utf8Atomic([string]$Path, [string]$Content) {
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = Join-Path $directory ("." + [IO.Path]::GetFileName($Path) + ".$runId.tmp")
    [IO.File]::WriteAllText($temporary, $Content, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-StringSha256([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "") }
    finally { $sha.Dispose() }
}

function Test-ExcludedPath([string]$RelativePath) {
    $segments = $RelativePath -split "[\\/]"
    foreach ($segment in $segments) {
        if ($segment.StartsWith(".env", [StringComparison]::OrdinalIgnoreCase)) { return $true }
        if ($segment -match '(?i)\.(pem|key|pfx|p12|crt)$') { return $true }
        if ($segment -in @(".git", ".ai-team", ".next", "node_modules", "test-results", "playwright-report")) { return $true }
    }
    return $false
}

function Test-SensitivePath([string]$RelativePath) {
    $segments = $RelativePath -split "[\\/]"
    foreach ($segment in $segments) {
        if ($segment.StartsWith(".env", [StringComparison]::OrdinalIgnoreCase)) { return $true }
        if ($segment -match '(?i)\.(pem|key|pfx|p12|crt)$') { return $true }
    }
    return $false
}

function Get-TrackedAndUntrackedPaths {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = "git"
    $info.Arguments = "-C `"$workspaceRoot`" ls-files -co --exclude-standard -z"
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    [void]$process.Start()
    $bytes = [IO.MemoryStream]::new(); $process.StandardOutput.BaseStream.CopyTo($bytes)
    $stderr = $process.StandardError.ReadToEnd(); $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "git ls-files failed: $stderr" }
    return @([regex]::Split([Text.Encoding]::UTF8.GetString($bytes.ToArray()), [string][char]0) | Where-Object { $_.Length -gt 0 })
}

function Get-DirtyRows {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = "git"
    $info.Arguments = "-C `"$workspaceRoot`" status --porcelain=v1 -z --untracked-files=all"
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    [void]$process.Start()
    $bytes = [IO.MemoryStream]::new(); $process.StandardOutput.BaseStream.CopyTo($bytes)
    $stderr = $process.StandardError.ReadToEnd(); $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "git status failed: $stderr" }
    return @([regex]::Split([Text.Encoding]::UTF8.GetString($bytes.ToArray()), [string][char]0) | Where-Object { $_.Length -gt 0 })
}

function Convert-DirtyRow([string]$Row) {
    if ($Row.Length -lt 4) { throw "Malformed git status row." }
    $path = $Row.Substring(3).Replace("\", "/")
    if ($path -match " -> ") { $path = ($path -split " -> ")[-1] }
    [ordered]@{ status = $Row.Substring(0, 2); path = $path }
}

function Test-ReportPath([string]$Path) {
    return $Path.Equals($ownedRunner, [StringComparison]::OrdinalIgnoreCase) -or $Path.StartsWith(".ai-team/reports/wp-86-m2-a01-direct-url-closure-", [StringComparison]::OrdinalIgnoreCase)
}

function Get-PreserveManifest {
    $rows = foreach ($row in (Get-DirtyRows | ForEach-Object { Convert-DirtyRow $_ })) {
        if (Test-ReportPath ([string]$row.path)) { continue }
        if (Test-SensitivePath ([string]$row.path)) { throw "Sensitive dirty path blocks ownership preflight: $($row.path)" }
        $full = Join-Path $workspaceRoot ([string]$row.path)
        $hash = if (Test-Path -LiteralPath $full -PathType Leaf) { (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash } else { "NON_LEAF_OR_DELETED" }
        [ordered]@{ status = [string]$row.status; path = [string]$row.path; sha256 = $hash }
    }
    return @($rows | Sort-Object path, status)
}

function Get-ManifestDigest($Manifest) {
    $lines = @($Manifest | ForEach-Object { "$($_.status)|$($_.path)|$($_.sha256)" } | Sort-Object)
    return Get-StringSha256 ($lines -join "`n")
}

function Get-SafeSourceInputs {
    $rootFiles = @(
        "package.json", "package-lock.json", "next.config.ts", "next.config.mjs", "next.config.js",
        "playwright.config.ts", "tsconfig.json", "tsconfig.strict-index.json",
        "postcss.config.mjs", "postcss.config.js", "tailwind.config.ts", "tailwind.config.js",
        "eslint.config.mjs", "eslint.config.js", "components.json", "vitest.config.ts", "vitest.synthetic-db-coverage.config.ts"
    )
    $paths = Get-TrackedAndUntrackedPaths
    $selected = foreach ($path in $paths) {
        if (Test-ExcludedPath $path) { continue }
        if ($path.Equals("next-env.d.ts", [StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($path -in $rootFiles -or $path -notmatch '[\\/]' -or $path -match '^(src|prisma|public|scripts|tests)[\\/]') { $path.Replace("\", "/") }
    }
    foreach ($path in $rootFiles) {
        if (Test-Path -LiteralPath (Join-Path $workspaceRoot $path) -PathType Leaf) { $selected += $path }
    }
    return @($selected | Sort-Object -Unique)
}

function Copy-SafeSnapshot {
    $sourceInputs = Get-SafeSourceInputs
    foreach ($relative in $sourceInputs) {
        if (Test-ExcludedPath $relative) { throw "Excluded source input reached snapshot stage." }
        $source = [IO.Path]::GetFullPath((Join-Path $workspaceRoot $relative))
        $prefix = "$workspaceRoot$([IO.Path]::DirectorySeparatorChar)"
        if (-not $source.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Source escaped workspace." }
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing source input: $relative" }
        $destination = Join-Path $snapshotRoot $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
        $script:sourceManifest += [ordered]@{ path = $relative; sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash }
    }
    $script:sourceManifest = @($script:sourceManifest)
}

function Get-SnapshotDigest {
    $lines = foreach ($entry in $sourceManifest) {
        $source = Join-Path $snapshotRoot ([string]$entry.path)
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Snapshot source disappeared: $($entry.path)" }
        $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        if ($hash -ne [string]$entry.sha256) { throw "Snapshot source drifted: $($entry.path)" }
        "$($entry.path)|$hash"
    }
    return Get-StringSha256 (($lines | Sort-Object) -join "`n")
}

function Get-SyntheticEnvironment {
    $databaseUrl = "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"
    return [ordered]@{
        PATH = $env:PATH; SystemRoot = $env:SystemRoot; ComSpec = $env:ComSpec; PATHEXT = $env:PATHEXT
        NODE_ENV = "test"; CI = ""; DATABASE_URL = $databaseUrl; DIRECT_URL = $databaseUrl
        E2E_PORT = "31086"; E2E_BASE_URL = "http://127.0.0.1:31086"; NEXT_PUBLIC_APP_URL = "http://127.0.0.1:31086"
        E2E_TEST_MODE = "true"; E2E_RATE_LIMIT_PROVIDER = "memory"; RATE_LIMIT_PROVIDER = "memory"
        PAYMENT_PROVIDER = "demo"; E2E_SMOKE_TEST_EMAIL = "wp86-synthetic@celebratedeal.test"
        JOB_SECRET = "wp86-synthetic-job-secret-123456"; CSRF_SECRET = "wp86-synthetic-csrf-secret-123456"
        SENTRY_DISABLE_AUTO_UPLOAD = "true"; SENTRY_DSN = ""; NEXT_PUBLIC_SENTRY_DSN = ""; SENTRY_AUTH_TOKEN = ""
        RESEND_API_KEY = ""; EMAIL_FROM = ""; HOME = (Join-Path $runtimeRoot "home"); USERPROFILE = (Join-Path $runtimeRoot "home")
        TEMP = (Join-Path $runtimeRoot "temp"); TMP = (Join-Path $runtimeRoot "tmp"); NPM_CONFIG_OFFLINE = "true"
        NPM_CONFIG_CACHE = (Join-Path $env:LOCALAPPDATA "npm-cache"); PLAYWRIGHT_BROWSERS_PATH = (Join-Path $env:LOCALAPPDATA "ms-playwright")
    }
}

function Assert-DisposableBoundary([Collections.IDictionary]$Environment) {
    $uri = [Uri]$Environment.DATABASE_URL
    if ($uri.Scheme -ne "postgresql" -or $uri.Host -ne "127.0.0.1" -or $uri.Port -ne 54329 -or $uri.AbsolutePath.Trim("/") -ne "celebratedeal_ci" -or $uri.Query -notmatch "schema=$schema") { throw "Disposable DB boundary rejected." }
    if ([string]$Environment.E2E_BASE_URL -ne "http://127.0.0.1:31086") { throw "Browser base URL boundary rejected." }
}

function Add-CommandReceipt([string]$Name, [int]$ExitCode, [long]$DurationMs, [string]$Output) {
    $summary = $Output -replace '(?i)postgres(?:ql)?://[^\s"''`]+', '[REDACTED_DATABASE_URL]'
    $summary = $summary -replace '(?i)[\w.+-]+@[\w.-]+\.[a-z]{2,}', '[REDACTED_EMAIL]'
    $summary = $summary -replace '(?i)(token|secret|password|authorization|cookie)\s*([=:])\s*[^\s,;]+', '$1$2[REDACTED]'
    $summary = $summary -replace '(?i)(https?://[^\s]+)', '[REDACTED_URL]'
    $lines = @($summary -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -Last 8)
    $commandReceipts.Add([ordered]@{
        name = $Name; exit_code = $ExitCode; duration_ms = $DurationMs
        classification = if ($ExitCode -eq 0) { "PASS" } else { "FAIL" }
        sanitized_tail = (($lines -join " ").Substring(0, [Math]::Min(800, ($lines -join " ").Length)))
    }) | Out-Null
}

function Quote-ProcessArgument([string]$Value) {
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Invoke-Isolated([string]$Name, [string]$FileName, [string[]]$Arguments, [Collections.IDictionary]$Environment) {
    $info = [Diagnostics.ProcessStartInfo]::new(); $info.FileName = $FileName; $info.WorkingDirectory = $snapshotRoot
    $info.Arguments = ($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
    $info.UseShellExecute = $false; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true; $info.CreateNoWindow = $true
    $info.Environment.Clear()
    foreach ($key in $Environment.Keys) { [void]$info.Environment.Add($key, [string]$Environment[$key]) }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    $watch = [Diagnostics.Stopwatch]::StartNew(); [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd(); $process.WaitForExit(); $watch.Stop()
    $combined = "$stdout`n$stderr"
    Add-CommandReceipt $Name $process.ExitCode $watch.ElapsedMilliseconds $combined
    if ($process.ExitCode -ne 0) { throw "$Name failed with exit code $($process.ExitCode)." }
    return $combined
}

function Save-Receipts {
    $receiptDocument = [ordered]@{ schema_version = 1; work_package = "WP-86"; run_id = $runId; status = $status; commands = @($commandReceipts) }
    Write-Utf8Atomic $commandReceiptPath ($receiptDocument | ConvertTo-Json -Depth 10)
    $summaryDocument = [ordered]@{
        schema_version = 1; work_package = "WP-86"; run_id = $runId; status = $status; failure = $failure
        ownership = [ordered]@{ runner = $ownedRunner; preserve_only_count_before = $preserveBefore.Count; preserve_only_count_after = $preserveAfter.Count; preserve_only_unchanged = ((Get-ManifestDigest $preserveBefore) -eq (Get-ManifestDigest $preserveAfter)); staged_required_empty = $true }
        safety = [ordered]@{ source_env_contents_read = $false; excluded_path_count = $excludedPathHashes.Count; excluded_path_name_sha256 = @($excludedPathHashes); external_network_requested = $false; production_database_connected = $false; browser_base_url = "http://127.0.0.1:31086"; database_host = "127.0.0.1"; database_port = 54329; database_name = "celebratedeal_ci" }
        source_input_count = $sourceManifest.Count; source_digest_before = $sourceDigestBefore; source_digest_after = $sourceDigestAfter
        browser = $browserSummary; cleanup_error = $cleanupError
    }
    Write-Utf8Atomic $finalSummaryPath ($summaryDocument | ConvertTo-Json -Depth 10)
}

try {
    $staged = @(git -C $workspaceRoot diff --cached --name-only)
    if ($staged.Count -ne 0) { throw "Staged index must be empty." }
    $initialDirty = Get-DirtyRows
    $initialParsed = @($initialDirty | ForEach-Object { Convert-DirtyRow $_ })
    $envPaths = @($initialParsed | Where-Object { ([string]$_.path -split "[\\/]") | Where-Object { $_.StartsWith(".env", [StringComparison]::OrdinalIgnoreCase) } })
    if ($envPaths.Count -ne 0) { throw "Dirty .env* path detected; fail closed before content read." }
    $allPaths = Get-TrackedAndUntrackedPaths
    $excludedPaths = @($allPaths | Where-Object { $_ -split "[\\/]" | Where-Object { $_.StartsWith(".env", [StringComparison]::OrdinalIgnoreCase) } })
    $excludedPathHashes = @($excludedPaths | ForEach-Object { Get-StringSha256 $_ } | Sort-Object)
    if ($excludedPathHashes.Count -ne 3) { throw "Environment-template path count drifted." }
    $preserveBefore = Get-PreserveManifest
    if ($preserveBefore.Count -lt 1) { throw "PRESERVE_ONLY inventory unexpectedly empty." }
    $sourceProbe = Get-SafeSourceInputs
    if (@($sourceProbe | Where-Object { Test-ExcludedPath $_ }).Count -ne 0) { throw "Excluded path reached source allowlist." }
    if ($PreflightOnly) { $status = "PREFLIGHT_PASS"; return }

    New-Item -ItemType Directory -Force -Path $snapshotRoot, $runtimeRoot | Out-Null; $snapshotCreated = $true; $runtimeCreated = $true
    Copy-SafeSnapshot
    $sourceDigestBefore = Get-SnapshotDigest
    $environment = Get-SyntheticEnvironment; Assert-DisposableBoundary $environment
    New-Item -ItemType Directory -Force -Path $environment.HOME, $environment.TEMP, $environment.TMP | Out-Null
    $node = (Get-Command node.exe -ErrorAction Stop).Source; $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    Invoke-Isolated "npm-ci-offline" $npm @("ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund") $environment | Out-Null
    $nodeModules = Join-Path $snapshotRoot "node_modules"
    if (([IO.File]::GetAttributes($nodeModules) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Snapshot node_modules is a reparse point." }
    Invoke-Isolated "prisma-validate" $node @("node_modules/prisma/build/index.js", "validate") $environment | Out-Null
    Invoke-Isolated "prisma-generate" $node @("node_modules/prisma/build/index.js", "generate") $environment | Out-Null
    $bootstrap = Join-Path $snapshotRoot "wp86-bootstrap.sql"
    [IO.File]::WriteAllText($bootstrap, "CREATE SCHEMA IF NOT EXISTS `"$schema`";", [Text.UTF8Encoding]::new($false))
    Invoke-Isolated "database-bootstrap" $node @("node_modules/prisma/build/index.js", "db", "execute", "--schema", "prisma/schema.prisma", "--file", "wp86-bootstrap.sql") $environment | Out-Null
    $schemaCreated = $true
    Invoke-Isolated "prisma-migrate-deploy" $node @("node_modules/prisma/build/index.js", "migrate", "deploy") $environment | Out-Null
    Invoke-Isolated "prisma-migrate-status" $node @("node_modules/prisma/build/index.js", "migrate", "status") $environment | Out-Null
    Invoke-Isolated "target-spec-eslint" $node @("node_modules/eslint/bin/eslint.js", $allowedTestInputs[0], $allowedTestInputs[1], $allowedTestInputs[2], $allowedTestInputs[3]) $environment | Out-Null
    Invoke-Isolated "auth-unit" $node @("node_modules/vitest/vitest.mjs", "run", "src/lib/auth.test.ts") $environment | Out-Null
    $browserOutput = Invoke-Isolated "browser-four-case-matrix" $node @("node_modules/@playwright/test/cli.js", "test", $allowedTestInputs[0], $allowedTestInputs[1], $allowedTestInputs[2], $allowedTestInputs[3], "--project=chromium", "--workers=1", "--retries=0", "--grep=member.*publish|same-team.*non-owner|protected.*admin.*pages|active.*accountant.*denied") $environment
    if ($browserOutput -notmatch "(?m)\b4 passed\b" -or $browserOutput -match "(?m)\b(?:[1-9]\d*) (?:failed|skipped|flaky)\b") { throw "Browser discovery did not produce exactly 4 passed, 0 failed, 0 skipped, 0 flaky." }
    $browserSummary = [ordered]@{ selected_cases = 4; expected = "4 passed, 0 failed, 0 skipped, 0 flaky"; observed = (($browserOutput -split "`r?`n" | Where-Object { $_ -match "passed|failed|skipped|flaky" } | Select-Object -Last 2) -join " ") }
    Invoke-Isolated "typecheck" $node @("node_modules/typescript/bin/tsc", "--noEmit") $environment | Out-Null
    $sourceDigestAfter = Get-SnapshotDigest
    if ($sourceDigestBefore -ne $sourceDigestAfter) { throw "Snapshot source digest changed during tests." }
    $status = "PASS"
} catch {
    $failure = $_.Exception.Message
    $status = "BLOCKED_OR_FAILED"
} finally {
    if ($schemaCreated) {
        try {
            $environment = Get-SyntheticEnvironment; Assert-DisposableBoundary $environment
            $cleanup = Join-Path $snapshotRoot "wp86-cleanup.sql"
            [IO.File]::WriteAllText($cleanup, "DROP SCHEMA IF EXISTS `"$schema`" CASCADE;", [Text.UTF8Encoding]::new($false))
            $node = (Get-Command node.exe -ErrorAction Stop).Source
            Invoke-Isolated "database-cleanup" $node @("node_modules/prisma/build/index.js", "db", "execute", "--schema", "prisma/schema.prisma", "--file", "wp86-cleanup.sql") $environment | Out-Null
        } catch { $cleanupError = $_.Exception.Message; $failure = "Cleanup failed: $cleanupError"; $status = "BLOCKED_OR_FAILED" }
    }
    if ($snapshotCreated -and (Test-Path -LiteralPath $snapshotRoot)) { Remove-Item -LiteralPath $snapshotRoot -Recurse -Force }
    if ($runtimeCreated -and (Test-Path -LiteralPath $runtimeRoot)) { Remove-Item -LiteralPath $runtimeRoot -Recurse -Force }
    try { $preserveAfter = Get-PreserveManifest } catch { $failure = "Postflight ownership scan failed: $($_.Exception.Message)"; $status = "BLOCKED_OR_FAILED" }
    if ($preserveBefore.Count -gt 0 -and (Get-ManifestDigest $preserveBefore) -ne (Get-ManifestDigest $preserveAfter)) { $failure = "PRESERVE_ONLY inventory changed."; $status = "BLOCKED_OR_FAILED" }
    Save-Receipts
}

if ($status -ne "PASS" -and $status -ne "PREFLIGHT_PASS") { exit 1 }
Write-Output "WP-86 M2-A01 direct-URL closure runner $status"
