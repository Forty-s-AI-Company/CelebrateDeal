[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('ai-team-routing-' + [guid]::NewGuid().ToString('N'))
$fixtureTeam = Join-Path $fixture '.ai-team'
$fixtureScripts = Join-Path $fixtureTeam 'scripts'
$pwsh = (Get-Command pwsh).Source
function Assert-Route([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION_FAILED: $Message" }
}
try {
    # Only bounded runtime files are copied. No repository context, credentials or active state.
    New-Item -ItemType Directory -Path $fixtureScripts -Force > $null
    foreach ($dir in @('config','mcp_server','prompts')) {
        New-Item -ItemType Directory -Path (Join-Path $fixtureTeam $dir) > $null
    }
    Get-ChildItem (Join-Path $repoRoot '.ai-team/config') -Filter '*.json' | Copy-Item -Destination (Join-Path $fixtureTeam 'config')
    foreach ($file in @('routing.py','route_cli.py')) { Copy-Item -LiteralPath (Join-Path $repoRoot ".ai-team/mcp_server/$file") -Destination (Join-Path $fixtureTeam 'mcp_server') }
    Copy-Item -LiteralPath (Join-Path $repoRoot '.ai-team/prompts/reviewer-prompt.md') -Destination (Join-Path $fixtureTeam 'prompts')
    foreach ($file in @('Invoke-AiTeamProcess.ps1','Invoke-AiTeamTask.ps1','Invoke-AgyFast.ps1','Invoke-AgyDeep.ps1','Invoke-AgyPlanReview.ps1','Invoke-AiTeamReadOnlyFailover.ps1','Switch-AiTeamMode.ps1')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $fixtureScripts
    }
    # Mock only AGY in this disposable copy; local Python adapter and all wrappers run for real.
    $mock = @'
$script:RealAiTeamProcess = ${function:Invoke-AiTeamProcess}
function Get-Command {
    [CmdletBinding()]param([string]$Name)
    $scenario = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'scenario.txt')) { Get-Content -LiteralPath (Join-Path $PSScriptRoot 'scenario.txt') -Raw } else { '' }
    if ($Name -eq 'agy' -and $scenario -eq 'no-installed') { return $null }
    if ($Name -eq 'agy') { return [pscustomobject]@{Source='synthetic-agy'} }
    Microsoft.PowerShell.Core\Get-Command @PSBoundParameters
}
function Invoke-AiTeamProcess {
    param([string]$FilePath, [string[]]$ArgumentList, [string]$StandardInputText,
        [string]$Profile, [string]$Model, [string]$ReasoningEffort,
        [int]$FirstOutputTimeoutSeconds, [int]$IdleTimeoutSeconds, [int]$HardTimeoutSeconds,
        [int]$GracefulShutdownSeconds, [int]$MaxOutputChars, [int]$MaxOutputLines, [switch]$MarkAsChild)
    if ($FilePath -ne 'synthetic-agy') { return (& $script:RealAiTeamProcess @PSBoundParameters) }
    $scenario = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'scenario.txt') -Raw
    if ($ArgumentList[0] -eq 'models') {
        if ($scenario -eq 'no-agy') { return [pscustomobject]@{status='AUTH_REQUIRED';stdout='';stdoutTruncated=$false} }
        if ($scenario -eq 'host-permission') { return [pscustomobject]@{status='HOST_PERMISSION_BLOCKED';stdout='';stdoutTruncated=$false} }
        if ($scenario -eq 'discovery-first-output-timeout') { return [pscustomobject]@{status='FIRST_OUTPUT_TIMEOUT';stdout='';stdoutTruncated=$false} }
        if ($scenario -eq 'discovery-idle-timeout') { return [pscustomobject]@{status='IDLE_TIMEOUT';stdout='';stdoutTruncated=$false} }
        return [pscustomobject]@{status='SUCCESS';stdout='gemini-3.8-flash-medium gemini-3.8-flash-high claude-sonnet-4-6 claude-opus-4-6-thinking';stdoutTruncated=$false}
    }
    if (-not $MarkAsChild -or '--sandbox' -notin $ArgumentList -or '--mode' -notin $ArgumentList -or 'plan' -notin $ArgumentList) { throw 'missing safety arguments' }
    if ('--dangerously-skip-permissions' -in $ArgumentList) { throw 'permission bypass' }
    $promptIndex = [Array]::IndexOf($ArgumentList, '--print') + 1
    if ($promptIndex -le 0 -or $ArgumentList[$promptIndex] -notmatch 'AI Team vNext Reviewer Runtime Prompt') { throw 'canonical reviewer prompt was not loaded' }
    Add-Content -LiteralPath (Join-Path $PSScriptRoot 'attempts.txt') -Value $Model
    $status='SUCCESS'; $output='{"summary":"No candidate defect in supplied scope","findings":[]}'; $exitCode=0
    if ($scenario -eq 'cli-failure') { $status='PROCESS_CRASHED'; $output=''; $exitCode=1 }
    if ($scenario -eq 'invalid-output') { $output='PASS: looks good' }
    if ($scenario -eq 'major-finding') { $output='{"summary":"Found a race","findings":[{"severity":"MAJOR","file":"demo.ts","area":"12","issue":"race","evidence":"parallel reproduction","impact":"lost update","recommended_fix":"lock","required_test":"concurrent writers","confidence":0.9}]}' }
    return [pscustomobject]@{status=$status;stdout=$output;stdoutTruncated=$false;exitCode=$exitCode}
}
'@
    Add-Content -LiteralPath (Join-Path $fixtureScripts 'Invoke-AiTeamProcess.ps1') -Value $mock
    function Run-Wrapper([string]$Scenario, [string]$Wrapper, [string]$Prompt, [string[]]$Extra=@()) {
        [IO.File]::WriteAllText((Join-Path $fixtureScripts 'scenario.txt'), $Scenario)
        $output = & $pwsh -NoProfile -File (Join-Path $fixtureScripts $Wrapper) -Prompt $Prompt @Extra | Out-String
        return ($output | ConvertFrom-Json)
    }
    $normal = Run-Wrapper 'normal' 'Invoke-AgyFast.ps1' 'ordinary large diff review'
    Assert-Route ($normal.status -eq 'REVIEW_COMPLETED' -and $normal.finalModel -eq 'gemini-3.8-flash-high') 'Gemini broad review did not execute'
    Assert-Route (-not $normal.accepted -and $normal.route.candidate_findings_only) 'Gemini incorrectly became final arbiter'
    Assert-Route ('MaxAttempts' -in $normal.deprecated_parameters -and 'AutoApprovePermissions' -in $normal.ignored_parameters -and $normal.ignore_reason) 'legacy ignored parameter metadata missing'
    $deep = Run-Wrapper 'normal' 'Invoke-AgyDeep.ps1' 'complex business logic review'
    Assert-Route ($deep.finalModel -eq 'claude-sonnet-4-6') 'actual discovered Sonnet slug was not used'
    $critical = Run-Wrapper 'normal' 'Invoke-AgyPlanReview.ps1' 'one line payment webhook review'
    Assert-Route ($critical.finalModel -eq 'claude-opus-4-6-thinking') 'critical review did not jump directly to Opus'
    $major = Run-Wrapper 'major-finding' 'Invoke-AgyFast.ps1' 'ordinary large diff review'
    Assert-Route (-not $major.accepted -and $major.review.findings[0].severity -eq 'MAJOR') 'finding was incorrectly accepted as PASS'
    foreach ($scenario in @('cli-failure','invalid-output','no-agy','host-permission','no-installed','discovery-first-output-timeout','discovery-idle-timeout')) {
        $fallback = Run-Wrapper $scenario 'Invoke-AgyDeep.ps1' 'complex business logic review'
        Assert-Route ($fallback.status -eq 'FALLBACK_HANDOFF_REQUIRED' -and $fallback.finalModel -eq 'gpt-6-sol') "Sonnet fallback failed: $scenario"
        Assert-Route (-not $fallback.reviewed -and -not $fallback.completed) 'handoff falsely marked completed'
        Assert-Route (@($fallback.attempts).Count -le 1) 'failed model was retried'
        if ($scenario -eq 'host-permission') { Assert-Route ($fallback.agy_discovery_status -eq 'HOST_PERMISSION_BLOCKED') 'Host permission failure was not preserved in the receipt' }
        if ($scenario -eq 'no-installed') { Assert-Route ($fallback.agy_discovery_status -eq 'AGY_NOT_INSTALLED') 'Missing agy executable was not classified as AGY_NOT_INSTALLED' }
        if ($scenario -eq 'discovery-first-output-timeout') { Assert-Route ($fallback.agy_discovery_process_status -eq 'FIRST_OUTPUT_TIMEOUT') 'Discovery timeout was hidden by the fallback classification' }
        if ($scenario -eq 'discovery-idle-timeout') { Assert-Route ($fallback.agy_discovery_process_status -eq 'IDLE_TIMEOUT') 'Discovery idle timeout was hidden by the fallback classification' }
    }
    $legacy = Run-Wrapper 'no-agy' 'Invoke-AiTeamReadOnlyFailover.ps1' 'ordinary large diff review'
    Assert-Route ($legacy.finalModel -eq 'gpt-6-sol') 'legacy failover entry did not use shared route'
    $sensitive = Run-Wrapper 'normal' 'Invoke-AgyFast.ps1' 'token: synthetic-do-not-send'
    Assert-Route ($sensitive.status -eq 'BLOCKED_SENSITIVE_INPUT') 'sensitive prompt was dispatched'
    $priorChild = $env:AI_TEAM_CHILD
    try {
        $env:AI_TEAM_CHILD='1'
        $child = Run-Wrapper 'normal' 'Invoke-AgyFast.ps1' 'safe task'
        Assert-Route ($child.status -eq 'BLOCKED_RECURSION') 'child wrapper recursively routed'
    } finally { $env:AI_TEAM_CHILD=$priorChild }

    $signalRunner = @'
