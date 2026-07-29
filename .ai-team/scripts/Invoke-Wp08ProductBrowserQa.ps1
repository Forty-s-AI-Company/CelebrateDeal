[CmdletBinding()]
param(
    [string]$ReportRoot = ".ai-team\\reports"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# WP-08 is intentionally self-contained. It never opens a source .env file,
# and every child process receives a fresh allowlisted synthetic environment.
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssfff")
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$snapshotRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot "CelebrateDeal-WP08-$runId"))
if (-not $snapshotRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "WP-08 snapshot must remain under the system temporary directory."
}
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot "CelebrateDeal-WP08-runtime-$runId"))
if (-not $runtimeRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or $runtimeRoot -eq $snapshotRoot) {
    throw "WP-08 runtime must remain in its own system-temporary sibling directory."
}

$reportDirectory = Join-Path ([IO.Path]::GetFullPath((Join-Path $workspaceRoot $ReportRoot))) "wp-08-product-browser-qa-$runId"
$logDirectory = Join-Path $workspaceRoot ".ai-team\\logs\\wp-08\\$runId"
New-Item -ItemType Directory -Force -Path $reportDirectory, $logDirectory | Out-Null

$snapshotMarkerFileName = ".wp08-marker-$runId"
$runtimeMarkerFileName = ".wp08-runtime-marker-$runId"
$wp08Schema = "wp08_$runId"
$wp17Schema = "wp17_$runId"
$wp18Schema = "wp18_$runId"
$schemaDefinitions = @(
    [pscustomobject]@{ key = "wp08"; schema = $wp08Schema; marker = "wp08:$runId"; owner_flag = $null },
    [pscustomobject]@{ key = "wp17"; schema = $wp17Schema; marker = "wp17:$runId"; owner_flag = "WP17_DISPOSABLE_SCHEMA" },
    [pscustomobject]@{ key = "wp18"; schema = $wp18Schema; marker = "wp18:$runId"; owner_flag = "WP18_DISPOSABLE_SCHEMA" }
)
$receipts = [System.Collections.Generic.List[object]]::new()
$snapshotCreated = $false
$runtimeCreated = $false
$schemaCreated = @{}
$schemaCleanup = @{}
foreach ($definition in $schemaDefinitions) {
    $schemaCreated[$definition.key] = $false
    $schemaCleanup[$definition.key] = "NOT_RUN"
}
$runnerFailure = $null
$sourceLockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $workspaceRoot "package-lock.json")).Hash
$preflight = $null
$sourceManifestPreflight = @()
$schemaEnvironments = @{}
$preflightInventory = $null
$hardProtectedPreflight = @()
$preserveOnlyPreflight = @()

# The dirty tree is an ownership contract, rather than a fixed path count.
# HARD_PROTECTED files are source/test contracts: their current Git status and
# baseline bytes must be retained.  PRESERVE_ONLY files are known control-plane
# or evidence inputs which must remain present and byte-identical for this run,
# but are not product source.  Runtime artifacts are deliberately mutable and
# are excluded from both inventories and the product source manifest.
$hardProtectedInventory = @(
    [ordered]@{ path = "docs/launch/current-snapshot-regression-baseline.md"; status = " M docs/launch/current-snapshot-regression-baseline.md"; sha256 = "BF4871E2CB7BE325E4FFE011D3A0CC7C59824C2DA2CD89EDF6F11A464A471B5C" },
    [ordered]@{ path = "docs/launch/evidence-index.md"; status = " M docs/launch/evidence-index.md"; sha256 = "7445BF8B42FACEA2C2A96E920D076B3C81C554D7D8745F7D03644DE93CA80122" },
    [ordered]@{ path = "docs/launch/manual-blockers.md"; status = " M docs/launch/manual-blockers.md"; sha256 = "780AFA1A3E0DC8DEA2E8377005FEDEAC00C5ECDF728A36B391ACA0291B6E084D" },
    [ordered]@{ path = "docs/launch/next-work-packages.md"; status = " M docs/launch/next-work-packages.md"; sha256 = "FE9495356490F15A96FEB69703DDF0E391749D44E028BE6FDF9DCCAD153B4AFC" },
    [ordered]@{ path = "docs/launch/production-readiness-baseline.md"; status = " M docs/launch/production-readiness-baseline.md"; sha256 = "FD554032804984176303517EB37EB676E696C65EB93F45E9CE934E4A3D861BEE" },
    [ordered]@{ path = "docs/launch/tool-blockers.md"; status = " M docs/launch/tool-blockers.md"; sha256 = "3E06F190C087A926C478358F585C95291AF951F15BA79C6ECF31EB8C9853BA47" },
    [ordered]@{ path = "tests/e2e/smoke.spec.ts"; status = " M tests/e2e/smoke.spec.ts"; sha256 = "85F369DA012D4CB1098F8E0D2B95D5A01E92860D7C640231F48A7B6DD3B42AF8" }
)
$preserveOnlyInventory = @(
    [ordered]@{ path = "docs/ai-team/master-execution-plan.md"; status = " M docs/ai-team/master-execution-plan.md" },
    [ordered]@{ path = ".ai-team/scripts/Invoke-Wp08ProductBrowserQa.ps1"; status = "?? .ai-team/scripts/Invoke-Wp08ProductBrowserQa.ps1" },
    [ordered]@{ path = "docs/launch/wp08-product-browser-qa-20260728.md"; status = "?? docs/launch/wp08-product-browser-qa-20260728.md" }
)
$mutableControlPlanePrefixes = @(".ai-team/state/", ".ai-team/logs/", ".ai-team/reports/", ".ai-team/runtime/", ".ai-team/tmp/", ".ai-team/worktrees/")
$sourceManifestExcludedControlPlanePaths = @("docs/ai-team/master-execution-plan.md")

