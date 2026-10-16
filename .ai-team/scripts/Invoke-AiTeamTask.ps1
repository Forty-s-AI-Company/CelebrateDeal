[CmdletBinding()]
param(
    [Parameter(Mandatory, Position=0)][ValidateNotNullOrEmpty()][string]$Prompt,
    [string]$TaskType = 'review',
    [string]$Difficulty = 'auto',
    [string]$Team = '',
    [hashtable]$TaskSignals = @{},
    [hashtable]$Runtime = @{},
    [string]$ConfigPath = (Join-Path $PSScriptRoot '../config/router.json'),
    [ValidateRange(1, 2)][int]$MaxTotalAttempts = 2,
    [ValidateRange(5, 600)][int]$TimeoutSeconds = 300,
    [ValidateRange(5, 600)][int]$FirstOutputTimeoutSeconds = 120,
    [ValidateRange(5, 600)][int]$IdleTimeoutSeconds = 90,
    [ValidateRange(10, 900)][int]$HardTimeoutSeconds = 600,
    [ValidateRange(1, 60)][int]$GracefulShutdownSeconds = 10,
    [ValidateRange(500, 120000)][int]$MaxOutputChars = 12000,
    [string[]]$DeprecatedParameters = @(),
    [string]$IgnoreReason = '',
    [switch]$PlanOnly,
    [switch]$ExecuteNative,
    [string[]]$VerifiedNativeModels = @()
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Invoke-AiTeamProcess.ps1')
$script:agyDiscoveryProcessStatus = 'NOT_STARTED'

function Write-TaskReceipt([hashtable]$Receipt) {
    $Receipt['normalized_status'] = $Receipt.status
    $Receipt['reviewed'] = $Receipt.status -eq 'REVIEW_COMPLETED'
    if ($script:agyDiscoveryProcessStatus -ne 'NOT_STARTED') {
        # Preserve the bounded process outcome without disclosing AGY output.
        $Receipt['agy_discovery_process_status'] = $script:agyDiscoveryProcessStatus
    }
    # A route or CLI exit code never proves which model the host actually used.
    $Receipt['observed'] = @{model='unknown'; effort='unknown'; source='not_reported'}
    if ($Receipt.ContainsKey('route') -and $Receipt.route) {
        $Receipt['requested'] = $Receipt.route.requested
        $Receipt['resolved'] = $Receipt.route.resolved
    }
    $Receipt['verification'] = @{kind='local_wrapper'; status=$Receipt.status; source='process_and_schema'}
    if ($DeprecatedParameters.Count -gt 0) {
        $Receipt['deprecated_parameters'] = @($DeprecatedParameters)
        $Receipt['ignored_parameters'] = @($DeprecatedParameters)
        $Receipt['ignore_reason'] = if ($IgnoreReason) { $IgnoreReason } else { 'Compatibility parameter is accepted but intentionally has no effect in vNext.' }
    }
    $Receipt | ConvertTo-Json -Depth 24
}

function Test-CodexExecutionTerminal([string]$JsonLines) {
    $completed = $false
    foreach ($line in ($JsonLines -split "`r?`n")) {
        if (-not $line.Trim()) { continue }
        try { $event = $line | ConvertFrom-Json -AsHashtable }
        catch { return $false }
        if ($event.type -eq 'turn.failed' -or
            ($event.type -eq 'item.completed' -and $event.item.type -eq 'error')) { return $false }
        if ($event.type -eq 'turn.completed') { $completed = $true }
    }
    return $completed
}

if ($env:AI_TEAM_CHILD -eq '1') {
    Write-TaskReceipt @{status='BLOCKED_RECURSION'; attempts=@()}
    exit 2
}
$hasParentDepth = $TaskSignals.ContainsKey('parent_depth')
if ($hasParentDepth -and $TaskSignals['parent_depth'] -ne 0) {
    Write-TaskReceipt @{status='BLOCKED_RECURSION'; attempts=@()}
    exit 2
}
if ($Prompt -match '(?i)(api[_ -]?key|token|secret|password|private[_ -]?key|authorization)\s*[:=]') {
    Write-TaskReceipt @{status='BLOCKED_SENSITIVE_INPUT'; attempts=@()}
    exit 2
}
$python = Get-Command python -ErrorAction Stop
$adapter = Join-Path $PSScriptRoot '../mcp_server/route_cli.py'
$runtimeState = @{} + $Runtime
$task = @{} + $TaskSignals
$task['task_summary'] = $Prompt
if ($PSBoundParameters.ContainsKey('TaskType')) {
    $task['task_type'] = $TaskType
} elseif (-not $task.ContainsKey('task_type')) {
    $task['task_type'] = 'review'
}
if ($PSBoundParameters.ContainsKey('Difficulty') -and $Difficulty -ne 'auto') {
    # Explicit wrapper input outranks a lower-priority structured signal.
    $task.Remove('complexity')
    $task['difficulty'] = $Difficulty
} elseif (-not $task.ContainsKey('difficulty') -and -not $task.ContainsKey('complexity')) {
    $task['difficulty'] = 'auto'
}
$attempts = [System.Collections.Generic.List[object]]::new()
$agyDiscoveryStatus = 'NOT_REQUESTED'

function Invoke-RoutingAdapter([hashtable]$Request) {
    $result = Invoke-AiTeamProcess -FilePath $python.Source -ArgumentList @($adapter) `
        -StandardInputText ($Request | ConvertTo-Json -Depth 24 -Compress) `
        -Profile 'local-router' -Model 'deterministic' -ReasoningEffort 'none' `
        -FirstOutputTimeoutSeconds 5 -IdleTimeoutSeconds 5 -HardTimeoutSeconds 10 -MaxOutputChars 120000 -MaxOutputLines 1000
    if ($result.exitCode -ne 0) { throw 'Invalid routing input or provider review format' }
    return ($result.stdout | ConvertFrom-Json -AsHashtable)
}

try {
    # First classify locally. Native-only tasks do not spend quota or start AGY discovery.
    $preview = Invoke-RoutingAdapter @{task=$task; runtime=$runtimeState; team=$Team; config_path=$ConfigPath}
    if ($preview.status -in @('BLOCKED_RECURSION', 'BUDGET_EXHAUSTED')) {
        Write-TaskReceipt @{status=$preview.status; attempts=@()}
        exit 2
    }
    $agy = Get-Command agy -ErrorAction SilentlyContinue
    $wantsExternal = $preview.selected_model -in @('gemini_medium','gemini_high','sonnet','opus')
    if (-not $PlanOnly -and $wantsExternal) {
        # Discovery failures are classified separately from authentication. Any failure
        # still follows the deterministic Codex fallback; it never fails the task by itself.
        $runtimeState['agy_available'] = $false
        $runtimeState['agy_models'] = @{}
        $runtimeState['discovered_slugs'] = @()
        $provider = if ($preview.selected_model -in @('sonnet','opus')) { 'claude' } else { 'gemini' }
        $exhausted = $runtimeState.ContainsKey('quota') -and $runtimeState.quota.ContainsKey($provider) -and $runtimeState.quota[$provider] -eq 0
        if ($null -eq $agy) {
            $agyDiscoveryStatus = 'AGY_NOT_INSTALLED'
        } elseif ($exhausted) {
            $agyDiscoveryStatus = 'QUOTA_EXHAUSTED'
        } elseif ($Runtime.ContainsKey('agy_failure_category')) {
            $allowedAgyFailures = @('AUTH_REQUIRED', 'HOST_PERMISSION_BLOCKED', 'AGY_NOT_INSTALLED', 'MODEL_UNAVAILABLE', 'AGY_RUNTIME_ERROR')
            $agyDiscoveryStatus = if ($allowedAgyFailures -contains [string]$Runtime['agy_failure_category']) { [string]$Runtime['agy_failure_category'] } else { 'AGY_RUNTIME_ERROR' }
        } elseif ($Runtime.ContainsKey('agy_available') -and -not $Runtime.agy_available) {
            $agyDiscoveryStatus = 'AGY_RUNTIME_ERROR'
        } else {
            $discovery = Invoke-AiTeamProcess -FilePath $agy.Source -ArgumentList @('models') `
                -Profile 'model-discovery' -Model 'none' -ReasoningEffort 'none' -MarkAsChild `
                -FirstOutputTimeoutSeconds 10 -IdleTimeoutSeconds 30 -HardTimeoutSeconds 45 `
                -GracefulShutdownSeconds 1 -MaxOutputChars 120000 -MaxOutputLines 1000
            $script:agyDiscoveryProcessStatus = [string]$discovery.status
            if ($discovery.status -eq 'SUCCESS' -and -not $discovery.stdoutTruncated) {
                $mapping = Invoke-RoutingAdapter @{action='discover'; output=$discovery.stdout}
                if ($mapping.Count -gt 0) {
                    $agyDiscoveryStatus = 'DISCOVERY_VERIFIED'
                    $runtimeState['agy_available'] = $true
                    $runtimeState['agy_models'] = $mapping
                    $runtimeState['discovered_slugs'] = @($mapping.Values)
                } else {
                    $agyDiscoveryStatus = 'MODEL_UNAVAILABLE'
                }
            } else {
                $knownAgyStatuses = @('AUTH_REQUIRED', 'HOST_PERMISSION_BLOCKED', 'MODEL_UNAVAILABLE', 'AGY_RUNTIME_ERROR')
                $agyDiscoveryStatus = if ($knownAgyStatuses -contains [string]$discovery.status) { [string]$discovery.status } else { 'AGY_RUNTIME_ERROR' }
            }
        }
    }
    # Only external attempts are executed here. Native fallback always returns to the host.
    for ($index=0; $index -le $MaxTotalAttempts; $index++) {
        $decision = Invoke-RoutingAdapter @{task=$task; runtime=$runtimeState; team=$Team; config_path=$ConfigPath}
        if ($PlanOnly) {
            Write-TaskReceipt @{status='PLANNED'; route=$decision; agy_discovery_status=$agyDiscoveryStatus; attempts=@()}
            exit 0
        }
        if ($decision.status -ne 'planned') {
            Write-TaskReceipt @{status=$decision.status; route=$decision; agy_discovery_status=$agyDiscoveryStatus; attempts=@($attempts.ToArray())}
            exit 1
        }
        if ($decision.provider -eq 'native_agent') {
            if ($ExecuteNative) {
                if ($VerifiedNativeModels -notcontains $decision.model) {
                    Write-TaskReceipt @{status='NATIVE_MODEL_UNVERIFIED'; route=$decision; attempts=@(); completed=$false}
                    exit 1
                }
                # ProcessStartInfo cannot execute npm's PowerShell shim directly.
                $codexName = if ($IsWindows) { 'codex.exe' } else { 'codex' }
                $codex = Get-Command $codexName -CommandType Application -ErrorAction SilentlyContinue
                if ($null -eq $codex) {
                    Write-TaskReceipt @{status='CODEX_NOT_INSTALLED'; route=$decision; attempts=@($attempts.ToArray()); completed=$false}
                    exit 1
                }
                # Explicit execution only. CLI model/effort override static role presets;
                # the parent Desktop conversation remains on its own model.
                $repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
                $sandbox = if ($decision.role -eq 'developer') { 'workspace-write' } else { 'read-only' }
                $arguments = @('exec', '--ephemeral', '--json', '-m', $decision.model,
                               '-c', ('model_reasoning_effort="' + $decision.reasoning_effort + '"'),
                               '-s', $sandbox, '-C', $repositoryRoot, '-')
                $native = Invoke-AiTeamProcess -FilePath $codex.Source -ArgumentList $arguments `
                    -StandardInputText $Prompt -Profile $decision.role -Model $decision.model `
                    -ReasoningEffort $decision.reasoning_effort -MarkAsChild `
                    -FirstOutputTimeoutSeconds $FirstOutputTimeoutSeconds -IdleTimeoutSeconds $IdleTimeoutSeconds `
                    -HardTimeoutSeconds $HardTimeoutSeconds -GracefulShutdownSeconds $GracefulShutdownSeconds `
                    -MaxOutputChars $MaxOutputChars -MaxOutputLines 1000
                $terminal = $native.status -eq 'SUCCESS' -and -not $native.stdoutTruncated -and (Test-CodexExecutionTerminal $native.stdout)
                $nativeStatus = if ($terminal) { 'EXECUTED_NEEDS_VALIDATION' } else { 'NATIVE_EXECUTION_FAILED' }
                Write-TaskReceipt @{status=$nativeStatus; route=$decision; finalModel=$decision.model;
                    sandbox=$sandbox; observed=@{model='unknown'; effort='unknown'; source='cli_did_not_report_model'};
                    attempts=@(@{model=$decision.model; status=$native.status; exitCode=$native.exitCode});
                    completed=$false; validation='NOT_RUN'}
                exit $(if ($nativeStatus -eq 'EXECUTED_NEEDS_VALIDATION') { 0 } else { 1 })
            }
            Write-TaskReceipt @{status='FALLBACK_HANDOFF_REQUIRED'; finalModel=$decision.model; handoff=$decision.handoff; route=$decision; agy_discovery_status=$agyDiscoveryStatus; attempts=@($attempts.ToArray()); completed=$false}
            exit 0
        }
        if ($index -ge $MaxTotalAttempts) { break }
        $reviewPromptPath = Join-Path $PSScriptRoot '../prompts/reviewer-prompt.md'
        if (-not (Test-Path -LiteralPath $reviewPromptPath -PathType Leaf)) { throw 'Canonical reviewer prompt is missing' }
        $reviewPrompt = ([IO.File]::ReadAllText($reviewPromptPath)).Replace('{{TASK}}', $Prompt)
        $arguments = @('--print', $reviewPrompt, '--model', $decision.model, '--mode', 'plan', '--sandbox', '--print-timeout', "${TimeoutSeconds}s")
        if ($decision.reasoning_effort -ne 'model-default') { $arguments += @('--effort', $decision.reasoning_effort) }
        $result = Invoke-AiTeamProcess -FilePath $agy.Source -ArgumentList $arguments `
            -Profile $decision.role -Model $decision.model -ReasoningEffort $decision.reasoning_effort -MarkAsChild `
            -FirstOutputTimeoutSeconds $FirstOutputTimeoutSeconds -IdleTimeoutSeconds $IdleTimeoutSeconds `
            -HardTimeoutSeconds $HardTimeoutSeconds -GracefulShutdownSeconds $GracefulShutdownSeconds -MaxOutputChars $MaxOutputChars -MaxOutputLines 1000
        $status = $result.status
        $review = $null
        if ($status -eq 'SUCCESS' -and -not $result.stdoutTruncated) {
            try { $review = Invoke-RoutingAdapter @{action='validate_review'; output=$result.stdout} }
            catch { $status = 'INVALID_REVIEW' }
        } elseif ($status -eq 'SUCCESS') { $status = 'TRUNCATED_REVIEW' }
        $attempts.Add(@{model=$decision.model; status=$status; exitCode=$result.exitCode})
        if ($null -ne $review) {
            Write-TaskReceipt @{status='REVIEW_COMPLETED'; finalModel=$decision.model; route=$decision; review=$review; agy_discovery_status=$agyDiscoveryStatus; attempts=@($attempts.ToArray()); accepted=$false}
            exit 0
        }
        # A model gets one attempt. No Gemini -> Gemini or Sonnet -> Opus quota ladder.
        if (-not $runtimeState.ContainsKey('models')) { $runtimeState['models'] = @{} }
        $runtimeState.models[$decision.model_key] = @{failure='cli_failure'}
        $prior = if ($runtimeState.ContainsKey('attempted_models')) { @($runtimeState.attempted_models) } else { @() }
        $runtimeState['attempted_models'] = @($prior) + @($decision.model_key)
    }
    Write-TaskReceipt @{status='BUDGET_EXHAUSTED'; agy_discovery_status=$agyDiscoveryStatus; attempts=@($attempts.ToArray())}
    exit 1
} catch {
    # Do not emit exceptions containing prompts, provider diagnostics or environment values.
    Write-TaskReceipt @{status='INVALID_INPUT'; attempts=@($attempts.ToArray())}
    exit 2
}
