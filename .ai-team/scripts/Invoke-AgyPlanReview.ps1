[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$Prompt,
    [ValidateRange(5, 600)]
    [int]$TimeoutSeconds = 300,
    [ValidateRange(5, 600)]
    [int]$FirstOutputTimeoutSeconds = 120,
    [ValidateRange(5, 600)]
    [int]$IdleTimeoutSeconds = 90,
    [ValidateRange(10, 900)]
    [int]$HardTimeoutSeconds = 600,
    [ValidateRange(1, 60)]
    [int]$GracefulShutdownSeconds = 10,
    [ValidateRange(1, 1)]
    [int]$MaxAttempts = 1,
    [ValidateRange(500, 120000)]
    [int]$MaxOutputChars = 12000
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Invoke-AiTeamProcess.ps1')

$model = 'claude-sonnet-4-6'
$effort = 'model-default'
$profile = 'claude_plan_review'

function Write-AiTeamPlanReviewResult {
    param(
        [Parameter(Mandatory)]
        [hashtable]$Result
    )

    $Result | ConvertTo-Json -Depth 10
}

function Get-AiTeamPlanReviewStatus {
    param(
        [Parameter(Mandatory)]
        [pscustomobject]$Result
    )

    $combined = "$($Result.stdout)`n$($Result.stderr)"
    if ($Result.status -eq 'AUTH_REQUIRED') { return 'LOGIN_REQUIRED' }
    if ($Result.status -eq 'RATE_LIMITED' -or $combined -match '(?i)(quota|resource exhausted|capacity exhausted|usage limit)') {
        return 'NOT_REQUESTED_QUOTA'
    }
    if ($Result.status -eq 'SUCCESS') { return 'PASS' }
    return $Result.status
}

if ($Prompt -match '(?i)(api[_ -]?key|token|secret|password|private[_ -]?key|authorization)\s*[:=]') {
    Write-AiTeamPlanReviewResult ([ordered]@{
        status = 'BLOCKED_SENSITIVE_INPUT'
        normalized_status = 'BLOCKED_SENSITIVE_INPUT'
        profile = $profile
        model = $model
        reasoningEffort = $effort
        attempts = 0
        reviewed = $false
        advisoryOnly = $true
        quotaPolicy = 'skip_if_unavailable'
        availability = 'runtime_dependent'
        externalSideEffects = $false
    })
    exit 2
}

$agy = Get-Command agy -ErrorAction SilentlyContinue
if ($null -eq $agy) {
    Write-AiTeamPlanReviewResult ([ordered]@{
        status = 'TOOL_BLOCKED'
        normalized_status = 'TOOL_BLOCKED'
        profile = $profile
        model = $model
        reasoningEffort = $effort
        attempts = 0
        reviewed = $false
        advisoryOnly = $true
        quotaPolicy = 'skip_if_unavailable'
        availability = 'runtime_dependent'
        externalSideEffects = $false
        reason = 'agy command not found'
    })
    exit 1
}

$arguments = @(
    '--print', $Prompt,
    '--model', $model,
    # This AGY Claude model uses its own thinking default; an explicit effort
    # override is not portable across AGY model adapters.
    '--mode', 'plan',
    '--sandbox',
    '--print-timeout', "${TimeoutSeconds}s"
)

$last = Invoke-AiTeamProcess `
    -FilePath $agy.Source `
    -ArgumentList $arguments `
    -Profile $profile `
    -Model $model `
    -ReasoningEffort $effort `
    -FirstOutputTimeoutSeconds $FirstOutputTimeoutSeconds `
    -IdleTimeoutSeconds $IdleTimeoutSeconds `
    -HardTimeoutSeconds $HardTimeoutSeconds `
    -GracefulShutdownSeconds $GracefulShutdownSeconds `
    -MaxOutputChars $MaxOutputChars

$normalizedStatus = Get-AiTeamPlanReviewStatus -Result $last
$isPass = $normalizedStatus -eq 'PASS'

# 失敗或額度不足時不保存 provider 原始輸出，避免把不必要的診斷內容帶入 evidence。
Write-AiTeamPlanReviewResult ([ordered]@{
    status = $normalizedStatus
    normalized_status = $normalizedStatus
    profile = $profile
    model = $model
    reasoningEffort = $effort
    attempts = 1
    reviewed = $isPass
    advisoryOnly = $true
    quotaPolicy = 'skip_if_unavailable'
    availability = 'runtime_dependent'
    externalSideEffects = $false
    output = if ($isPass) { $last.stdout } else { '' }
    outputTruncated = if ($isPass) { $last.stdoutTruncated } else { $false }
    processStatus = $last.status
    exitCode = $last.exitCode
})

if ($isPass) { exit 0 }
if ($normalizedStatus -eq 'NOT_REQUESTED_QUOTA') { exit 0 }
exit 1
