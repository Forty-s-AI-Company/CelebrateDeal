[CmdletBinding()]
param(
    [string]$Destination = '',
    [string]$FailureManifest = '',
    [switch]$SnapshotOnly,
    [switch]$ReuseExistingResults,
    [switch]$ReuseInstalledSnapshot,
    [string]$GitExecutable = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$git = if ([string]::IsNullOrWhiteSpace($GitExecutable)) {
    (Get-Command git -ErrorAction Stop).Source
} else {
    [IO.Path]::GetFullPath($GitExecutable)
}
if (-not (Test-Path -LiteralPath $git -PathType Leaf)) { throw 'Git executable is unavailable.' }
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $repoRoot '.ai-team\tmp\vnext-node-validation'
}
$snapshot = [IO.Path]::GetFullPath($Destination)
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot '.ai-team\tmp')).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $snapshot.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Node validation snapshot must remain under .ai-team/tmp.'
}
if ([string]::IsNullOrWhiteSpace($FailureManifest)) {
    $FailureManifest = Join-Path $repoRoot 'docs\ai-team\vnext-node-failure-manifest.json'
}

function Test-ExcludedTrackedPath([string]$RelativePath) {
    $normalized = $RelativePath.Replace('\', '/')
    foreach ($segment in $normalized.Split('/')) {
        if ($segment -eq '.env' -or $segment.StartsWith('.env.', [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $normalized -match '^(?:node_modules|\.ai-team/(?:\.venv|tmp|runtime|logs|state|worktrees))(?:/|$)'
}

$reuseSnapshot = $ReuseExistingResults -or $ReuseInstalledSnapshot
if (-not $reuseSnapshot) {
    if (Test-Path -LiteralPath $snapshot) { Remove-Item -LiteralPath $snapshot -Recurse -Force }
    New-Item -ItemType Directory -Path $snapshot -Force | Out-Null
} elseif (-not (Test-Path -LiteralPath $snapshot -PathType Container)) {
    throw 'Existing Node validation snapshot is unavailable.'
}

$tracked = @(& $git -C $repoRoot ls-files --cached)
if ($LASTEXITCODE -ne 0 -or $tracked.Count -eq 0) { throw 'Unable to enumerate Git tracked files.' }
$copied = 0
$excluded = [System.Collections.Generic.List[string]]::new()
foreach ($relative in $tracked) {
    if (Test-ExcludedTrackedPath $relative) {
        $excluded.Add($relative)
        continue
    }
    if (-not $reuseSnapshot) {
        $source = Join-Path $repoRoot $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Tracked source file is missing from the working tree: $relative"
        }
        $target = Join-Path $snapshot $relative
        $parent = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $source -Destination $target -Force
    }
    $copied++
}

$requiredTrackedConfig = Join-Path $snapshot 'config\build-env.controlled.json'
if (-not (Test-Path -LiteralPath $requiredTrackedConfig -PathType Leaf)) {
    throw 'Tracked snapshot omitted config/build-env.controlled.json.'
}
$snapshotReceipt = [ordered]@{
    status = 'SNAPSHOT_READY'
    source = 'git_ls_files_current_worktree'
    tracked_count = $tracked.Count
    copied_count = $copied
    excluded_sensitive_count = $excluded.Count
    required_config_present = $true
    destination = '<workspace>/.ai-team/tmp/' + (Split-Path $snapshot -Leaf)
}
if ($SnapshotOnly) {
    $snapshotReceipt | ConvertTo-Json -Depth 5
    exit 0
}

# Snapshot-only validation needs Git but must not depend on a Node installation.
$npmCommand = if ($IsWindows) {
    Get-Command npm.cmd, npm -ErrorAction SilentlyContinue | Select-Object -First 1
} else {
    Get-Command npm -ErrorAction SilentlyContinue | Select-Object -First 1
}
if ($null -eq $npmCommand) { throw 'npm executable is unavailable for Node validation.' }
$npm = $npmCommand.Source

$installLog = Join-Path $snapshot '.ai-team-node-install.log'
$testLog = Join-Path $snapshot '.ai-team-node-test.log'
$rawResults = Join-Path $snapshot '.ai-team-node-test-results.json'
if ($ReuseExistingResults) {
    if (-not (Test-Path -LiteralPath $rawResults -PathType Leaf)) { throw 'Existing Vitest JSON results are unavailable.' }
    $installExit = 0
    $generateExit = 0
    $existingResult = Get-Content -LiteralPath $rawResults -Raw | ConvertFrom-Json
    $testExit = if ($existingResult.success) { 0 } else { 1 }
} else {
    Push-Location $snapshot
    try {
        if ($ReuseInstalledSnapshot) {
            $installExit = 0
        } else {
            & $npm ci --include=dev --include=optional --no-audit --no-fund *> $installLog
            $installExit = $LASTEXITCODE
        }
        if ($installExit -eq 0) {
            & $npm run db:generate *>> $installLog
            $generateExit = $LASTEXITCODE
            if ($generateExit -eq 0) {
                & $npm test -- --reporter=json "--outputFile=$rawResults" *> $testLog
                $testExit = $LASTEXITCODE
            } else {
                $testExit = $null
            }
        } else {
            $generateExit = $null
            $testExit = $null
        }
    } finally {
        Pop-Location
    }
}

$failures = [System.Collections.Generic.List[object]]::new()
$testSummary = $null
if ($null -ne $testExit -and (Test-Path -LiteralPath $rawResults -PathType Leaf)) {
    $results = Get-Content -LiteralPath $rawResults -Raw | ConvertFrom-Json
    $testSummary = [ordered]@{
        total_suites = $results.numTotalTestSuites
        passed_suites = $results.numPassedTestSuites
        failed_suites = $results.numFailedTestSuites
        pending_suites = $results.numPendingTestSuites
        total_tests = $results.numTotalTests
        passed_tests = $results.numPassedTests
        failed_tests = $results.numFailedTests
        pending_tests = $results.numPendingTests
    }
    foreach ($suite in @($results.testResults)) {
        foreach ($assertion in @($suite.assertionResults)) {
            if ($assertion.status -ne 'failed') { continue }
            $message = (@($assertion.failureMessages) -join ' ')
            $message = $message.Replace($snapshot, '<snapshot>').Replace($snapshot.Replace('\','/'), '<snapshot>')
            $message = $message.Replace($repoRoot, '<workspace>').Replace($repoRoot.Replace('\','/'), '<workspace>')
            $message = [regex]::Replace($message, '(?i)(postgres(?:ql)?://)[^\s@]+@', '$1<redacted>@')
            if ($message.Length -gt 800) { $message = $message.Substring(0, 800) }
            $suiteName = [IO.Path]::GetRelativePath($snapshot, [string]$suite.name).Replace('\', '/')
            $category = if ($message -match '(?i)ECONNREFUSED|database server|PrismaClientInitialization|connect.*(?:postgres|database)|required environment|environment variable') {
                'ENVIRONMENT_BLOCKED'
            } elseif ($suiteName -match '(?i)^(?:\.ai-team|\.codex|docs/ai-team)(?:/|$)') {
                'VNEXT_RELATED'
            } else {
                'UNDETERMINED'
            }
            $testName = [regex]::Replace([string]$assertion.fullName, '(?i)(postgres(?:ql)?://)[^\s@]+@', '$1<redacted>@')
            $failures.Add([ordered]@{
                test_file = $suiteName
                test = $testName
                category = $category
                sanitized_reason = $message
            })
        }
    }
}
if ($installExit -ne 0) {
    $failures.Add([ordered]@{
        test_file = '<dependency-install>'
        test = 'npm ci'
        category = 'ENVIRONMENT_BLOCKED'
        sanitized_reason = 'npm ci failed; inspect the local sanitized install log.'
    })
} elseif ($null -ne $generateExit -and $generateExit -ne 0) {
    $failures.Add([ordered]@{
        test_file = '<prisma-generate>'
        test = 'npm run db:generate'
        category = 'ENVIRONMENT_BLOCKED'
        sanitized_reason = 'Prisma client generation failed; inspect the local sanitized install log.'
    })
} elseif ($null -eq $testExit -or -not (Test-Path -LiteralPath $rawResults -PathType Leaf)) {
    $failures.Add([ordered]@{
        test_file = '<test-runner>'
        test = 'npm test'
        category = 'UNDETERMINED'
        sanitized_reason = 'Vitest did not produce a JSON result manifest.'
    })
}

$counts = [ordered]@{VNEXT_RELATED=0; BASELINE_EXISTING=0; ENVIRONMENT_BLOCKED=0; UNDETERMINED=0}
foreach ($failure in $failures) { $counts[$failure.category]++ }
$manifest = [ordered]@{
    schema_version = 1
    command = 'npm ci --include=dev --include=optional --no-audit --no-fund; npm run db:generate; npm test -- --reporter=json --outputFile=<snapshot-result>'
    source = 'complete Git tracked-file set from current working tree; .env* and ignored runtime excluded'
    snapshot = $snapshotReceipt
    install_exit_code = $installExit
    prisma_generate_exit_code = $generateExit
    test_exit_code = $testExit
    test_summary = $testSummary
    counts = $counts
    failures = @($failures)
}
$manifestParent = Split-Path -Parent ([IO.Path]::GetFullPath($FailureManifest))
if (-not (Test-Path -LiteralPath $manifestParent)) { New-Item -ItemType Directory -Path $manifestParent -Force | Out-Null }
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $FailureManifest -Encoding utf8
[ordered]@{status='VALIDATION_COMPLETE'; install_exit_code=$installExit; test_exit_code=$testExit; counts=$counts; manifest=$FailureManifest} | ConvertTo-Json -Depth 5
if ($installExit -ne 0 -or $testExit -ne 0) { exit 1 }
exit 0