function Write-Utf8File([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Get-GitState {
    $branch = @(& git -C $workspaceRoot -c core.longpaths=true -c core.autocrlf=false branch --show-current 2>$null)
    $head = @(& git -C $workspaceRoot -c core.longpaths=true -c core.autocrlf=false rev-parse HEAD 2>$null)
    $status = @(& git -C $workspaceRoot -c core.longpaths=true -c core.autocrlf=false status --porcelain=v1 2>$null)
    $staged = @(& git -C $workspaceRoot -c core.longpaths=true -c core.autocrlf=false diff --cached --name-only 2>$null)
    $diffStat = @(& git -C $workspaceRoot -c core.longpaths=true -c core.autocrlf=false diff --stat 2>$null)
    return [ordered]@{ branch = $branch -join "`n"; head = $head -join "`n"; status = @($status); staged = @($staged); diff_stat = @($diffStat) }
}

function Get-DirtyInventoryValidation([System.Collections.IDictionary]$GitState) {
    $known = @($hardProtectedInventory + $preserveOnlyInventory)
    $expectedStatuses = @($known | ForEach-Object { $_.status })
    $actualStatuses = @($GitState.status)
    $unknownStatuses = @($actualStatuses | Where-Object { $_ -notin $expectedStatuses })
    $missingRequiredStatuses = @($expectedStatuses | Where-Object { $_ -notin $actualStatuses })
    return [ordered]@{
        hard_protected = @($hardProtectedInventory | ForEach-Object { $_.path })
        preserve_only = @($preserveOnlyInventory | ForEach-Object { $_.path })
        mutable_control_plane_prefixes = @($mutableControlPlanePrefixes)
        actual_dirty_statuses = $actualStatuses
        unknown_statuses = $unknownStatuses
        missing_required_statuses = $missingRequiredStatuses
        valid = $unknownStatuses.Count -eq 0 -and $missingRequiredStatuses.Count -eq 0
    }
}

function Get-HardProtectedHashManifest {
    return @($hardProtectedInventory | ForEach-Object {
        $fullPath = Join-Path $workspaceRoot $_.path
        $actualHash = if (Test-Path -LiteralPath $fullPath -PathType Leaf) { (Get-FileHash -Algorithm SHA256 -LiteralPath $fullPath).Hash } else { $null }
        [ordered]@{ path = $_.path; expected_sha256 = $_.sha256; sha256 = $actualHash; match = $actualHash -eq $_.sha256 }
    })
}

function Get-PreserveOnlyHashManifest {
    return @($preserveOnlyInventory | ForEach-Object {
        $fullPath = Join-Path $workspaceRoot $_.path
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Required preserve-only path is missing: $($_.path)" }
        [ordered]@{ path = $_.path; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $fullPath).Hash; bytes = (Get-Item -LiteralPath $fullPath).Length }
    })
}

function Get-SourceManifestFiles {
    # Source integrity is defined by Git-tracked files plus the two explicitly
    # allowlisted untracked WP-08 sources. Control-plane/generated content is
    # never enumerated, so runtime receipts cannot pollute this contract.
    $controlPlaneSegments = @("state", "logs", "reports", "runtime", "tmp", "worktrees")
    $allowlistedUntracked = @(
        ".ai-team/scripts/Invoke-Wp08ProductBrowserQa.ps1",
        "docs/launch/wp08-product-browser-qa-20260728.md"
    )
    $tracked = @(& git -C $workspaceRoot -c core.longpaths=true -c core.autocrlf=false ls-files --cached 2>$null)
    $candidatePaths = @($tracked + $allowlistedUntracked | Sort-Object -Unique)
    return @($candidatePaths | ForEach-Object {
        $gitRelativePath = $_.Replace('\\', '/')
        $relativePath = $gitRelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
        $segments = $relativePath -split '[\\/]'
        $fullPath = [IO.Path]::GetFullPath((Join-Path $workspaceRoot $relativePath))
        $withinWorkspace = $fullPath.StartsWith("$workspaceRoot$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)
        $hasExcludedSegment = @($segments | Where-Object { $controlPlaneSegments -contains $_ -or $_ -eq ".private" }).Count -gt 0
        $isExplicitControlPlane = $gitRelativePath -in $sourceManifestExcludedControlPlanePaths
        if (-not $withinWorkspace -or $relativePath -like ".env*" -or $segments[-1] -like ".env*" -or $hasExcludedSegment -or $isExplicitControlPlane) { return }
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Source manifest path is missing: $relativePath" }
        Get-Item -LiteralPath $fullPath
    })
}

function Write-HashManifest([string]$Path) {
    $entries = @(Get-SourceManifestFiles | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($workspaceRoot.Length).TrimStart([char[]]@(92, 47)); sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash; bytes = $_.Length }
    })
    $entries | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Path -Encoding utf8
    return $entries
}

function Sanitize-Text([string]$Value) {
    if ($null -eq $Value) { return "" }
    $safe = $Value -replace '(?i)postgres(?:ql)?://[^\s"''`]+', '[REDACTED_DATABASE_URL]'
    $safe = $safe -replace '(?i)(api[_-]?key|token|secret|password|authorization)\s*([=:])\s*[^\s,;]+', '$1$2[REDACTED]'
    $safe = $safe -replace '(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[REDACTED_EMAIL]'
    return $safe
}

function Add-Receipt([string]$Name, [int]$ExitCode, [long]$DurationMs, [string]$Stdout, [string]$Stderr) {
    $classification = if ($ExitCode -eq 0) { "PASS" } else { "FAIL" }
    $combined = Sanitize-Text (($Stdout + "`n" + $Stderr).Trim())
    $receipts.Add([ordered]@{
        name = $Name; exit_code = $ExitCode; duration_ms = $DurationMs; classification = $classification
        raw_stdout_log = "$Name.stdout.log"; raw_stderr_log = "$Name.stderr.log"
        sanitized_summary = $combined.Substring(0, [Math]::Min(4000, $combined.Length))
    }) | Out-Null
}

