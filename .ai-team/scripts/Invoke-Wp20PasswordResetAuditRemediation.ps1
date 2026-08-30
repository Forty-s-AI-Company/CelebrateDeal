[CmdletBinding()]
param(
    [string]$ReportRoot = ".ai-team\\reports"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# This runner deliberately starts from a no-dotenv disposable snapshot. It is
# limited to a loopback wp20_* schema and never inherits the caller's env.
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssfff")
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$snapshotRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot "CelebrateDeal-WP20-$runId"))
if (-not $snapshotRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "WP-20 snapshot must remain under the system temporary directory." }
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot "CelebrateDeal-WP20-runtime-$runId"))
if (-not $runtimeRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "WP-20 runtime must remain under the system temporary directory." }

$reportDirectory = Join-Path ([IO.Path]::GetFullPath((Join-Path $workspaceRoot $ReportRoot))) "wp-20-password-reset-audit-$runId"
$logDirectory = Join-Path $workspaceRoot ".ai-team\\logs\\wp-20\\$runId"
New-Item -ItemType Directory -Force -Path $reportDirectory, $logDirectory | Out-Null

$schema = "wp20_$runId"
$schemaMarker = "wp20:$runId"
$snapshotMarker = ".wp20-marker-$runId"
$runtimeMarker = ".wp20-runtime-marker-$runId"
$receipts = [System.Collections.Generic.List[object]]::new()
$snapshotCreated = $false
$schemaCreated = $false
$runnerFailure = $null
$preflight = $null
$npx = $null
$syntheticEnv = $null

