[CmdletBinding()]
param(
    [Parameter(Mandatory, Position=0)][string]$Prompt,
    [int]$TimeoutSeconds=300, [int]$FirstOutputTimeoutSeconds=120,
    [int]$IdleTimeoutSeconds=90, [int]$HardTimeoutSeconds=600,
    [int]$GracefulShutdownSeconds=10, [ValidateRange(1,2)][int]$MaxAttempts=1,
    [ValidateRange(1,2)][int]$MaxTotalAttempts=2,
    [int]$MaxOutputChars=12000,
    [string]$ConfigPath=(Join-Path $PSScriptRoot '../config/router.json'),
    [string]$Difficulty='auto',
    [hashtable]$TaskSignals=@{}, [hashtable]$Runtime=@{}, [string]$Team='', [switch]$PlanOnly
)
# Compatibility only. Shared router owns selection, bounded fallback and read-only execution.
$forward = @{} + $PSBoundParameters
$forward.Remove('MaxAttempts')
$forward.Remove('AutoApprovePermissions')
$forward.Remove('Role')
$forward['DeprecatedParameters'] = @('MaxAttempts')
$forward['IgnoreReason'] = 'vNext enforces one attempt per model; MaxAttempts is retained only for invocation compatibility.'
$forward['TaskType'] = 'deep_review'
& (Join-Path $PSScriptRoot 'Invoke-AiTeamTask.ps1') @forward
exit $LASTEXITCODE
