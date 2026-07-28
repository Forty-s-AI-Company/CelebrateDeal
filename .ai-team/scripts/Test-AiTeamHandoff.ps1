[CmdletBinding()]
param(
    # CI may pass the project root explicitly; the fallback is resolved after script scope initializes.
    [string]$Root = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This script is read-only: it never reads .env*, runs product tests, or writes files.
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}
$rootPath = [System.IO.Path]::GetFullPath($Root)
$failures = [System.Collections.Generic.List[string]]::new()

function Add-Failure {
    param([string]$Message)
    $script:failures.Add($Message)
}

function Get-ProjectFile {
    param([string]$RelativePath)
    return (Join-Path $rootPath $RelativePath)
}

$canonicalFiles = @(
    'docs/ai-team/workflow-policy.md',
    'docs/ai-team/handoff-schema.md',
    'docs/ai-team/prompts/planner-prompt.md',
    'docs/ai-team/prompts/executor-prompt.md',
    'docs/ai-team/README.md'
)

foreach ($relativePath in $canonicalFiles) {
    $path = Get-ProjectFile $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Add-Failure "Missing canonical file: $relativePath"
        continue
    }

    $content = [System.IO.File]::ReadAllText($path)
    if ([string]::IsNullOrWhiteSpace($content) -or $content -notmatch '(?m)^#\s+') {
        Add-Failure "Markdown format check failed (missing H1): $relativePath"
    }
}

$requiredHandoffFields = @(
    'CURRENT_TASK_RENAME:', 'CURRENT_TASK_STATUS:', 'NEXT_TASK_REQUIRED:',
    'NEXT_TASK_TITLE:', 'NEXT_ROLE:', 'NEXT_MODEL:', 'NEXT_ACTION:',
    'NEXT_REASON:', 'COPY_TO_NEW_TASK:', 'NEXT_PROMPT_BEGIN', 'NEXT_PROMPT_END'
)
$handoffPath = Get-ProjectFile 'docs/ai-team/handoff-schema.md'
if (Test-Path -LiteralPath $handoffPath -PathType Leaf) {
    $handoff = [System.IO.File]::ReadAllText($handoffPath)
    foreach ($field in $requiredHandoffFields) {
        if (-not $handoff.Contains($field)) {
            Add-Failure "Handoff schema is missing required field: $field"
        }
    }
}

$plannerPath = Get-ProjectFile 'docs/ai-team/prompts/planner-prompt.md'
$executorPath = Get-ProjectFile 'docs/ai-team/prompts/executor-prompt.md'
if (Test-Path -LiteralPath $plannerPath -PathType Leaf) {
    $planner = [System.IO.File]::ReadAllText($plannerPath)
    foreach ($requiredText in @('workflow-policy.md', 'handoff-schema.md', 'AI_TEAM_HANDOFF', 'READY_FOR_TERRA')) {
        if (-not $planner.Contains($requiredText)) {
            Add-Failure "Planner template is missing required reference or gate: $requiredText"
        }
    }
    if ($planner -match '(?im)^.*(?:npm|vitest|playwright|prisma).*$') {
        Add-Failure 'Planner template must not include product implementation or test commands'
    }
}

if (Test-Path -LiteralPath $executorPath -PathType Leaf) {
    $executor = [System.IO.File]::ReadAllText($executorPath)
    foreach ($requiredText in @('workflow-policy.md', 'handoff-schema.md', 'current-work-package.md', 'AI_TEAM_HANDOFF')) {
        if (-not $executor.Contains($requiredText)) {
            Add-Failure "Executor template is missing required reference or handoff: $requiredText"
        }
    }
    if ($executor -match 'PLAN_(?:NEXT_WP|REMEDIATION|PROBE)') {
        Add-Failure 'Executor template includes a next-WP planning action'
    }
    if ($executor -notmatch 'Commit authorization') {
        Add-Failure 'Executor template does not explicitly require commit authorization'
    }
}