function Write-Utf8File([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Sanitize-Text([string]$Value) {
    if ($null -eq $Value) { return "" }
    $safe = $Value -replace '(?i)postgres(?:ql)?://[^\s"''`]+', '[REDACTED_DATABASE_URL]'
    $safe = $safe -replace '(?i)(api[_-]?key|token|secret|password|authorization)\s*([=:])\s*[^\s,;]+', '$1$2[REDACTED]'
    return $safe -replace '(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[REDACTED_EMAIL]'
}

function Get-GitState {
    return [ordered]@{
        branch = (@(& git -C $workspaceRoot -c core.longpaths=true branch --show-current 2>$null) -join "`n")
        status = @(& git -C $workspaceRoot -c core.longpaths=true status --porcelain=v1 2>$null)
        staged = @(& git -C $workspaceRoot -c core.longpaths=true diff --cached --name-only 2>$null)
    }
}

function Quote-Argument([string]$Argument) {
    if ($Argument -notmatch '[\s"]') { return $Argument }
    return '"' + ($Argument -replace '(\\*)"', '$1$1\\"') + '"'
}

function Add-Receipt([string]$Name, [int]$ExitCode, [long]$DurationMs, [string]$Stdout, [string]$Stderr) {
    $summary = Sanitize-Text (($Stdout + "`n" + $Stderr).Trim())
    $receipts.Add([ordered]@{
        name = $Name; exit_code = $ExitCode; duration_ms = $DurationMs
        classification = if ($ExitCode -eq 0) { "PASS" } else { "FAIL" }
        raw_stdout_log = "$Name.stdout.log"; raw_stderr_log = "$Name.stderr.log"
        sanitized_summary = $summary.Substring(0, [Math]::Min(4000, $summary.Length))
    }) | Out-Null
}

function Invoke-IsolatedCommand {
    param([string]$Name, [string]$FilePath, [string[]]$ArgumentList, [hashtable]$Environment)
    $outPath = Join-Path $logDirectory "$Name.stdout.log"
    $errPath = Join-Path $logDirectory "$Name.stderr.log"
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath; $info.WorkingDirectory = $snapshotRoot
    $info.UseShellExecute = $false; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true; $info.CreateNoWindow = $true
    $info.Environment.Clear(); foreach ($key in $Environment.Keys) { $info.Environment[$key] = [string]$Environment[$key] }
    $info.Arguments = (($ArgumentList | ForEach-Object { Quote-Argument $_ }) -join " ")
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    $watch = [Diagnostics.Stopwatch]::StartNew(); [void]$process.Start()
    $outTask = $process.StandardOutput.ReadToEndAsync(); $errTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit(); $stdout = $outTask.GetAwaiter().GetResult(); $stderr = $errTask.GetAwaiter().GetResult(); $watch.Stop()
    Write-Utf8File $outPath $stdout; Write-Utf8File $errPath $stderr
    Add-Receipt $Name $process.ExitCode $watch.ElapsedMilliseconds $stdout $stderr
    return $process.ExitCode
}

try {
    if ($schema -notmatch '^wp20_[a-z0-9_]+$') { throw "Generated schema does not match the WP-20 allowlist." }
    $preflight = Get-GitState
    if ($preflight.branch -in @("main", "master")) { throw "WP-20 refuses to run on main/master." }
    if ($preflight.staged.Count -ne 0) { throw "WP-20 requires an empty staging area." }
    $preflight | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportDirectory "preflight-git-state.json") -Encoding utf8

    New-Item -ItemType Directory -Force -Path $snapshotRoot | Out-Null; $snapshotCreated = $true
    Write-Utf8File (Join-Path $snapshotRoot $snapshotMarker) "WP-20 disposable snapshot: $runId"
    $robocopyArgs = @($workspaceRoot, $snapshotRoot, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:1", "/W:1", "/XD", ".git", "node_modules", ".next", "coverage", "test-results", "playwright-report", "reports", ".venv", "logs", "runtime", "tmp", "worktrees", "/XF", ".env*", "cookies.txt", "*.cookies.txt")
    & robocopy @robocopyArgs | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE." }
    $snapshotEnvFiles = @(Get-ChildItem -LiteralPath $snapshotRoot -Recurse -Force -Filter ".env*" | ForEach-Object FullName)
    if ($snapshotEnvFiles.Count -gt 0) { throw "Fail-closed: snapshot contains .env* filenames." }

    [string]$npm = Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    [string]$npx = Get-Command npx.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    [string]$node = Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    [string]$git = Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    $databaseUrl = "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"
    $uri = [Uri]$databaseUrl
    if ($uri.Host -ne "127.0.0.1" -or $uri.Port -ne 54329 -or $uri.AbsolutePath.TrimStart('/') -ne "celebratedeal_ci" -or $uri.Query -notmatch "schema=$schema") { throw "Fail-closed: database URL failed the WP-20 local safety gate." }
    $playwrightBrowserCache = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) "ms-playwright"
    $chromium = Get-ChildItem -LiteralPath $playwrightBrowserCache -Recurse -Filter "chrome-headless-shell.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $chromium) { throw "Local Chromium is unavailable; targeted Browser QA cannot start." }
    $npmrc = Join-Path $snapshotRoot "wp20-npmrc"; Write-Utf8File $npmrc "audit=false`nfund=false`nupdate-notifier=false`n"
    $childPath = @((Split-Path -Parent $npm), (Split-Path -Parent $node), (Split-Path -Parent $git), [Environment]::GetEnvironmentVariable("Path", "Machine"), [Environment]::SystemDirectory) -join ';'
    $syntheticEnv = @{
        PATH = $childPath; SystemRoot = $env:SystemRoot; ComSpec = (Join-Path ([Environment]::SystemDirectory) "cmd.exe")
        # Playwright transform cache uses TEMP. Keep generated JS outside the
        # snapshot so the subsequent repository lint never scans it.
        TEMP = $runtimeRoot; TMP = $runtimeRoot; HOME = (Join-Path $snapshotRoot "home"); USERPROFILE = (Join-Path $snapshotRoot "home")
        NPM_CONFIG_USERCONFIG = $npmrc; NPM_CONFIG_CACHE = (Join-Path $snapshotRoot "npm-cache"); PLAYWRIGHT_BROWSERS_PATH = $playwrightBrowserCache
        DATABASE_URL = $databaseUrl; DIRECT_URL = $databaseUrl; NODE_ENV = "production"; CI = "true"; NO_PROXY = "*"; NEXT_TELEMETRY_DISABLED = "1"
        E2E_TEST_MODE = "true"; E2E_PORT = "31024"; E2E_BASE_URL = "http://127.0.0.1:31024"; E2E_RATE_LIMIT_PROVIDER = "memory"; RATE_LIMIT_PROVIDER = "memory"
        NEXT_PUBLIC_APP_URL = "http://127.0.0.1:31024"; PAYMENT_PROVIDER = "demo"; JOB_SECRET = "wp20_job_secret_synthetic"; CSRF_SECRET = "wp20_csrf_secret_synthetic"
        RESEND_API_KEY = ""; EMAIL_FROM = ""; SENTRY_DSN = ""; NEXT_PUBLIC_SENTRY_DSN = ""; SENTRY_AUTH_TOKEN = ""; SENTRY_DISABLE_AUTO_UPLOAD = "true"
        NEXT_PUBLIC_POSTHOG_KEY = ""; NEXT_PUBLIC_POSTHOG_HOST = ""; CLOUDFLARE_ACCOUNT_ID = ""; CLOUDFLARE_STREAM_TOKEN = ""; CLOUDFLARE_STREAM_WEBHOOK_SECRET = ""
    }
    $installEnv = @{}; foreach ($key in $syntheticEnv.Keys) { $installEnv[$key] = $syntheticEnv[$key] }; $installEnv.NODE_ENV = "development"
    New-Item -ItemType Directory -Force -Path $syntheticEnv.TEMP, $syntheticEnv.HOME, $syntheticEnv.NPM_CONFIG_CACHE | Out-Null
    Write-Utf8File (Join-Path $runtimeRoot $runtimeMarker) "WP-20 disposable runtime: $runId"
    [ordered]@{ work_package = "WP-20"; run_id = $runId; source_env_contents_read = $false; synthetic_environment_only = $true; disposable_schema = $schema; chromium = $chromium.Name } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportDirectory "environment-safety.json") -Encoding utf8

    # secret:scan inventories tracked and untracked snapshot files via Git. The
    # snapshot excludes the source repository metadata, so initialize local-only
    # metadata before scanning; no source files or refs are touched.
    if ((Invoke-IsolatedCommand "snapshot-git-init" $git @("init", "--quiet") $syntheticEnv) -ne 0) { throw "Snapshot Git initialization failed." }
    if ((Invoke-IsolatedCommand "snapshot-git-index" $git @("add", "--all") $syntheticEnv) -ne 0) { throw "Snapshot Git indexing failed." }
    if ((Invoke-IsolatedCommand "npm-ci" $npm @("ci") $installEnv) -ne 0) { throw "npm ci failed." }
    $bootstrapSql = Join-Path $snapshotRoot "wp20-bootstrap.sql"
    Write-Utf8File $bootstrapSql "CREATE SCHEMA IF NOT EXISTS `"$schema`";`nCOMMENT ON SCHEMA `"$schema`" IS '$schemaMarker';`n"
    if ((Invoke-IsolatedCommand "database-bootstrap" $npx @("prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", ".\\wp20-bootstrap.sql") $syntheticEnv) -ne 0) { throw "Disposable schema bootstrap failed." }
    $schemaCreated = $true
    foreach ($item in @(
        @{ name = "secret-scan"; file = $npm; args = @("run", "secret:scan") }, @{ name = "prisma-validate"; file = $npx; args = @("prisma", "validate") },
        @{ name = "prisma-generate"; file = $npx; args = @("prisma", "generate") }, @{ name = "prisma-migrate-deploy"; file = $npx; args = @("prisma", "migrate", "deploy") },
        @{ name = "prisma-migrate-status"; file = $npx; args = @("prisma", "migrate", "status") },
        @{ name = "targeted-unit-and-audit-db"; file = $npm; args = @("run", "test", "--", "--run", "src/lib/password-reset.test.ts", "src/app/api/auth/password-reset/request/route.test.ts", "src/app/actions.test.ts") },
        @{ name = "browser-password-reset"; file = $npx; args = @("playwright", "test", "tests/e2e/smoke.spec.ts", "--grep", "password reset request hides account existence and revokes an undelivered reset record", "--workers=1", "--retries=1") },
        @{ name = "browser-password-reset-retry"; file = $npx; args = @("playwright", "test", "tests/e2e/smoke.spec.ts", "--grep", "password reset request hides account existence and revokes an undelivered reset record", "--workers=1", "--retries=1") },
        @{ name = "lint"; file = $npm; args = @("run", "lint") }, @{ name = "typecheck"; file = $npm; args = @("run", "typecheck") },
        @{ name = "git-diff-check"; file = $git; args = @("-c", "core.longpaths=true", "-c", "core.autocrlf=false", "diff", "--check") }
    )) { if ((Invoke-IsolatedCommand $item.name $item.file $item.args $syntheticEnv) -ne 0) { throw "$($item.name) failed." } }
    foreach ($name in @("browser-password-reset", "browser-password-reset-retry")) {
        $log = Get-Content -Raw -LiteralPath (Join-Path $logDirectory "$name.stdout.log")
        if ($log -notmatch '\b1\s+passed\b' -or $log -match '\b(?:[1-9]\d*)\s+(?:failed|skipped)\b') { throw "$name did not confirm exactly one passing test." }
    }
} catch {
    $runnerFailure = Sanitize-Text $_.Exception.Message
    Write-Utf8File (Join-Path $reportDirectory "runner-error.sanitized.txt") $runnerFailure
    $receipts.Add([ordered]@{ name = "runner-safety"; exit_code = $null; duration_ms = 0; classification = "BLOCKED_BY_TEST_INFRA"; raw_stdout_log = $null; raw_stderr_log = $null; sanitized_summary = $runnerFailure }) | Out-Null
} finally {
    $cleanupResult = "NOT_APPLICABLE"
    if ($schemaCreated -and $null -ne $npx -and $null -ne $syntheticEnv -and (Test-Path -LiteralPath (Join-Path $snapshotRoot $snapshotMarker)) -and $schema -match '^wp20_[a-z0-9_]+$') {
        $cleanupSql = Join-Path $snapshotRoot "wp20-cleanup.sql"
        $template = @'
DO $wp20$
BEGIN
  IF (SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = '__SCHEMA__') <> '__MARKER__' THEN
    RAISE EXCEPTION 'WP-20 schema marker missing or mismatched';
  END IF;
  EXECUTE 'DROP SCHEMA "__SCHEMA__" CASCADE';
END
$wp20$;
'@
        Write-Utf8File $cleanupSql ($template.Replace('__SCHEMA__', $schema).Replace('__MARKER__', $schemaMarker))
        $cleanupExit = Invoke-IsolatedCommand "database-cleanup" $npx @("prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", ".\\wp20-cleanup.sql") $syntheticEnv
        $cleanupResult = if ($cleanupExit -eq 0) { "PASS" } else { "FAIL" }
    }
    $postflight = Get-GitState
    $sourceGitUnchanged = $null -ne $preflight -and (($preflight.status -join "`n") -eq ($postflight.status -join "`n")) -and (($preflight.staged -join "`n") -eq ($postflight.staged -join "`n"))
    $summary = [ordered]@{ work_package = "WP-20"; run_id = $runId; final_runner_error = $runnerFailure; source_env_contents_read = $false; source_git_unchanged = $sourceGitUnchanged; schema_cleanup = $cleanupResult; snapshot_cleanup = "PENDING"; runtime_cleanup = "PENDING"; receipts = @($receipts) }
    if ($snapshotCreated -and (Test-Path -LiteralPath $snapshotRoot) -and (Test-Path -LiteralPath (Join-Path $snapshotRoot $snapshotMarker))) { Remove-Item -LiteralPath $snapshotRoot -Recurse -Force; $summary.snapshot_cleanup = "PASS" }
    if ((Test-Path -LiteralPath $runtimeRoot) -and (Test-Path -LiteralPath (Join-Path $runtimeRoot $runtimeMarker))) { Remove-Item -LiteralPath $runtimeRoot -Recurse -Force; $summary.runtime_cleanup = "PASS" }
    $summary | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath (Join-Path $reportDirectory "command-receipts.sanitized.json") -Encoding utf8
    $summary | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath (Join-Path $reportDirectory "final-runner-summary.sanitized.json") -Encoding utf8
}

Write-Output "WP-20 report: $reportDirectory"
if ($runnerFailure -or @($receipts | Where-Object { $_.classification -ne "PASS" }).Count -gt 0) { exit 1 }
exit 0
