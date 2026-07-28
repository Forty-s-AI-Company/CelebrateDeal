[CmdletBinding()]
param(
    [string]$ReportRoot = ".ai-team\\reports",
    [switch]$KeepAuditWorkspaceOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# WP-04 deliberately never opens a source .env file.  All child processes get
# an explicit, synthetic environment and run from a copy where .env* is absent.
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$runId = "{0}-{1}" -f (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss"), ([guid]::NewGuid().ToString("N").Substring(0, 8))
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$auditRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot "CelebrateDeal-WP04-$runId"))
if (-not $auditRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Audit workspace must remain under the system temporary directory."
}

$resolvedReportRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot $ReportRoot))
$reportDirectory = Join-Path $resolvedReportRoot "wp-04-regression-baseline-$runId"
$rawLogDirectory = Join-Path $workspaceRoot ".ai-team\\logs\\wp-04\\$runId"
New-Item -ItemType Directory -Force -Path $reportDirectory, $rawLogDirectory | Out-Null

$markerFileName = ".wp04-audit-marker-$runId"
$receipts = [System.Collections.Generic.List[object]]::new()
$sourcePackageLockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $workspaceRoot "package-lock.json")).Hash
$sourceStatePath = Join-Path $reportDirectory "preflight-source-state.txt"
$postflightStatePath = Join-Path $reportDirectory "postflight-source-state.txt"
$disposableSchemaReady = $false
$databaseCleanup = "not required because the disposable schema was never created"

function Write-Utf8File([string]$Path, [string]$Value) {
    [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

function Get-SourceState {
    # Git 的 CRLF warning 在 strict mode 會被提升為 native-command failure。
    # 這些命令只建立來源狀態摘要，不需要把 Git 的轉換提示混入 evidence。
    # 使用 Windows PowerShell 與 PowerShell 7 都支援的 stderr redirect。
    $branchLines = @()
    $headLines = @()
    $statusLines = @()
    $diffStatLines = @()
    $branchLines = @(& git -C $workspaceRoot -c core.longpaths=true -c core.autocrlf=false branch --show-current 2>$null)
    $headLines = @(& git -C $workspaceRoot -c core.longpaths=true -c core.autocrlf=false rev-parse HEAD 2>$null)
    $statusLines = @(& git -C $workspaceRoot -c core.longpaths=true -c core.autocrlf=false status --short 2>$null)
    $diffStatLines = @(& git -C $workspaceRoot -c core.longpaths=true -c core.autocrlf=false diff --stat 2>$null)
    return @(
        "run_id=$runId",
        "branch=$($branchLines -join [Environment]::NewLine)",
        "head=$($headLines -join [Environment]::NewLine)",
        "status_count=$($statusLines.Count)",
        "-- status --",
        $statusLines,
        "-- diff stat --",
        $diffStatLines
    ) -join [Environment]::NewLine
}

function Get-RelativeSafeFiles([string]$Root) {
    $skipDirectoryNames = @(".git", "node_modules", ".next", "coverage", "test-results", "playwright-report", "reports", ".venv", "logs", "runtime", "tmp", "worktrees")
    return @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force | Where-Object {
        $pathSegments = $_.FullName -split '[\\/]'
        $hasExcludedDirectory = @($pathSegments | Where-Object { $skipDirectoryNames -contains $_ }).Count -gt 0
        $_.Name -notlike ".env*" -and -not $hasExcludedDirectory
    })
}

function Write-Manifest([string]$Root, [string]$Path) {
    $entries = @(Get-RelativeSafeFiles $Root | ForEach-Object {
        [ordered]@{
            path = $_.FullName.Substring($Root.Length).TrimStart('\', '/')
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
            bytes = $_.Length
        }
    })
    $entries | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Path -Encoding utf8
    return $entries.Count
}

function Sanitize-Text([string]$Value) {
    if ($null -eq $Value) { return "" }
    $safe = $Value -replace '(?i)postgres(?:ql)?://[^\s"''`]+', '[REDACTED_DATABASE_URL]'
    $safe = $safe -replace '(?i)(api[_-]?key|token|secret|password|authorization)\s*([=:])\s*[^\s,;]+', '$1$2[REDACTED]'
    $safe = $safe -replace '(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[REDACTED_EMAIL]'
    return $safe
}

function Invoke-IsolatedCommand {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory)][hashtable]$Environment
    )

    $stdoutPath = Join-Path $rawLogDirectory "$Name.stdout.log"
    $stderrPath = Join-Path $rawLogDirectory "$Name.stderr.log"
    $startedAt = (Get-Date).ToUniversalTime().ToString("o")
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath
    $info.WorkingDirectory = $auditRoot
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.CreateNoWindow = $true
    $info.Environment.Clear()
    foreach ($key in $Environment.Keys) { $info.Environment[$key] = [string]$Environment[$key] }
    foreach ($argument in $ArgumentList) { [void]$info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    [void]$process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $watch.Stop()
    Write-Utf8File $stdoutPath $stdout
    Write-Utf8File $stderrPath $stderr
    $status = if ($process.ExitCode -eq 0) { "PASS" } else { "FAIL" }
    $receipts.Add([ordered]@{
        name = $Name
        command = "$([IO.Path]::GetFileName($FilePath)) $($ArgumentList -join ' ')".Trim()
        started_at_utc = $startedAt
        duration_ms = $watch.ElapsedMilliseconds
        exit_code = $process.ExitCode
        classification = $status
        raw_stdout_log = (Resolve-Path -LiteralPath $stdoutPath).Path
        raw_stderr_log = (Resolve-Path -LiteralPath $stderrPath).Path
        sanitized_summary = (Sanitize-Text (($stdout + "`n" + $stderr).Trim())).Substring(0, [Math]::Min(3000, (($stdout + "`n" + $stderr).Trim()).Length))
    }) | Out-Null
    return $process.ExitCode
}