param([ValidateSet('signals','explicit','critical-override','routine-override','task-floor','risk-floor','legacy','invalid')][string]$Case)
$task = Join-Path $PSScriptRoot 'Invoke-AiTeamTask.ps1'
if ($Case -eq 'signals') {
    & $task -Prompt 'bounded security review' -TaskSignals @{task_type='security_review'; complexity='low'} -PlanOnly
} elseif ($Case -eq 'explicit') {
    & $task -Prompt 'bounded task' -TaskType implement -Difficulty trivial -TaskSignals @{task_type='security_review'; difficulty='critical'} -PlanOnly
} elseif ($Case -eq 'critical-override') {
    & $task -Prompt 'bounded task' -TaskType implement -Difficulty critical -TaskSignals @{complexity='low'} -PlanOnly
} elseif ($Case -eq 'routine-override') {
    & $task -Prompt 'bounded task' -TaskType implement -Difficulty routine -TaskSignals @{complexity='high'} -PlanOnly
} elseif ($Case -eq 'task-floor') {
    & $task -Prompt 'bounded task' -TaskType cross_module -Difficulty trivial -TaskSignals @{complexity='low'} -PlanOnly
} elseif ($Case -eq 'risk-floor') {
    & $task -Prompt 'bounded task' -TaskType implement -Difficulty trivial -TaskSignals @{complexity='low'; risk='critical'} -PlanOnly
} elseif ($Case -eq 'legacy') {
    & $task -Prompt 'bounded task' -TaskType implement -Difficulty complex -PlanOnly
} else {
    & $task -Prompt 'bounded task' -TaskSignals @{difficulty='nonsense'} -PlanOnly
}
exit $LASTEXITCODE
'@
    [IO.File]::WriteAllText((Join-Path $fixtureScripts 'Invoke-SignalCase.ps1'), $signalRunner)
    function Run-SignalCase([string]$Case) {
        [IO.File]::WriteAllText((Join-Path $fixtureScripts 'scenario.txt'), 'normal')
        $output = & $pwsh -NoProfile -File (Join-Path $fixtureScripts 'Invoke-SignalCase.ps1') -Case $Case | Out-String
        return @{receipt=($output | ConvertFrom-Json); exitCode=$LASTEXITCODE}
    }
    $signalsOnly = Run-SignalCase 'signals'
    Assert-Route ($signalsOnly.exitCode -eq 0 -and $signalsOnly.receipt.route.signals.task_type -eq 'security_review' -and $signalsOnly.receipt.route.signals.risk -eq 'critical') 'structured security_review was overwritten by defaults'
    $explicit = Run-SignalCase 'explicit'
    Assert-Route ($explicit.exitCode -eq 0 -and $explicit.receipt.route.signals.task_type -eq 'implement' -and $explicit.receipt.route.model_key -eq 'luna') 'explicit PowerShell override did not win'
    $criticalOverride = Run-SignalCase 'critical-override'
    Assert-Route ($criticalOverride.exitCode -eq 0 -and $criticalOverride.receipt.route.signals.complexity -eq 'very_high' -and $criticalOverride.receipt.route.model_key -ne 'luna') 'explicit critical difficulty was downgraded by structured complexity'
    $routineOverride = Run-SignalCase 'routine-override'
    Assert-Route ($routineOverride.exitCode -eq 0 -and $routineOverride.receipt.route.signals.complexity -eq 'medium' -and $routineOverride.receipt.route.model_key -eq 'luna') 'explicit routine difficulty did not override structured high complexity'
    $taskFloor = Run-SignalCase 'task-floor'
    Assert-Route ($taskFloor.exitCode -eq 0 -and $taskFloor.receipt.route.signals.complexity -eq 'high' -and $taskFloor.receipt.route.model_key -eq 'sol') 'task type floor did not raise explicit low difficulty'
    $riskFloor = Run-SignalCase 'risk-floor'
    Assert-Route ($riskFloor.exitCode -eq 0 -and $riskFloor.receipt.route.signals.complexity -eq 'low' -and $riskFloor.receipt.route.signals.risk -eq 'critical' -and $riskFloor.receipt.route.review_plan[0].role -eq 'critical_review' -and $riskFloor.receipt.route.review_plan[0].required) 'critical risk did not retain its independent review requirement'
    $legacyDifficulty = Run-SignalCase 'legacy'
    Assert-Route ($legacyDifficulty.exitCode -eq 0 -and $legacyDifficulty.receipt.route.signals.complexity -eq 'high' -and $legacyDifficulty.receipt.route.model_key -eq 'sol') 'valid legacy difficulty mapping failed'
    $invalidDifficulty = Run-SignalCase 'invalid'
    Assert-Route ($invalidDifficulty.exitCode -eq 2 -and $invalidDifficulty.receipt.status -eq 'INVALID_INPUT') 'invalid difficulty was silently accepted'
    # Switching all compatibility aliases only mutates the fixture selector.
    foreach ($mode in @('ai-team-lite','ai-team','ai-team-pro','ai-team-style')) {
        & $pwsh -NoProfile -File (Join-Path $fixtureScripts 'Switch-AiTeamMode.ps1') $mode > $null
        Assert-Route ($LASTEXITCODE -eq 0) "switch failed: $mode"
        $cfg=Get-Content -LiteralPath (Join-Path $fixtureTeam 'config/router.json') -Raw | ConvertFrom-Json
        Assert-Route ($cfg.active_mode_id -eq $mode) 'wrong mode persisted'
        $simple = Run-Wrapper 'normal' 'Invoke-AiTeamTask.ps1' '修改文案' @('-TaskType','copy','-PlanOnly')
        Assert-Route ($simple.route.model -eq 'gpt-6-luna') 'team tier forced an expensive model'
    }
    Write-Output 'AI_TEAM_ROUTING_INTEGRATION=PASS'
} finally {
    # Resolve and check the precise disposable directory before recursive cleanup.
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'ai-team-routing-*') { throw 'Invalid cleanup target' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
exit 0
