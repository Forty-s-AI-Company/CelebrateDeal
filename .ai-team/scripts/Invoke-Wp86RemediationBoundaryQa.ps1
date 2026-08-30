[CmdletBinding()]
param(
    [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# WP-86 runs only against a disposable snapshot.  Its first safety rule is
# path classification: excluded paths are never opened, hashed or copied.
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssfff")
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$snapshotRoot = Join-Path $tempRoot "CelebrateDeal-WP86-$runId"
$runtimeRoot = Join-Path $tempRoot "CelebrateDeal-WP86-runtime-$runId"
$schema = "wp86_$runId"
$receiptPath = Join-Path $workspaceRoot ".ai-team\reports\wp86-remediation-boundary-receipt.json"
$ownedPaths = @(
    "tests/e2e/wp86-team-template-direct-url-owner-boundary.spec.ts",
    ".ai-team/scripts/Invoke-Wp86RemediationBoundaryQa.ps1",
    ".ai-team/reports/wp86-remediation-boundary-receipt.json",
    "docs/ai-team/evidence/wp-86-remediation-boundary-release.md"
)
$directUrlSpec = $ownedPaths[0]
$directUrlSpecSha256 = "DD3D7C4785A591D2A258AC37368C86E01E055FBB18FF6823E3A2DC7F3DB984C0"
$existingOwnerBoundarySpec = "tests/e2e/webinar-owner-boundary.spec.ts"
$existingOwnerBoundarySpecSha256 = "E8B9124558B4D6616BFEC5E98F6308DA643590B657DBD5EAC84AA308F24436E9"
$runtimeDependencyClosure = @(
    [ordered]@{
        path = "src/lib/dashboard-checklist.ts"
        status = "UNTRACKED_PRESERVE_ONLY"
        importer_chain = @("src/app/(app)/dashboard/page.tsx", "src/lib/dashboard-checklist.ts")
        reason = "tracked dashboard importer requires this local module for Next build"
    }
)
$commandReceipts = [Collections.Generic.List[object]]::new()
$snapshotCreated = $false
$runtimeCreated = $false
$schemaCreated = $false
$resultStatus = "BLOCKED"
$failure = $null

function Write-Utf8Atomic([string]$Path, [string]$Content) {
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = Join-Path $directory (".$([IO.Path]::GetFileName($Path)).$runId.tmp")
    [IO.File]::WriteAllText($temporary, $Content, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-PathSha256([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "") }
    finally { $sha.Dispose() }
}

function Get-TrackedPathsNul {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = "git"
    $info.Arguments = "-C `"$workspaceRoot`" ls-files -z"
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    [void]$process.Start()
    $memory = [IO.MemoryStream]::new()
    $process.StandardOutput.BaseStream.CopyTo($memory)
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "git ls-files -z failed: $stderr" }
    $text = [Text.Encoding]::UTF8.GetString($memory.ToArray())
    return @([regex]::Split($text, [string][char]0) | Where-Object { $_.Length -gt 0 })
}

function Test-ExcludedPath([string]$RelativePath) {
    $segments = $RelativePath -split "[\\/]"
    foreach ($segment in $segments) {
        if ($segment.StartsWith(".env", [StringComparison]::OrdinalIgnoreCase)) { return $true }
        if ($segment -match '(?i)\.(pem|key|pfx|p12|crt)$') { return $true }
    }
    return $false
}

function Resolve-SafeSourcePath([string]$RelativePath) {
    if (Test-ExcludedPath $RelativePath) { throw "Attempted to resolve an excluded source path." }
    $fullPath = [IO.Path]::GetFullPath((Join-Path $workspaceRoot $RelativePath))
    $prefix = "$workspaceRoot$([IO.Path]::DirectorySeparatorChar)"
    if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Source path escaped workspace." }
    return $fullPath
}

function Get-NonOwnedDirtyManifest {
    $rows = @(& git -C $workspaceRoot status --porcelain=v1 --untracked-files=all)
    $manifest = foreach ($row in $rows) {
        if ($row.Length -lt 4) { throw "Unexpected git status row." }
        $relativePath = $row.Substring(3).Replace("\\", "/")
        if ($relativePath -in $ownedPaths) { continue }
        if (Test-ExcludedPath $relativePath) { throw "Dirty excluded path blocks the immutable ownership inventory." }
        $fullPath = Join-Path $workspaceRoot $relativePath
        $sha = if (Test-Path -LiteralPath $fullPath -PathType Leaf) { (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash } else { "NON_LEAF_OR_DELETED" }
        [ordered]@{ status = $row.Substring(0, 2); path = $relativePath; sha256 = $sha }
    }
    return @($manifest | Sort-Object path, status | ForEach-Object { $_ })
}

function Get-SnapshotSourceDigest([string]$Root, $Manifest) {
    # Generated dependency/build output is intentionally outside the immutable
    # source-input root.  Every copied runtime/test input must still match its
    # source manifest exactly before and after execution.
    $entries = foreach ($entry in $Manifest) {
        $relative = [string]$entry.path
        if (Test-ExcludedPath $relative) { throw "Excluded path appeared in the source manifest." }
        $fullPath = [IO.Path]::GetFullPath((Join-Path $Root $relative))
        if (-not $fullPath.StartsWith("$Root$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) { throw "Snapshot source path escaped its root." }
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Snapshot source input disappeared." }
        $hash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
        if ($hash -ne $entry.sha256) { throw "Snapshot source input digest drifted." }
        "$relative|$hash"
    }
    return Get-PathSha256 (($entries | Sort-Object) -join "`n")
}

function Add-CommandReceipt([string]$Name, [int]$ExitCode, [long]$DurationMs, [string]$Output) {
    $summary = $Output -replace '(?i)postgres(?:ql)?://[^\s"''`]+', '[REDACTED_DATABASE_URL]'
    $summary = $summary -replace '(?i)(token|secret|password|authorization)\s*([=:])\s*[^\s,;]+', '$1$2[REDACTED]'
    $commandReceipts.Add([ordered]@{
        name = $Name; exit_code = $ExitCode; duration_ms = $DurationMs
        classification = if ($ExitCode -eq 0) { "PASS" } else { "FAIL" }
        sanitized_summary = $summary.Substring(0, [Math]::Min(1200, $summary.Length))
    }) | Out-Null
}

function Invoke-Isolated([string]$Name, [string]$FileName, [string[]]$Arguments, [Collections.IDictionary]$Environment) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.WorkingDirectory = $snapshotRoot
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.CreateNoWindow = $true
    $info.Environment.Clear()
    foreach ($key in $Environment.Keys) { [void]$info.Environment.Add($key, [string]$Environment[$key]) }
    if ($FileName.EndsWith(".cmd", [StringComparison]::OrdinalIgnoreCase)) {
        $info.FileName = $env:ComSpec
        $info.Arguments = "/d /c `"$FileName`" $($Arguments -join ' ')"
    } else {
        $info.FileName = $FileName
        $info.Arguments = $Arguments -join " "
    }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    $watch = [Diagnostics.Stopwatch]::StartNew(); [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit(); $watch.Stop()
    Add-CommandReceipt $Name $process.ExitCode $watch.ElapsedMilliseconds ($stdout + "`n" + $stderr)
    if ($process.ExitCode -ne 0) { throw "$Name failed with exit code $($process.ExitCode)." }
}

function Get-SyntheticEnvironment {
    $databaseUrl = "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"
    return [ordered]@{
        PATH = $env:PATH; SystemRoot = $env:SystemRoot; ComSpec = $env:ComSpec; PATHEXT = $env:PATHEXT
        NODE_ENV = "test"; CI = ""; DATABASE_URL = $databaseUrl; DIRECT_URL = $databaseUrl
        E2E_PORT = "31086"; E2E_BASE_URL = "http://127.0.0.1:31086"; E2E_TEST_MODE = "true"
        E2E_SMOKE_TEST_EMAIL = "wp86-synthetic@celebratedeal.test"; RATE_LIMIT_PROVIDER = "memory"; E2E_RATE_LIMIT_PROVIDER = "memory"
        PAYMENT_PROVIDER = "demo"; JOB_SECRET = "wp86-test-job-secret-only"; CSRF_SECRET = "wp86-test-csrf-secret-only"
        SENTRY_DISABLE_AUTO_UPLOAD = "true"; SENTRY_DSN = ""; NEXT_PUBLIC_SENTRY_DSN = ""; SENTRY_AUTH_TOKEN = ""
        RESEND_API_KEY = ""; EMAIL_FROM = ""; HOME = (Join-Path $runtimeRoot "home"); USERPROFILE = (Join-Path $runtimeRoot "home")
        TEMP = (Join-Path $runtimeRoot "temp"); TMP = (Join-Path $runtimeRoot "tmp"); NPM_CONFIG_OFFLINE = "true"
        NPM_CONFIG_CACHE = (Join-Path $env:LOCALAPPDATA "npm-cache"); PLAYWRIGHT_BROWSERS_PATH = (Join-Path $env:LOCALAPPDATA "ms-playwright")
    }
}

function Assert-DisposableDatabase([Collections.IDictionary]$Environment) {
    $uri = [Uri]$Environment.DATABASE_URL
    if ($uri.Host -ne "127.0.0.1" -or $uri.Port -ne 54329 -or $uri.AbsolutePath.Trim("/") -ne "celebratedeal_ci" -or $uri.Query -notmatch "schema=$schema") {
        throw "Disposable database boundary rejected."
    }
}

function Save-Receipt($ExcludedPathHashes, [string]$SnapshotBefore, [string]$SnapshotAfter, $PreserveBefore, $PreserveAfter, $SourceManifest, $RuntimeClosure) {
    $existing = Get-Content -Raw -LiteralPath $receiptPath | ConvertFrom-Json
    $attempts = @($existing.attempts)
    $attempts += [ordered]@{
        attempt = $attempts.Count + 1; status = $resultStatus; run_id = $runId
        env_path_exclusion = [ordered]@{ excluded_count = $ExcludedPathHashes.Count; normalized_relative_path_sha256 = @($ExcludedPathHashes); reason = "ENV_PATH_EXCLUDED_BEFORE_READ" }
        source_env_contents_read = $false; external_network_requested = $false; production_database_connected = $false
        direct_url_spec_sha256 = $directUrlSpecSha256
        existing_owner_boundary_spec_sha256 = $existingOwnerBoundarySpecSha256
        runtime_dependency_closure = @($RuntimeClosure)
        copied_source_manifest = @($SourceManifest)
        snapshot_digest_before_test = $SnapshotBefore; snapshot_digest_after_test = $SnapshotAfter
        preserve_only_unchanged = (($PreserveBefore | ConvertTo-Json -Compress) -eq ($PreserveAfter | ConvertTo-Json -Compress))
        command_receipts = @($commandReceipts)
        failure = $failure
    }
    $document = [ordered]@{
        schema_version = 2; work_package = "WP-86"; workflow_mode = "PRELAUNCH_DEV"; status = $resultStatus
        blocked_reason = if ($resultStatus -eq "PASS") { $null } else { $failure }
        attempts = $attempts
        ownership = [ordered]@{ new_owned_paths = $ownedPaths; runner_created = $true; preserve_only_paths_modified = $false; staged_index_required_empty = $true }
    }
    Write-Utf8Atomic $receiptPath ($document | ConvertTo-Json -Depth 12)
}

$excludedPathHashes = @()
$preserveBefore = @(); $preserveAfter = @(); $snapshotBefore = $null; $snapshotAfter = $null
$sourceManifest = @(); $runtimeClosureManifest = @()
try {
    if (@(& git -C $workspaceRoot diff --cached --name-only).Count -ne 0) { throw "Staged index must be empty." }
    $trackedPaths = Get-TrackedPathsNul
    $excludedPaths = @($trackedPaths | Where-Object { Test-ExcludedPath $_ })
    $excludedPathHashes = @($excludedPaths | ForEach-Object { Get-PathSha256 $_ } | Sort-Object)
    if ($excludedPathHashes.Count -ne 3) { throw "Excluded environment path count drift." }
    $preserveBefore = Get-NonOwnedDirtyManifest
    $specFullPath = Resolve-SafeSourcePath $directUrlSpec
    if ((Get-FileHash -LiteralPath $specFullPath -Algorithm SHA256).Hash -ne $directUrlSpecSha256) { throw "Direct-URL spec is not immutable." }
    $existingSpecFullPath = Resolve-SafeSourcePath $existingOwnerBoundarySpec
    if ((Get-FileHash -LiteralPath $existingSpecFullPath -Algorithm SHA256).Hash -ne $existingOwnerBoundarySpecSha256) { throw "Existing owner-boundary spec is not immutable." }
    if ($PreflightOnly) { $resultStatus = "PREFLIGHT_PASS"; return }

    New-Item -ItemType Directory -Force -Path $snapshotRoot, $runtimeRoot | Out-Null
    $snapshotCreated = $true; $runtimeCreated = $true
    # These are the only untracked inputs: the frozen test itself and the
    # one-module, statically reviewed runtime closure approved by Sol. They
    # remain PRESERVE_ONLY; copying them never changes workspace ownership.
    foreach ($dependency in $runtimeDependencyClosure) {
        $dependencyPath = [string]$dependency.path
        $dependencyFullPath = Resolve-SafeSourcePath $dependencyPath
        $attributes = [IO.File]::GetAttributes($dependencyFullPath)
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Runtime dependency closure contains a reparse point." }
        if (-not (Test-Path -LiteralPath $dependencyFullPath -PathType Leaf)) { throw "Runtime dependency closure is missing." }
        $runtimeClosureManifest += [ordered]@{
            path = $dependencyPath; status = $dependency.status; importer_chain = @($dependency.importer_chain)
            sha256_before_copy = (Get-FileHash -LiteralPath $dependencyFullPath -Algorithm SHA256).Hash
        }
    }
    $sourceInputs = @($trackedPaths + $directUrlSpec + $existingOwnerBoundarySpec + @($runtimeDependencyClosure | ForEach-Object { $_.path }) | Sort-Object -Unique)
    $sourceManifest = foreach ($relativePath in $sourceInputs) {
        if (Test-ExcludedPath $relativePath) { continue }
        $source = Resolve-SafeSourcePath $relativePath
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Tracked safe source input is missing." }
        $destination = Join-Path $snapshotRoot $relativePath
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
        [ordered]@{ path = $relativePath; sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash }
    }
    $snapshotSpec = Join-Path $snapshotRoot $directUrlSpec
    if (-not (Test-Path -LiteralPath $snapshotSpec -PathType Leaf)) { throw "Snapshot lacks the direct-URL spec." }
    $snapshotBefore = Get-SnapshotSourceDigest $snapshotRoot $sourceManifest

    $environment = Get-SyntheticEnvironment
    Assert-DisposableDatabase $environment
    New-Item -ItemType Directory -Force -Path $environment.HOME, $environment.TEMP, $environment.TMP | Out-Null
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    Invoke-Isolated "npm-ci-offline" $npm @("ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund") $environment
    Invoke-Isolated "prisma-validate" $node @("node_modules/prisma/build/index.js", "validate") $environment
    Invoke-Isolated "prisma-generate" $node @("node_modules/prisma/build/index.js", "generate") $environment
    $bootstrap = Join-Path $snapshotRoot "wp86-bootstrap.sql"
    [IO.File]::WriteAllText($bootstrap, "CREATE SCHEMA IF NOT EXISTS `"$schema`";", [Text.UTF8Encoding]::new($false))
    Invoke-Isolated "database-bootstrap" $node @("node_modules/prisma/build/index.js", "db", "execute", "--schema", "prisma/schema.prisma", "--file", ".\\wp86-bootstrap.sql") $environment
    $schemaCreated = $true
    Invoke-Isolated "prisma-migrate-deploy" $node @("node_modules/prisma/build/index.js", "migrate", "deploy") $environment
    Invoke-Isolated "existing-owner-boundary-spec-eslint" $node @("node_modules/eslint/bin/eslint.js", $existingOwnerBoundarySpec) $environment
    Invoke-Isolated "existing-owner-boundary-browser-e2e" $node @("node_modules/@playwright/test/cli.js", "test", $existingOwnerBoundarySpec, "--project=chromium", "--retries=0") $environment
    Invoke-Isolated "direct-url-spec-eslint" $node @("node_modules/eslint/bin/eslint.js", $directUrlSpec) $environment
    Invoke-Isolated "direct-url-browser-e2e" $node @("node_modules/@playwright/test/cli.js", "test", $directUrlSpec, "--project=chromium", "--retries=0") $environment
    Invoke-Isolated "typecheck" $node @("node_modules/typescript/bin/tsc", "--noEmit") $environment
    foreach ($dependency in $runtimeClosureManifest) {
        $dependencyFullPath = Resolve-SafeSourcePath ([string]$dependency.path)
        $dependency.sha256_after_test = (Get-FileHash -LiteralPath $dependencyFullPath -Algorithm SHA256).Hash
        if ($dependency.sha256_after_test -ne $dependency.sha256_before_copy) { throw "Runtime dependency closure drifted during the run." }
    }
    $snapshotAfter = Get-SnapshotSourceDigest $snapshotRoot $sourceManifest
    $resultStatus = "PASS"
} catch {
    $failure = $_.Exception.Message
    $resultStatus = "BLOCKED_OR_FAILED"
} finally {
    if ($schemaCreated) {
        try {
            $environment = Get-SyntheticEnvironment
            Assert-DisposableDatabase $environment
            $cleanup = Join-Path $snapshotRoot "wp86-cleanup.sql"
            [IO.File]::WriteAllText($cleanup, "DROP SCHEMA IF EXISTS `"$schema`" CASCADE;", [Text.UTF8Encoding]::new($false))
            $node = (Get-Command node.exe -ErrorAction Stop).Source
            Invoke-Isolated "database-cleanup" $node @("node_modules/prisma/build/index.js", "db", "execute", "--schema", "prisma/schema.prisma", "--file", ".\\wp86-cleanup.sql") $environment
        } catch { $failure = "Cleanup failed: $($_.Exception.Message)"; $resultStatus = "BLOCKED_OR_FAILED" }
    }
    if ($snapshotCreated -and (Test-Path -LiteralPath $snapshotRoot)) { Remove-Item -LiteralPath $snapshotRoot -Recurse -Force }
    if ($runtimeCreated -and (Test-Path -LiteralPath $runtimeRoot)) { Remove-Item -LiteralPath $runtimeRoot -Recurse -Force }
    $preserveAfter = Get-NonOwnedDirtyManifest
    if (($preserveBefore | ConvertTo-Json -Compress) -ne ($preserveAfter | ConvertTo-Json -Compress)) { $failure = "PRESERVE_ONLY inventory changed."; $resultStatus = "BLOCKED_OR_FAILED" }
    Save-Receipt $excludedPathHashes $snapshotBefore $snapshotAfter $preserveBefore $preserveAfter $sourceManifest $runtimeClosureManifest
}

if ($resultStatus -ne "PASS" -and $resultStatus -ne "PREFLIGHT_PASS") { exit 1 }
Write-Output "WP-86 remediation boundary QA PASS"