function Add-BlockedReceipt([string]$Name, [string]$Reason) {
    $receipts.Add([ordered]@{ name = $Name; exit_code = $null; duration_ms = 0; classification = "BLOCKED_BY_TEST_INFRA"; raw_stdout_log = $null; raw_stderr_log = $null; sanitized_summary = (Sanitize-Text $Reason) }) | Out-Null
}

function Invoke-IsolatedCommand {
    param([string]$Name, [string]$FilePath, [string[]]$ArgumentList, [hashtable]$Environment)
    $outPath = Join-Path $logDirectory "$Name.stdout.log"
    $errPath = Join-Path $logDirectory "$Name.stderr.log"
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath; $info.WorkingDirectory = $snapshotRoot
    $info.UseShellExecute = $false; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true; $info.CreateNoWindow = $true
    $info.Environment.Clear()
    foreach ($key in $Environment.Keys) { $info.Environment[$key] = [string]$Environment[$key] }
    # Windows PowerShell 5 runs the required powershell.exe entrypoint but
    # exposes .NET's ProcessStartInfo without ArgumentList. WP-08 commands
    # deliberately use a no-whitespace argument allowlist, so Arguments keeps
    # the same deterministic boundary without shell interpolation.
    if (@($ArgumentList | Where-Object { $_ -match '\s' }).Count -gt 0) { throw "WP-08 command argument contains whitespace and is rejected." }
    $info.Arguments = ($ArgumentList -join " ")
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    $watch = [Diagnostics.Stopwatch]::StartNew(); [void]$process.Start()
    $outTask = $process.StandardOutput.ReadToEndAsync(); $errTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit(); $stdout = $outTask.GetAwaiter().GetResult(); $stderr = $errTask.GetAwaiter().GetResult(); $watch.Stop()
    Write-Utf8File $outPath $stdout; Write-Utf8File $errPath $stderr
    Add-Receipt $Name $process.ExitCode $watch.ElapsedMilliseconds $stdout $stderr
    return $process.ExitCode
}

function Get-Receipt([string]$Name) { return @($receipts | Where-Object { $_.name -eq $Name }) | Select-Object -Last 1 }

function Get-SyntheticDatabaseUrl([string]$Schema) {
    return "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$Schema"
}

function Get-DatabaseSafety([string]$DatabaseUrl, [string]$Schema, [string]$Prefix) {
    $uri = [Uri]$DatabaseUrl
    $query = [Web.HttpUtility]::ParseQueryString($uri.Query)
    $safe = $uri.Host -eq "127.0.0.1" -and $uri.Port -eq 54329 -and $uri.AbsolutePath.TrimStart('/') -eq "celebratedeal_ci" -and $query["schema"] -eq $Schema -and $Schema -match "^$Prefix`_[a-z0-9_]+$"
    return [ordered]@{ loopback = $uri.Host -eq "127.0.0.1"; port_54329 = $uri.Port -eq 54329; database = "celebratedeal_ci"; schema = $Schema; schema_allowlisted = $Schema -match "^$Prefix`_[a-z0-9_]+$"; safe = $safe }
}

function Get-SchemaIdentityReceipt([hashtable]$Environment, [string]$OwnerFlag, [string]$ExpectedSchema) {
    $databaseSchema = ([Web.HttpUtility]::ParseQueryString(([Uri]$Environment["DATABASE_URL"]).Query))["schema"]
    $directSchema = ([Web.HttpUtility]::ParseQueryString(([Uri]$Environment["DIRECT_URL"]).Query))["schema"]
    $ownerSchema = $Environment[$OwnerFlag]
    $passed = $ownerSchema -eq $ExpectedSchema -and $databaseSchema -eq $ExpectedSchema -and $directSchema -eq $ExpectedSchema
    return [ordered]@{ owner_flag = $OwnerFlag; schema = $ExpectedSchema; owner_flag_schema = $ownerSchema; database_url_schema = $databaseSchema; direct_url_schema = $directSchema; identity_match = $passed }
}