$policyPath = Get-ProjectFile 'docs/ai-team/workflow-policy.md'
if (Test-Path -LiteralPath $policyPath -PathType Leaf) {
    $policy = [System.IO.File]::ReadAllText($policyPath)
    foreach ($requiredDecision in @('NEXT_TASK_REQUIRED', 'PLAN_REMEDIATION', 'CONTINUE_CURRENT_WP', 'USER_AUTHORIZATION_REQUIRED', 'MIXED_HUNKS')) {
        if (-not $policy.Contains($requiredDecision)) {
            Add-Failure "Workflow policy is missing task-boundary decision: $requiredDecision"
        }
    }
}

# README relative Markdown links must resolve; only this canonical index is inspected.
$readmePath = Get-ProjectFile 'docs/ai-team/README.md'
if (Test-Path -LiteralPath $readmePath -PathType Leaf) {
    $readme = [System.IO.File]::ReadAllText($readmePath)
    foreach ($match in [regex]::Matches($readme, '\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\)')) {
        $target = $match.Groups[1].Value
        if ($target -notmatch '^(https?:|mailto:)') {
            $targetPath = Join-Path (Split-Path -Parent $readmePath) $target
            if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
                Add-Failure "README internal reference does not exist: $target"
            }
        }
    }
}

# Deprecated tooling must not be presented as active canonical; explicit historical negation is allowed.
$policySources = $canonicalFiles + @('AGENTS.md')
$deprecatedTerms = '(?:Codex CLI|Ollama|heavy MCP orchestration)'
$activeCanonicalTerms = '(?i)(canonical|active|current workflow)'
$negationTerms = '(?i)(deprecated|not|no longer)'
foreach ($relativePath in $policySources) {
    $path = Get-ProjectFile $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $lineNumber = 0
    foreach ($line in [System.IO.File]::ReadLines($path)) {
        $lineNumber++
        if ($line -match $deprecatedTerms -and $line -match $activeCanonicalTerms -and $line -notmatch $negationTerms) {
            Add-Failure "Deprecated tooling is presented as active canonical: ${relativePath}:$lineNumber"
        }
        if ($line -match '(?i)(automatically created|automatically renamed).*Codex Desktop Task') {
            Add-Failure "Found an inaccurate Codex Desktop Task automation claim: ${relativePath}:$lineNumber"
        }
    }
}

# Scan only the workflow files in this change set. Findings identify a category and file,
# never print source text. This deliberately avoids repository-wide .env* access.
$secretDetectors = @(
    @{ Name = 'private_key'; Pattern = '-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----' },
    @{ Name = 'age_identity'; Pattern = '\bAGE-SECRET-KEY-[A-Z0-9]+\b' },
    @{ Name = 'github_token'; Pattern = '\bgh[pousr]_[A-Za-z0-9]{30,}\b' },
    @{ Name = 'slack_token'; Pattern = '\bxox[baprs]-[A-Za-z0-9-]{20,}\b' },
    @{ Name = 'aws_access_key'; Pattern = '\bAKIA[0-9A-Z]{16}\b' },
    @{ Name = 'live_payment_key'; Pattern = '\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b' }
)
$secretScanFiles = $canonicalFiles + @('AGENTS.md', '.ai-team/scripts/Test-AiTeamHandoff.ps1')
foreach ($relativePath in $secretScanFiles) {
    $path = Get-ProjectFile $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $content = [System.IO.File]::ReadAllText($path)
    foreach ($detector in $secretDetectors) {
        if ($content -match $detector.Pattern) {
            Add-Failure "Scoped secret scan found $($detector.Name) in: $relativePath"
        }
    }
}

if ($failures.Count -gt 0) {
    Write-Error ("AI Team handoff validation failed:`n- " + ($failures -join "`n- "))
    exit 1
}

Write-Host 'AI Team handoff validation passed (read-only; no .env* read and no product tests run).'
exit 0
