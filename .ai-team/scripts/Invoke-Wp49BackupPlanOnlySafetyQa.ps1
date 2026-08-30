[CmdletBinding()]
param(
    [string]$RunId = ('wp-49-backup-plan-only-static-' + (Get-Date -Format 'yyyyMMddHHmmssfff'))
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# WP-49 deliberately never imports, dot-sources, or invokes backup tooling.  It
# records only a fixed-file AST/hash inventory because the runtime preflight can
# query credential metadata, which is outside this Goal's authorization.
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$reportRoot = Join-Path $repoRoot ('.ai-team\reports\' + $RunId)
$reportPath = Join-Path $reportRoot 'final-runner-summary.sanitized.json'

$allowlist = @(
    'ops/backup/Invoke-CelebrateDealProductionBackup.ps1',
    'ops/backup/Resume-CelebrateDealGoogleDriveBackupUpload.ps1',
    'ops/backup/New-CelebrateDealAgeIdentity.ps1',
    'ops/backup/Register-CelebrateDealAgeIdentityPath.ps1',
    'ops/backup/Test-CelebrateDealRestoreEvidence.ps1',
    'ops/backup/Test-CelebrateDealBackupPreflight.ps1',
    'ops/backup/Invoke-CelebrateDealRestoreDrill.ps1',
    'ops/backup/CelebrateDeal.Backup.Common.psm1',
    'ops/backup/tests/Test-BackupTooling.ps1'
)

$restrictedCommands = @(
    'age', 'age-keygen', 'pg_dump', 'pg_restore', 'psql', 'Invoke-Sqlcmd',
    'Get-SecretInfo', 'Get-StoredCredential', 'Register-ScheduledTask', 'schtasks',
    'rclone', 'mount', 'New-PSDrive', 'Invoke-WebRequest', 'Invoke-RestMethod'
)
$requiredCallPathSymbols = @(
    'Test-CelebrateDealBackupPreflight', 'Test-CelebrateDealSecretName',
    'Get-SecretInfo', 'Get-StoredCredential', 'Test-CelebrateDealIsolationTarget'
)

function Get-StaticCommandInventory {
    param([System.Management.Automation.Language.Ast]$Ast, [string]$RelativePath, [int]$GateOffset)

    $items = @()
    $commands = $Ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)
    foreach ($command in $commands) {
        $first = $command.CommandElements | Select-Object -First 1
        $name = if ($first -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
            $first.Value
        } else {
            '<dynamic>'
        }
        if ($name -eq '<dynamic>' -or $restrictedCommands -contains $name) {
            $items += [ordered]@{
                path = $RelativePath
                line = $command.Extent.StartLineNumber
                command = $name
                classification = if ($name -eq '<dynamic>') { 'DYNAMIC_COMMAND_RISK' } elseif ($GateOffset -ge 0 -and $command.Extent.StartOffset -gt $GateOffset) { 'AFTER_DEFAULT_EXECUTE_EXIT' } else { 'OUTSIDE_DEFAULT_EXECUTE_EXIT_OR_SHARED_HELPER' }
            }
        }
    }
    return @($items)
}

function Get-SymbolLocations {
    param([string]$Text, [string]$RelativePath, [string]$Symbol)

    $locations = @()
    foreach ($match in [regex]::Matches($Text, [regex]::Escape($Symbol))) {
        $line = ($Text.Substring(0, $match.Index) -split "`n").Count
        $locations += [ordered]@{ path = $RelativePath; symbol = $Symbol; line = $line }
    }
    return @($locations)
}

if (Test-Path -LiteralPath $reportRoot) {
    throw "WP-49 report directory already exists: $reportRoot"
}
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null

try {
    $files = @()
    $restrictedInventory = @()
    $callPaths = @()

    foreach ($relativePath in $allowlist) {
        $fullPath = Join-Path $repoRoot $relativePath
        $resolved = (Resolve-Path -LiteralPath $fullPath -ErrorAction Stop).Path
        if (-not $resolved.StartsWith((Join-Path $repoRoot 'ops\backup'), [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Allowlist path escapes ops/backup: $relativePath"
        }

        $tokens = $null
        $parseErrors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($resolved, [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors.Count -ne 0) {
            throw "AST parse error in ${relativePath}: $($parseErrors[0].Message)"
        }

        $text = [System.IO.File]::ReadAllText($resolved)
        $hasExecuteParameter = $text -match '(?m)\[switch\]\s*\$Execute\b'
        $gateMatch = [regex]::Match($text, '(?m)^\s*if\s*\(\s*-not\s+\$Execute\s*\)')
        $gateOffset = if ($gateMatch.Success) { $gateMatch.Index } else { -1 }
        if ($hasExecuteParameter -and -not $gateMatch.Success) {
            throw "Execute parameter lacks a default-off gate: $relativePath"
        }

        $hashBefore = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
        $restrictedInventory += Get-StaticCommandInventory -Ast $ast -RelativePath $relativePath -GateOffset $gateOffset
        foreach ($symbol in $requiredCallPathSymbols) {
            $callPaths += Get-SymbolLocations -Text $text -RelativePath $relativePath -Symbol $symbol
        }
        $hashAfter = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
        if ($hashBefore -ne $hashAfter) { throw "Target hash changed during static read: $relativePath" }

        $files += [ordered]@{
            path = $relativePath
            sha256 = $hashBefore
            astParseErrors = 0
            executeParameter = [bool]$hasExecuteParameter
            defaultOffExecuteGate = [bool]$gateMatch.Success
        }
    }

    # Dynamic command expressions are recorded as execution risks, rather than
    # executed or resolved.  Their presence is why this evidence remains static-only.
    $dynamicRisks = @($restrictedInventory | Where-Object { $_.classification -eq 'DYNAMIC_COMMAND_RISK' })
    if (@($callPaths | Where-Object { $_.symbol -eq 'Test-CelebrateDealSecretName' }).Count -eq 0) {
        throw 'Expected secret-metadata call path was not found.'
    }

    $summary = [ordered]@{
        workPackage = 'WP-49 Backup Plan-Only Static Contract Reconciliation'
        runId = $RunId
        evidenceClassification = [ordered]@{
            TOOLING_PLAN_ONLY_STATIC_ONLY = 'PASS'
            STATIC_EXECUTE_GATE_INVENTORY = 'COMPLETE'
            SECRET_METADATA_ACCESS_PATH_PRESENT = 'CONFIRMED'
            PLAN_ONLY_RUNTIME_SAFETY = 'NOT_EXECUTED_POLICY_BLOCKED'
            TEST_BACKUP_TOOLING = 'NOT_EXECUTED_POLICY_BLOCKED'
            REAL_BACKUP_ARCHIVE = 'NOT_EXECUTED'
            RESTORE_REHEARSAL = 'NOT_EXECUTED'
            FORWARD_RECOVERY = 'NOT_EXECUTED'
            G2_STATUS = 'WAITING_AUTHORIZATION'
        }
        executionLedger = [ordered]@{
            HARNESS_EXECUTED = 'NO'
            BACKUP_SCRIPT_EXECUTED = 'NO'
            MODULE_IMPORTED = 'NO'
            TARGET_DOT_SOURCED = 'NO'
            CHILD_PROCESS_STARTED = 'NO'
            ENV_FILE_ACCESSED = 'NO'
            CREDENTIAL_METADATA_QUERIED = 'NO'
            DATABASE_CONNECTED = 'NO'
            ARCHIVE_CREATED = 'NO'
            NETWORK_REQUESTED = 'NO'
            MOUNT_OR_SCHEDULER_CHANGED = 'NO'
        }
        allowlist = $files
        restrictedCommandInventory = @($restrictedInventory)
        dynamicExecutionRisks = @($dynamicRisks)
        secretMetadataCallPaths = @($callPaths)
        policyNote = 'Static evidence only. Target scripts and test harness were intentionally not executed because their preflight may query credential metadata.'
    }
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    Write-Output $reportPath
}
catch {
    if (Test-Path -LiteralPath $reportRoot) { Remove-Item -LiteralPath $reportRoot -Recurse -Force }
    throw
}