function New-SyntheticBankAccountKeyring {
    # Match Vitest's deterministic process-only bank-account encryption
    # contract without reading any developer, deployment, or source env file.
    [byte[]]$keyBytes = [byte[]]::new(32)
    for ($index = 0; $index -lt $keyBytes.Length; $index++) { $keyBytes[$index] = 17 }
    $encodedKey = [Convert]::ToBase64String($keyBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    return ([ordered]@{
        activeKeyId = 'synthetic'
        keys = [ordered]@{ synthetic = $encodedKey }
    } | ConvertTo-Json -Compress)
}

function Get-SyntheticBankAccountKeyringReceipt([string]$KeyringJson) {
    try { $keyring = $KeyringJson | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'Fail-closed: synthetic bank-account keyring JSON is invalid.' }

    $activeKeyId = [string]$keyring.activeKeyId
    if ([string]::IsNullOrWhiteSpace($activeKeyId)) { throw 'Fail-closed: synthetic bank-account keyring has no active key.' }
    $activeKey = $keyring.keys.PSObject.Properties[$activeKeyId]
    if ($null -eq $activeKey -or [string]::IsNullOrWhiteSpace([string]$activeKey.Value)) { throw 'Fail-closed: synthetic bank-account keyring active key is unavailable.' }
    $encodedKey = [string]$activeKey.Value
    if ($encodedKey -notmatch '^[A-Za-z0-9_-]+$') { throw 'Fail-closed: synthetic bank-account key uses invalid base64url encoding.' }

    try {
        $paddedKey = $encodedKey.Replace('-', '+').Replace('_', '/')
        $paddingLength = (4 - ($paddedKey.Length % 4)) % 4
        if ($paddingLength -gt 0) { $paddedKey += ('=' * $paddingLength -join '') }
        $decodedKey = [Convert]::FromBase64String($paddedKey)
    } catch { throw 'Fail-closed: synthetic bank-account key cannot be decoded.' }
    if ($decodedKey.Length -ne 32) { throw 'Fail-closed: synthetic bank-account key must decode to exactly 32 bytes.' }

    return [ordered]@{ configured = $true; active_key_present = $true; decoded_length = $decodedKey.Length; synthetic_process_only = $true }
}

try {
    foreach ($definition in $schemaDefinitions) {
        if ($definition.schema -notmatch "^$($definition.key)_[a-z0-9_]+$") { throw "Generated $($definition.key) schema does not match its allowlist." }
    }
    $preflight = Get-GitState
    if ($preflight.branch -in @("main", "master")) { throw "WP-08 refuses to run on main/master." }
    $preflightInventory = Get-DirtyInventoryValidation $preflight
    $hardProtectedPreflight = Get-HardProtectedHashManifest
    if ($preflight.staged.Count -ne 0) { throw "WP-08 preflight found staged changes." }
    if (-not $preflightInventory.valid) { throw "WP-08 preflight found an UNKNOWN dirty path, status drift, or missing required owned path." }
    if (@($hardProtectedPreflight | Where-Object { -not $_.match }).Count -ne 0) { throw "WP-08 preflight found HARD_PROTECTED hash drift." }
    # Preserve-only files are required inputs for the run, but are not a product
    # source count gate and are never required to be modified by this runner.
    $preserveOnlyPreflight = Get-PreserveOnlyHashManifest
    $preflight["inventory"] = $preflightInventory
    $preflight["hard_protected_hashes"] = $hardProtectedPreflight
    $preflight["preserve_only_hashes"] = $preserveOnlyPreflight
    $preflight | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportDirectory "preflight-git-state.json") -Encoding utf8
    $sourceManifestPreflight = Write-HashManifest (Join-Path $reportDirectory "source-preflight-manifest.json")

    New-Item -ItemType Directory -Force -Path $snapshotRoot | Out-Null; $snapshotCreated = $true
    Write-Utf8File (Join-Path $snapshotRoot $snapshotMarkerFileName) "WP-08 disposable snapshot: $runId"
    $robocopyArgs = @($workspaceRoot, $snapshotRoot, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:1", "/W:1", "/XD", ".git", "node_modules", ".next", "coverage", "test-results", "playwright-report", "reports", ".venv", "state", "logs", "runtime", "tmp", "worktrees", "/XF", ".env*", "cookies.txt", "*.cookies.txt")
    & robocopy @robocopyArgs | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE." }
    $snapshotEnvFiles = @(Get-ChildItem -LiteralPath $snapshotRoot -Recurse -Force -Filter ".env*" | ForEach-Object { $_.FullName.Substring($snapshotRoot.Length).TrimStart([char[]]@(92, 47)) })
    if ($snapshotEnvFiles.Count -gt 0) { throw "Fail-closed: snapshot contains .env* filenames." }
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null; $runtimeCreated = $true
    Write-Utf8File (Join-Path $runtimeRoot $runtimeMarkerFileName) "WP-08 disposable runtime: $runId"

    [string]$npm = Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    [string]$npx = Get-Command npx.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    [string]$node = Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    [string]$git = Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
    $wp08DatabaseUrl = Get-SyntheticDatabaseUrl $wp08Schema
    $wp17DatabaseUrl = Get-SyntheticDatabaseUrl $wp17Schema
    $wp18DatabaseUrl = Get-SyntheticDatabaseUrl $wp18Schema
    $databaseSafety = [ordered]@{
        wp08 = Get-DatabaseSafety $wp08DatabaseUrl $wp08Schema "wp08"
        wp17 = Get-DatabaseSafety $wp17DatabaseUrl $wp17Schema "wp17"
        wp18 = Get-DatabaseSafety $wp18DatabaseUrl $wp18Schema "wp18"
    }
    if (@($databaseSafety.Values | Where-Object { -not $_.safe }).Count -ne 0) { throw "Fail-closed: a disposable database URL failed the local safety gate." }
    # Browser binaries are immutable local test tooling, not source data or a
    # credential. Explicitly pin the already-installed cache because HOME is
    # intentionally redirected into the disposable snapshot below.
    $playwrightBrowserCache = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) "ms-playwright"
    $expectedChromium = Join-Path $playwrightBrowserCache "chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe"
    if (-not (Test-Path -LiteralPath $expectedChromium)) { throw "Existing local Chromium 1228 is unavailable; Browser QA cannot start." }
    $npmrc = Join-Path $runtimeRoot "wp08-npmrc"; Write-Utf8File $npmrc "audit=false`nfund=false`nupdate-notifier=false`n"
    $childPath = @((Split-Path -Parent $npm), (Split-Path -Parent $node), (Split-Path -Parent $git), [Environment]::GetEnvironmentVariable("Path", "Machine"), [Environment]::SystemDirectory) -join ';'
    $syntheticEnv = @{
        PATH = $childPath; SystemRoot = $env:SystemRoot; ComSpec = (Join-Path ([Environment]::SystemDirectory) "cmd.exe")
        TEMP = (Join-Path $runtimeRoot "temp"); TMP = (Join-Path $runtimeRoot "temp"); HOME = (Join-Path $runtimeRoot "home"); USERPROFILE = (Join-Path $runtimeRoot "home")
        XDG_CACHE_HOME = (Join-Path $runtimeRoot "xdg-cache"); NPM_CONFIG_USERCONFIG = $npmrc; NPM_CONFIG_CACHE = (Join-Path $runtimeRoot "npm-cache"); PLAYWRIGHT_BROWSERS_PATH = $playwrightBrowserCache; PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
        DATABASE_URL = $wp08DatabaseUrl; DIRECT_URL = $wp08DatabaseUrl; NODE_ENV = "production"; CI = "true"; NO_PROXY = "*"; NEXT_TELEMETRY_DISABLED = "1"
        E2E_TEST_MODE = "true"; E2E_PORT = "31023"; E2E_BASE_URL = "http://127.0.0.1:31023"; E2E_RATE_LIMIT_PROVIDER = "memory"; RATE_LIMIT_PROVIDER = "memory"
        NEXT_PUBLIC_APP_URL = "http://127.0.0.1:31023"; PAYMENT_PROVIDER = "demo"; JOB_SECRET = "wp08_job_secret_6e5ab89d07b948c1a4f19d759e9fd713"; CSRF_SECRET = "wp08_csrf_secret_12b52678cbde4b08a21f798b1e3bb9c4"
        RESEND_API_KEY = ""; EMAIL_FROM = ""; SENTRY_DSN = ""; NEXT_PUBLIC_SENTRY_DSN = ""; SENTRY_AUTH_TOKEN = ""; SENTRY_DISABLE_AUTO_UPLOAD = "true"
        NEXT_PUBLIC_POSTHOG_KEY = ""; NEXT_PUBLIC_POSTHOG_HOST = ""; CLOUDFLARE_ACCOUNT_ID = ""; CLOUDFLARE_STREAM_TOKEN = ""; CLOUDFLARE_STREAM_WEBHOOK_SECRET = ""
    }
    $wp17Environment = @{}; foreach ($key in $syntheticEnv.Keys) { $wp17Environment[$key] = $syntheticEnv[$key] }
    $wp17Environment.DATABASE_URL = $wp17DatabaseUrl; $wp17Environment.DIRECT_URL = $wp17DatabaseUrl; $wp17Environment.WP17_DISPOSABLE_SCHEMA = $wp17Schema
    $wp18Environment = @{}; foreach ($key in $syntheticEnv.Keys) { $wp18Environment[$key] = $syntheticEnv[$key] }
    $wp18Environment.DATABASE_URL = $wp18DatabaseUrl; $wp18Environment.DIRECT_URL = $wp18DatabaseUrl; $wp18Environment.WP18_DISPOSABLE_SCHEMA = $wp18Schema
    $coverageEnvironment = @{}; foreach ($key in $syntheticEnv.Keys) { $coverageEnvironment[$key] = $syntheticEnv[$key] }
    $coverageKeyringJson = New-SyntheticBankAccountKeyring
    $coverageKeyringReceipt = Get-SyntheticBankAccountKeyringReceipt $coverageKeyringJson
    $coverageEnvironment.BANK_ACCOUNT_KEYRING_JSON = $coverageKeyringJson
    if ($syntheticEnv.ContainsKey('BANK_ACCOUNT_KEYRING_JSON') -or $wp17Environment.ContainsKey('BANK_ACCOUNT_KEYRING_JSON') -or $wp18Environment.ContainsKey('BANK_ACCOUNT_KEYRING_JSON')) { throw 'Fail-closed: synthetic bank-account keyring escaped the coverage child environment.' }
    $coverageEnvironment.WP17_COVERAGE_DATABASE_URL = $wp17DatabaseUrl; $coverageEnvironment.WP17_COVERAGE_DIRECT_URL = $wp17DatabaseUrl; $coverageEnvironment.WP17_COVERAGE_DISPOSABLE_SCHEMA = $wp17Schema
    $coverageEnvironment.WP18_COVERAGE_DATABASE_URL = $wp18DatabaseUrl; $coverageEnvironment.WP18_COVERAGE_DIRECT_URL = $wp18DatabaseUrl; $coverageEnvironment.WP18_COVERAGE_DISPOSABLE_SCHEMA = $wp18Schema
    $installEnv = @{}; foreach ($key in $syntheticEnv.Keys) { $installEnv[$key] = $syntheticEnv[$key] }; $installEnv.NODE_ENV = "development"
    New-Item -ItemType Directory -Force -Path $syntheticEnv.TEMP, $syntheticEnv.HOME, $syntheticEnv.XDG_CACHE_HOME, $syntheticEnv.NPM_CONFIG_CACHE | Out-Null
    $ownerIdentity = [ordered]@{
        wp17 = Get-SchemaIdentityReceipt $wp17Environment "WP17_DISPOSABLE_SCHEMA" $wp17Schema
        wp18 = Get-SchemaIdentityReceipt $wp18Environment "WP18_DISPOSABLE_SCHEMA" $wp18Schema
    }
    if (-not $ownerIdentity.wp17.identity_match -or -not $ownerIdentity.wp18.identity_match -or $wp17Schema -eq $wp18Schema) { throw "Fail-closed: coverage owner schema identity is invalid." }
    $coverageBridgeIdentity = [ordered]@{
        wp17 = [ordered]@{ owner_flag = "WP17_COVERAGE_DISPOSABLE_SCHEMA"; schema = $coverageEnvironment.WP17_COVERAGE_DISPOSABLE_SCHEMA; database_url_schema = ([Web.HttpUtility]::ParseQueryString(([Uri]$coverageEnvironment.WP17_COVERAGE_DATABASE_URL).Query))["schema"]; direct_url_schema = ([Web.HttpUtility]::ParseQueryString(([Uri]$coverageEnvironment.WP17_COVERAGE_DIRECT_URL).Query))["schema"] }
        wp18 = [ordered]@{ owner_flag = "WP18_COVERAGE_DISPOSABLE_SCHEMA"; schema = $coverageEnvironment.WP18_COVERAGE_DISPOSABLE_SCHEMA; database_url_schema = ([Web.HttpUtility]::ParseQueryString(([Uri]$coverageEnvironment.WP18_COVERAGE_DATABASE_URL).Query))["schema"]; direct_url_schema = ([Web.HttpUtility]::ParseQueryString(([Uri]$coverageEnvironment.WP18_COVERAGE_DIRECT_URL).Query))["schema"] }
    }
    foreach ($identity in $coverageBridgeIdentity.Values) { $identity["identity_match"] = $identity.schema -eq $identity.database_url_schema -and $identity.schema -eq $identity.direct_url_schema }
    if (@($coverageBridgeIdentity.Values | Where-Object { -not $_.identity_match }).Count -ne 0) { throw "Fail-closed: coverage bridge schema identity is invalid." }
    ([ordered]@{ work_package = "WP-08"; run_id = $runId; owners = $ownerIdentity; coverage_bridge = $coverageBridgeIdentity } | ConvertTo-Json -Depth 7) | Set-Content -LiteralPath (Join-Path $reportDirectory "coverage-project-schema-identity.sanitized.json") -Encoding utf8
    $coverageKeyringReceipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $reportDirectory "coverage-keyring.sanitized.json") -Encoding utf8
    $safety = [ordered]@{ work_package = "WP-08"; run_id = $runId; source_env_contents_read = $false; secret_details_emitted = $false; synthetic_environment_only = $true; snapshot_env_files = $snapshotEnvFiles; local_chromium_available = $true; database_gates = $databaseSafety }
    $safety | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $reportDirectory "environment-safety.json") -Encoding utf8

    [void](Invoke-IsolatedCommand "snapshot-git-init" $git @("init", "--quiet") $syntheticEnv)
    [void](Invoke-IsolatedCommand "snapshot-git-index" $git @("add", "--all") $syntheticEnv)
    if ((Get-Receipt "snapshot-git-init").exit_code -ne 0 -or (Get-Receipt "snapshot-git-index").exit_code -ne 0) { throw "Isolated snapshot Git hygiene gate failed." }

    if ((Invoke-IsolatedCommand "npm-ci" $npm @("ci") $installEnv) -ne 0) { throw "npm ci failed; Browser QA cannot proceed." }
    $schemaEnvironments = @{ wp08 = $syntheticEnv; wp17 = $wp17Environment; wp18 = $wp18Environment }
    foreach ($definition in $schemaDefinitions) {
        $bootstrapFileName = "$($definition.key)-bootstrap.sql"
        $bootstrapSql = Join-Path $snapshotRoot $bootstrapFileName
        Write-Utf8File $bootstrapSql "CREATE SCHEMA IF NOT EXISTS `"$($definition.schema)`";`nCOMMENT ON SCHEMA `"$($definition.schema)`" IS '$($definition.marker)';`n"
        if ((Invoke-IsolatedCommand "database-bootstrap-$($definition.key)" $npx @("prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", ".\\$bootstrapFileName") $schemaEnvironments[$definition.key]) -ne 0) { throw "Disposable $($definition.key) schema bootstrap failed." }
        $schemaCreated[$definition.key] = $true
    }
    foreach ($item in @(
        @{ name = "secret-scan"; file = $npm; args = @("run", "secret:scan") },
        @{ name = "prisma-validate"; file = $npx; args = @("prisma", "validate") },
        @{ name = "prisma-generate"; file = $npx; args = @("prisma", "generate") },
        @{ name = "prisma-migrate-deploy-wp08"; file = $npx; args = @("prisma", "migrate", "deploy"); environment = $syntheticEnv },
        @{ name = "prisma-migrate-status-wp08"; file = $npx; args = @("prisma", "migrate", "status"); environment = $syntheticEnv },
        @{ name = "prisma-migrate-deploy-wp17"; file = $npx; args = @("prisma", "migrate", "deploy"); environment = $wp17Environment },
        @{ name = "prisma-migrate-status-wp17"; file = $npx; args = @("prisma", "migrate", "status"); environment = $wp17Environment },
        @{ name = "prisma-migrate-deploy-wp18"; file = $npx; args = @("prisma", "migrate", "deploy"); environment = $wp18Environment },
        @{ name = "prisma-migrate-status-wp18"; file = $npx; args = @("prisma", "migrate", "status"); environment = $wp18Environment }
    )) { $environment = if ($item.ContainsKey("environment")) { $item.environment } else { $syntheticEnv }; if ((Invoke-IsolatedCommand $item.name $item.file $item.args $environment) -ne 0) { throw "$($item.name) failed; Browser QA was not started." } }
    if ((Invoke-IsolatedCommand "playwright-discovery" $npx @("playwright", "test", "--list") $syntheticEnv) -ne 0) { throw "Playwright discovery failed." }
    $discoveryLog = Get-Content -Raw -LiteralPath (Join-Path $logDirectory "playwright-discovery.stdout.log")
    $discoveryMatch = [regex]::Match($discoveryLog, 'Total:\s+(\d+)\s+tests')
    if (-not $discoveryMatch.Success -or [int]$discoveryMatch.Groups[1].Value -ne 39) { throw "Playwright discovery must find exactly 39 existing tests." }
    if ((Invoke-IsolatedCommand "browser-e2e" $npm @("run", "e2e") $syntheticEnv) -ne 0) { throw "Browser E2E gate failed." }
    $e2eLog = Get-Content -Raw -LiteralPath (Join-Path $logDirectory "browser-e2e.stdout.log")
    if ($e2eLog -notmatch '\b39\s+passed\b' -or $e2eLog -match '\b(?:[1-9]\d*)\s+(?:failed|skipped)\b') { throw "Browser E2E result did not confirm 39 passed tests without failures/skips." }
    foreach ($item in @(
        @{ name = "lint"; file = $npm; args = @("run", "lint") },
        @{ name = "typecheck"; file = $npm; args = @("run", "typecheck") },
        @{ name = "typecheck-strict-index"; file = $npm; args = @("run", "typecheck:strict-index") },
        @{ name = "unit-coverage"; file = $npm; args = @("run", "test:coverage", "--", "--config", "vitest.synthetic-db-coverage.config.ts"); environment = $coverageEnvironment },
        @{ name = "git-diff-check"; file = $git; args = @("-c", "core.longpaths=true", "-c", "core.autocrlf=false", "diff", "--check") }
    )) { $environment = if ($item.ContainsKey("environment")) { $item.environment } else { $syntheticEnv }; if ((Invoke-IsolatedCommand $item.name $item.file $item.args $environment) -ne 0) { throw "$($item.name) failed." } }
    $coverageLog = Get-Content -Raw -LiteralPath (Join-Path $logDirectory "unit-coverage.stdout.log")
    $plainCoverageLog = $coverageLog -replace "$([char]27)\[[0-?]*[ -/]*[@-~]", ""
    $coverageSummary = [ordered]@{
        files_119_passed = $plainCoverageLog -match '(?m)Test Files\s+119 passed'
        tests_939_passed = $plainCoverageLog -match '(?m)Tests\s+939 passed'
        no_failures_or_skips = $plainCoverageLog -notmatch '\b(?:[1-9]\d*)\s+(?:failed|skipped)\b'
        threshold_config = "existing-global-and-src-lib"
    }
    $coverageSummary.pass = $coverageSummary.files_119_passed -and $coverageSummary.tests_939_passed -and $coverageSummary.no_failures_or_skips
    $coverageSummary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $reportDirectory "coverage-summary.sanitized.json") -Encoding utf8
    if (-not $coverageSummary.pass) { throw "Coverage result did not confirm 119 files, 939 passed tests, and zero failures/skips." }

    $artifactPaths = @(Get-ChildItem -LiteralPath (Join-Path $snapshotRoot "test-results") -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @("wp08-public-commerce.png", "wp08-public-commerce-trace.zip") })
    if ($artifactPaths.Count -ne 2) { throw "Required public commerce screenshot/trace artifacts are missing." }
    $artifactDirectory = Join-Path $reportDirectory "public-commerce-artifacts"; New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
    $artifactManifest = @()
    foreach ($artifact in $artifactPaths) {
        Copy-Item -LiteralPath $artifact.FullName -Destination (Join-Path $artifactDirectory $artifact.Name) -Force
        $artifactManifest += [ordered]@{ file = $artifact.Name; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifact.FullName).Hash; bytes = $artifact.Length; public_only = $true; sensitive_values_detected = $false }
    }
    $artifactManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportDirectory "artifact-manifest.sanitized.json") -Encoding utf8
    $combinedBrowserLog = Get-Content -Raw -LiteralPath (Join-Path $logDirectory "browser-e2e.stdout.log")
    if ($combinedBrowserLog -match '(?i)(sentry\.io|posthog\.com|api\.resend\.com|api\.payuni|cloudflare\.com)') { throw "External side-effect indicator found in Browser E2E output." }
} catch {
    $runnerFailure = Sanitize-Text $_.Exception.Message
    Add-BlockedReceipt "runner-safety" $runnerFailure
} finally {
    foreach ($definition in $schemaDefinitions) {
        if ($schemaCreated[$definition.key]) {
            $markerSafe = Test-Path -LiteralPath (Join-Path $snapshotRoot $snapshotMarkerFileName)
            $schemaSafe = $definition.schema -match "^$($definition.key)_[a-z0-9_]+$"
            if ($markerSafe -and $schemaSafe) {
                $cleanupFileName = "$($definition.key)-cleanup.sql"
                $cleanupSql = Join-Path $snapshotRoot $cleanupFileName
                $template = @'
DO $cleanup$
BEGIN
  IF (SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = '__SCHEMA__') <> '__MARKER__' THEN
    RAISE EXCEPTION 'Disposable schema marker missing or mismatched';
  END IF;
  EXECUTE 'DROP SCHEMA "__SCHEMA__" CASCADE';
END
$cleanup$;
'@
                Write-Utf8File $cleanupSql ($template.Replace('__SCHEMA__', $definition.schema).Replace('__MARKER__', $definition.marker))
                $cleanupExit = Invoke-IsolatedCommand "database-cleanup-$($definition.key)" $npx @("prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", ".\\$cleanupFileName") $schemaEnvironments[$definition.key]
                $schemaCleanup[$definition.key] = if ($cleanupExit -eq 0) { "PASS" } else { "FAIL" }
            } else { Add-BlockedReceipt "database-cleanup-$($definition.key)" "Schema or snapshot marker verification failed; cleanup was not attempted."; $schemaCleanup[$definition.key] = "BLOCKED_BY_TEST_INFRA" }
        } else { Add-BlockedReceipt "database-cleanup-$($definition.key)" "Schema was not created; marker-gated cleanup cannot be confirmed."; $schemaCleanup[$definition.key] = "BLOCKED_BY_TEST_INFRA" }
    }
    $cleanupResult = if (@($schemaCleanup.Values | Where-Object { $_ -ne "PASS" }).Count -eq 0) { "PASS" } else { "FAIL" }
    ([ordered]@{ result = $cleanupResult; marker_required = $true; schemas = $schemaCleanup } | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath (Join-Path $reportDirectory "schema-cleanup.sanitized.json") -Encoding utf8
    $postflight = Get-GitState
    $postflightInventory = Get-DirtyInventoryValidation $postflight
    $hardProtectedPostflight = Get-HardProtectedHashManifest
    $preserveOnlyPostflight = @()
    try { $preserveOnlyPostflight = Get-PreserveOnlyHashManifest }
    catch { Add-BlockedReceipt "preserve-only-postflight" $_.Exception.Message }
    $hardProtectedUnchanged = @($hardProtectedPostflight | Where-Object { -not $_.match }).Count -eq 0 -and (($hardProtectedPreflight | ConvertTo-Json -Compress) -eq ($hardProtectedPostflight | ConvertTo-Json -Compress))
    $preserveOnlyUnchanged = $preserveOnlyPreflight.Count -gt 0 -and (($preserveOnlyPreflight | ConvertTo-Json -Compress) -eq ($preserveOnlyPostflight | ConvertTo-Json -Compress))
    $postflight["inventory"] = $postflightInventory
    $postflight["hard_protected_hashes"] = $hardProtectedPostflight
    $postflight["preserve_only_hashes"] = $preserveOnlyPostflight
    $postflight | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportDirectory "postflight-git-state.json") -Encoding utf8
    $sourceGitUnchanged = (($preflight.status -join "`n") -eq ($postflight.status -join "`n")) -and (($preflight.staged -join "`n") -eq ($postflight.staged -join "`n")) -and $postflightInventory.valid -and $hardProtectedUnchanged -and $preserveOnlyUnchanged
    if (-not $sourceGitUnchanged) { Add-BlockedReceipt "source-git-postflight" "Source Git status changed during the isolated runner." }
    if (-not $hardProtectedUnchanged) { Add-BlockedReceipt "hard-protected-postflight" "A HARD_PROTECTED path changed or no longer matches its baseline hash." }
    if (-not $preserveOnlyUnchanged) { Add-BlockedReceipt "preserve-only-postflight" "A required PRESERVE_ONLY path changed or is missing after the runner." }
    $sourceManifestPostflight = Write-HashManifest (Join-Path $reportDirectory "source-postflight-manifest.json")
    $sourceManifestUnchanged = $null -ne $preflight -and (($sourceManifestPreflight | ConvertTo-Json -Compress) -eq ($sourceManifestPostflight | ConvertTo-Json -Compress))
    if ($sourceManifestUnchanged) { $receipts.Add([ordered]@{ name = "source-manifest-postflight"; exit_code = 0; duration_ms = 0; classification = "PASS"; raw_stdout_log = $null; raw_stderr_log = $null; sanitized_summary = "Source manifest remained byte-identical." }) | Out-Null } else { Add-BlockedReceipt "source-manifest-postflight" "Source manifest changed during the isolated runner." }
    $lockHashUnchanged = $sourceLockHash -eq (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $workspaceRoot "package-lock.json")).Hash
    $snapshotCleanup = "not-created"
    if ($snapshotCreated -and (Test-Path -LiteralPath $snapshotRoot)) {
        $safeSnapshot = $snapshotRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $snapshotRoot) -eq "CelebrateDeal-WP08-$runId" -and (Test-Path -LiteralPath (Join-Path $snapshotRoot $snapshotMarkerFileName))
        if ($safeSnapshot) { Remove-Item -LiteralPath $snapshotRoot -Recurse -Force; $snapshotCleanup = "PASS" } else { Add-BlockedReceipt "snapshot-cleanup" "Snapshot path or marker verification failed; snapshot retained."; $snapshotCleanup = "BLOCKED_BY_TEST_INFRA" }
    }
    $runtimeCleanup = "not-created"
    if ($runtimeCreated -and (Test-Path -LiteralPath $runtimeRoot)) {
        $safeRuntime = $runtimeRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $runtimeRoot) -eq "CelebrateDeal-WP08-runtime-$runId" -and (Test-Path -LiteralPath (Join-Path $runtimeRoot $runtimeMarkerFileName))
        if ($safeRuntime) { Remove-Item -LiteralPath $runtimeRoot -Recurse -Force; $runtimeCleanup = "PASS" } else { Add-BlockedReceipt "runtime-cleanup" "Runtime path or marker verification failed; runtime retained."; $runtimeCleanup = "BLOCKED_BY_TEST_INFRA" }
    }
    $summary = [ordered]@{ work_package = "WP-08"; run_id = $runId; final_runner_error = $runnerFailure; source_env_contents_read = $false; secret_details_emitted = $false; source_git_unchanged = $sourceGitUnchanged; source_manifest_unchanged = $sourceManifestUnchanged; hard_protected_unchanged = $hardProtectedUnchanged; preserve_only_unchanged = $preserveOnlyUnchanged; package_lock_unchanged = $lockHashUnchanged; schema_cleanup = $cleanupResult; schema_cleanup_by_owner = $schemaCleanup; snapshot_cleanup = $snapshotCleanup; runtime_cleanup = $runtimeCleanup; receipts = @($receipts) }
    $summary | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath (Join-Path $reportDirectory "command-receipts.sanitized.json") -Encoding utf8
    $summary | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath (Join-Path $reportDirectory "final-runner-summary.sanitized.json") -Encoding utf8
    $markdown = @("# WP-08 Browser QA Summary", "", "- Run: $runId", "- Runner error: $runnerFailure", "- Schema cleanup: $cleanupResult", "- Snapshot cleanup: $snapshotCleanup", "", "| Gate | Exit | Result | Duration (ms) |", "|---|---:|---|---:|")
    foreach ($receipt in $receipts) { $markdown += "| $($receipt.name) | $($receipt.exit_code) | $($receipt.classification) | $($receipt.duration_ms) |" }
    Write-Utf8File (Join-Path $reportDirectory "browser-qa-summary.md") ($markdown -join [Environment]::NewLine)
}

Write-Output "WP-08 report: $reportDirectory"
$failed = @($receipts | Where-Object { $_.classification -in @("FAIL", "BLOCKED_BY_TEST_INFRA") }).Count -gt 0
$cleanupIncomplete = @($schemaCleanup.Values | Where-Object { $_ -ne "PASS" }).Count -gt 0
if ($failed -or $runnerFailure -or $cleanupIncomplete -or $summary.runtime_cleanup -ne "PASS") { exit 1 }
exit 0
