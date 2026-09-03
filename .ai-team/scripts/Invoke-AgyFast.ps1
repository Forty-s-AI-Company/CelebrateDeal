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
    [ValidateRange(1, 2)]
    [int]$MaxAttempts = 2,
    [ValidateRange(500, 120000)]
    [int]$MaxOutputChars = 6000,
    [bool]$AutoApprovePermissions = $true
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Invoke-AiTeamProcess.ps1')

$model = 'gemini-3.8-flash-high'
$effort = 'high'
$profile = 'gemini_fast'

function Write-AiTeamFastResult {
    param([Parameter(Mandatory)][pscustomobject]$Result)

    $payload = [ordered]@{}
    foreach ($property in $Result.PSObject.Properties) {
        $payload[$property.Name] = $property.Value
    }
    $payload['normalized_status'] = $Result.status
    $payload['status'] = if ($Result.status -eq 'SUCCESS') { 'OK' } else { $Result.status }
    $payload['execution_mode'] = 'plan'
    $payload['sandbox'] = $true
    $payload['auto_approve_permissions'] = $AutoApprovePermissions
    $payload | ConvertTo-Json -Depth 8
}

if ($Prompt -match '(?i)(api[_ -]?key|token|secret|password|private[_ -]?key|authorization)\s*[:=]') {
    [ordered]@{
        status = 'BLOCKED_SENSITIVE_INPUT'
        normalized_status = 'BLOCKED_SENSITIVE_INPUT'
        profile = $profile
        model = $model
        reasoningEffort = $effort
        attempts = 0
    } | ConvertTo-Json -Depth 8
    exit 2
}

$agy = Get-Command agy -ErrorAction SilentlyContinue
if ($null -eq $agy) {
    [ordered]@{
        status = 'TOOL_BLOCKED'
        normalized_status = 'TOOL_BLOCKED'
        profile = $profile
        model = $model
        reasoningEffort = $effort
        attempts = 0
        reason = 'agy command not found'
    } | ConvertTo-Json -Depth 8
    exit 1
}

$retryableStatuses = @(
    'NETWORK_TRANSIENT', 'RATE_LIMITED', 'FIRST_OUTPUT_TIMEOUT',
    'IDLE_TIMEOUT', 'HARD_TIMEOUT', 'NO_STDOUT', 'PROCESS_CRASHED', 'PROCESS_START_TIMEOUT'
)
$last = $null
for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $arguments = @(
        '--print', $Prompt,
        '--model', $model,
        '--effort', $effort,
        '--mode', 'plan',
        '--sandbox',
        '--print-timeout', "${TimeoutSeconds}s"
    )
    if ($AutoApprovePermissions) { $arguments += '--dangerously-skip-permissions' }

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
    $last | Add-Member -NotePropertyName attempt -NotePropertyValue $attempt -Force
    $last | Add-Member -NotePropertyName attempts -NotePropertyValue $attempt -Force

    if ($last.status -eq 'SUCCESS') { break }
    if ($last.status -notin $retryableStatuses) { break }
}

Write-AiTeamFastResult -Result $last
if ($last.status -eq 'SUCCESS') { exit 0 }
exit 1