function Add-BlockedReceipt([string]$Name, [string]$Reason) {
    $receipts.Add([ordered]@{
        name = $Name
        command = $null
        started_at_utc = (Get-Date).ToUniversalTime().ToString("o")
        duration_ms = 0
        exit_code = $null
        classification = "BLOCKED_BY_TEST_INFRA"
        raw_stdout_log = $null
        raw_stderr_log = $null
        sanitized_summary = $Reason
    }) | Out-Null
}

try {
    Write-Utf8File $sourceStatePath (Get-SourceState)
    New-Item -ItemType Directory -Force -Path $auditRoot | Out-Null
    Write-Utf8File (Join-Path $auditRoot $markerFileName) "WP-04 disposable audit workspace: $runId"

    # Copy without reading excluded files. Robocopy codes 0..7 mean success.
    $robocopyArgs = @(
        $workspaceRoot, $auditRoot, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:1", "/W:1",
        "/XD", ".git", "node_modules", ".next", "coverage", "test-results", "playwright-report", "reports", ".venv", "logs", "runtime", "tmp", "worktrees",
        "/XF", ".env*", "cookies.txt", "*.cookies.txt"
    )
    & robocopy @robocopyArgs | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
    Write-Utf8File (Join-Path $auditRoot $markerFileName) "WP-04 disposable audit workspace: $runId"

    $unexpectedEnvFiles = @(Get-ChildItem -LiteralPath $auditRoot -Recurse -Force -Filter ".env*" | ForEach-Object { $_.FullName.Substring($auditRoot.Length).TrimStart('\', '/') })
    $sourceFileCount = (Get-RelativeSafeFiles $workspaceRoot).Count
    $snapshotFileCount = Write-Manifest $auditRoot (Join-Path $reportDirectory "source-manifest.json")
    $safety = [ordered]@{
        run_id = $runId
        source_env_contents_read = $false
        snapshot_env_files = $unexpectedEnvFiles
        source_file_count_excluding_derived = $sourceFileCount
        snapshot_file_count_excluding_derived = $snapshotFileCount
        temporary_workspace = $auditRoot
        synthetic_environment_only = $true
    }
    $safety | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportDirectory "environment-safety.json") -Encoding utf8
    if ($unexpectedEnvFiles.Count -gt 0) { throw "Fail-closed: snapshot contains .env* filenames." }

    # Use Windows command shims explicitly; Get-Command npm otherwise resolves
    # npm.ps1, which ProcessStartInfo cannot execute as an application.
    Write-Output "WP-04 runner: preparing isolated command environment"
    [string]$npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    [string]$npxCommand = Get-Command npx.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    [string]$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    [string]$gitCommand = Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    $commandPath = @(
        (Split-Path -Parent $npmCommand),
        (Split-Path -Parent $nodeCommand),
        (Split-Path -Parent $gitCommand),
        [Environment]::GetEnvironmentVariable("Path", "Machine"),
        [Environment]::SystemDirectory
    ) -join ';'
    $schema = "wp04_$($runId -replace '-', '_')"
    if ($schema -notmatch '^wp04_[a-z0-9_]+$') { throw "Generated schema name did not pass the WP-04 allowlist." }
    $databaseUrl = "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"
    $npmUserConfig = Join-Path $auditRoot "wp04-npmrc"
    Write-Utf8File $npmUserConfig "audit=false`nfund=false`nupdate-notifier=false`n"
    $env = @{
        PATH = $commandPath; SystemRoot = $env:SystemRoot; ComSpec = (Join-Path ([Environment]::SystemDirectory) "cmd.exe")
        TEMP = (Join-Path $auditRoot "temp"); TMP = (Join-Path $auditRoot "temp"); HOME = (Join-Path $auditRoot "home"); USERPROFILE = (Join-Path $auditRoot "home")
        NPM_CONFIG_USERCONFIG = $npmUserConfig; NPM_CONFIG_CACHE = (Join-Path $auditRoot "npm-cache")
        DATABASE_URL = $databaseUrl; DIRECT_URL = $databaseUrl; NODE_ENV = "production"
        NEXT_PUBLIC_APP_URL = "https://celebratedeal-wp04.invalid"; JOB_SECRET = "wp04_job_secret_2f80a4b83dff49ddbaf69923f9e74a11"; CSRF_SECRET = "wp04_csrf_secret_bf9b4a3de0c84b58b6e69172ca6d3f47"
        PAYMENT_PROVIDER = "demo"; RESEND_API_KEY = "wp04_resend_synthetic_value"; EMAIL_FROM = "WP-04 Test <noreply@celebratedeal.invalid>"
        SENTRY_DSN = "https://wp04@sentry.invalid/1"; NEXT_PUBLIC_SENTRY_DSN = ""; SENTRY_AUTH_TOKEN = ""; SENTRY_DISABLE_AUTO_UPLOAD = "true"
        SENTRY_ENVIRONMENT = "wp04-test"; NEXT_PUBLIC_SENTRY_ENVIRONMENT = "wp04-test"
        NEXT_PUBLIC_POSTHOG_KEY = "wp04_posthog_synthetic_value"; NEXT_PUBLIC_POSTHOG_HOST = "https://posthog.invalid"
        RATE_LIMIT_PROVIDER = "cloudflare_waf"; CLOUDFLARE_ACCOUNT_ID = "wp04_account_synthetic"; CLOUDFLARE_STREAM_TOKEN = "wp04_stream_synthetic"; CLOUDFLARE_STREAM_WEBHOOK_SECRET = "wp04_webhook_synthetic"
        E2E_TEST_MODE = "true"; E2E_RATE_LIMIT_PROVIDER = "memory"; CI = "true"; NO_PROXY = "*"; NEXT_TELEMETRY_DISABLED = "1"
    }
    # npm ci must include devDependencies such as tsx; later commands retain
    # production mode so the production preflight/build boundary is exercised.
    $installEnvironment = @{}
    foreach ($key in $env.Keys) { $installEnvironment[$key] = $env[$key] }
    $installEnvironment.NODE_ENV = "development"
    New-Item -ItemType Directory -Force -Path $env.TEMP, $env.HOME, $env.NPM_CONFIG_CACHE | Out-Null

    # No DB command runs until the URL is verified structurally without emitting it.
    $uri = [Uri]$databaseUrl
    $dbName = $uri.AbsolutePath.TrimStart('/')
    $query = [Web.HttpUtility]::ParseQueryString($uri.Query)
    $databaseSafe = $uri.Host -eq "127.0.0.1" -and $uri.Port -eq 54329 -and $dbName -match '^celebratedeal_(ci|test)$' -and $query["schema"] -eq $schema
    $safety.database_gate = [ordered]@{ host_loopback = $uri.Host -eq "127.0.0.1"; port_54329 = $uri.Port -eq 54329; approved_database = $dbName -match '^celebratedeal_(ci|test)$'; scoped_schema = $query["schema"] -eq $schema; safe = $databaseSafe }
    $safety | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $reportDirectory "environment-safety.json") -Encoding utf8
    if (-not $databaseSafe) { throw "Fail-closed: synthetic database URL did not pass the WP-04 gate." }

    # The copied snapshot intentionally has no source .git metadata. Create a
    # brand-new, uncommitted index so repository-aware security/hygiene checks
    # inspect this isolated tree without inheriting source history or refs.
    [void](Invoke-IsolatedCommand -Name "snapshot-git-init" -FilePath $gitCommand -ArgumentList @("init", "--quiet") -Environment $env)
    [void](Invoke-IsolatedCommand -Name "snapshot-git-index" -FilePath $gitCommand -ArgumentList @("add", "--all") -Environment $env)

    Write-Output "WP-04 runner: installing isolated dependencies"
    $npmCiExit = Invoke-IsolatedCommand -Name "npm-ci" -FilePath $npmCommand -ArgumentList @("ci") -Environment $installEnvironment
    if ($npmCiExit -ne 0) {
        foreach ($name in @("secret-scan", "prisma-validate", "prisma-generate", "prisma-migrate-deploy", "prisma-migrate-status", "lint", "typecheck", "typecheck-strict-index", "unit-coverage", "build", "playwright-discovery")) { Add-BlockedReceipt $name "npm ci failed; isolated dependencies are unavailable." }
    } else {
        $bootstrapSql = Join-Path $auditRoot "wp04-bootstrap.sql"
        $schemaMarker = "wp04:$runId"
        Write-Utf8File $bootstrapSql "CREATE SCHEMA IF NOT EXISTS `"$schema`";`nCOMMENT ON SCHEMA `"$schema`" IS '$schemaMarker';`n"
        $probeExit = Invoke-IsolatedCommand -Name "database-probe" -FilePath $npxCommand -ArgumentList @("prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", ".\\wp04-bootstrap.sql") -Environment $env
        if ($probeExit -ne 0) {
            foreach ($name in @("secret-scan", "prisma-validate", "prisma-generate", "prisma-migrate-deploy", "prisma-migrate-status", "lint", "typecheck", "typecheck-strict-index", "unit-coverage", "build", "playwright-discovery")) { Add-BlockedReceipt $name "LOCAL_TOOL_BLOCKED: disposable loopback database probe failed; later gates were not run." }
        } else {
            $disposableSchemaReady = $true
            $sequence = @(
                @{ name = "secret-scan"; file = $npmCommand; args = @("run", "secret:scan") },
                @{ name = "prisma-validate"; file = $npxCommand; args = @("prisma", "validate") },
                @{ name = "prisma-generate"; file = $npxCommand; args = @("prisma", "generate") },
                @{ name = "prisma-migrate-deploy"; file = $npxCommand; args = @("prisma", "migrate", "deploy") },
                @{ name = "prisma-migrate-status"; file = $npxCommand; args = @("prisma", "migrate", "status") }
            )
            $prismaSafe = $true
            foreach ($item in $sequence) {
                $exit = Invoke-IsolatedCommand -Name $item.name -FilePath $item.file -ArgumentList $item.args -Environment $env
                if ($item.name -like "prisma-*" -and $exit -ne 0) { $prismaSafe = $false; break }
            }
            if (-not $prismaSafe) {
                foreach ($name in @("lint", "typecheck", "typecheck-strict-index", "unit-coverage", "build", "playwright-discovery")) { Add-BlockedReceipt $name "BLOCKED_BY_TEST_INFRA: Prisma safety gate did not complete successfully." }
            } else {
                foreach ($item in @(
                    @{ name = "lint"; file = $npmCommand; args = @("run", "lint") },
                    @{ name = "typecheck"; file = $npmCommand; args = @("run", "typecheck") },
                    @{ name = "typecheck-strict-index"; file = $npmCommand; args = @("run", "typecheck:strict-index") },
                    @{ name = "unit-coverage"; file = $npmCommand; args = @("run", "test:coverage") },
                    @{ name = "build"; file = $npmCommand; args = @("run", "build") },
                    @{ name = "playwright-discovery"; file = $npxCommand; args = @("playwright", "test", "--list") }
                )) { [void](Invoke-IsolatedCommand -Name $item.name -FilePath $item.file -ArgumentList $item.args -Environment $env) }
            }
        }
    }
} catch {
    Add-BlockedReceipt "runner-safety" (Sanitize-Text $_.Exception.Message)
} finally {
    if ($disposableSchemaReady) {
        $schemaSafeForCleanup = $schema -match '^wp04_[a-z0-9_]+$'
        $workspaceMarkerSafe = Test-Path -LiteralPath (Join-Path $auditRoot $markerFileName)
        if ($schemaSafeForCleanup -and $workspaceMarkerSafe) {
            $cleanupSql = Join-Path $auditRoot "wp04-cleanup.sql"
            $cleanupTemplate = @'
DO $wp04$
BEGIN
  IF (SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = '__SCHEMA__') <> '__MARKER__' THEN
    RAISE EXCEPTION 'WP-04 schema marker missing or mismatched';
  END IF;
  EXECUTE 'DROP SCHEMA "__SCHEMA__" CASCADE';
END
$wp04$;
'@
            $cleanupSqlContent = $cleanupTemplate.Replace('__SCHEMA__', $schema).Replace('__MARKER__', $schemaMarker)
            Write-Utf8File $cleanupSql $cleanupSqlContent
            $cleanupExit = Invoke-IsolatedCommand -Name "database-cleanup" -FilePath $npxCommand -ArgumentList @("prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", ".\\wp04-cleanup.sql") -Environment $env
            $databaseCleanup = if ($cleanupExit -eq 0) { "run-scoped disposable schema safely removed" } else { "database cleanup failed; retained for manual inspection" }
        } else {
            Add-BlockedReceipt "database-cleanup" "Disposable schema cleanup failed schema/marker verification and was not attempted."
            $databaseCleanup = "not attempted because schema or marker verification failed"
        }
    }
    if (Test-Path -LiteralPath $auditRoot) {
        $cleanupSafe = $auditRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $auditRoot) -eq "CelebrateDeal-WP04-$runId" -and (Test-Path -LiteralPath (Join-Path $auditRoot $markerFileName))
        if (-not $cleanupSafe) { Add-BlockedReceipt "audit-workspace-cleanup" "Audit workspace failed path/marker verification and was retained." }
    }
    Write-Utf8File $postflightStatePath (Get-SourceState)
    $packageLockHashAfter = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $workspaceRoot "package-lock.json")).Hash
    $summary = [ordered]@{
        work_package = "WP-04"; run_id = $runId; snapshot_environment = "disposable temp workspace with process-only synthetic env"; source_env_contents_read = $false
        package_lock_unchanged = $sourcePackageLockHash -eq $packageLockHashAfter; report_directory = $reportDirectory; raw_log_directory = $rawLogDirectory
        receipts = @($receipts); cleanup = $databaseCleanup
    }
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $reportDirectory "command-receipts.json") -Encoding utf8
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $reportDirectory "regression-summary.sanitized.json") -Encoding utf8
    $markdown = @("# WP-04 Regression Summary", "", ("- Run: " + $runId), "- Source .env contents read: false", ("- Package lock unchanged: " + $summary.package_lock_unchanged), "", "| Gate | Exit | Classification | Duration (ms) |", "|---|---:|---|---:|")
    foreach ($receipt in $receipts) { $markdown += "| $($receipt.name) | $($receipt.exit_code) | $($receipt.classification) | $($receipt.duration_ms) |" }
    Write-Utf8File (Join-Path $reportDirectory "regression-summary.md") ($markdown -join [Environment]::NewLine)
    if (Test-Path -LiteralPath $auditRoot) {
        $cleanupSafe = $auditRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $auditRoot) -eq "CelebrateDeal-WP04-$runId" -and (Test-Path -LiteralPath (Join-Path $auditRoot $markerFileName))
        $regressionFailed = @($receipts | Where-Object { $_.classification -in @("FAIL", "BLOCKED_BY_TEST_INFRA") }).Count -gt 0
        if ($cleanupSafe -and (-not $KeepAuditWorkspaceOnFailure -or -not $regressionFailed)) {
            Remove-Item -LiteralPath $auditRoot -Recurse -Force
            $summary.cleanup = "$databaseCleanup; temporary workspace safely removed"
        } elseif ($cleanupSafe) { $summary.cleanup = "$databaseCleanup; retained by -KeepAuditWorkspaceOnFailure: $auditRoot" }
    }
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $reportDirectory "regression-summary.sanitized.json") -Encoding utf8
}

Write-Output "WP-04 report: $reportDirectory"
$hasFailure = @($receipts | Where-Object { $_.classification -in @("FAIL", "BLOCKED_BY_TEST_INFRA") }).Count -gt 0
if ($hasFailure) { exit 1 }
exit 0
