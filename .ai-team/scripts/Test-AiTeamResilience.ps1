[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$scriptsRoot = $PSScriptRoot
. (Join-Path $scriptsRoot 'Invoke-AiTeamProcess.ps1')

function Assert-AiTeam {
    param(
        [Parameter(Mandatory)][bool]$Condition,
        [Parameter(Mandatory)][string]$Message
    )
    if (-not $Condition) { throw "ASSERTION_FAILED: $Message" }
}

function New-AiTeamCommandArgs {
    param([Parameter(Mandatory)][string]$Command)
    return @('-NoProfile', '-Command', $Command)
}

$pwsh = Get-Command pwsh -ErrorAction Stop
$helperPath = Join-Path $scriptsRoot 'Invoke-AiTeamProcess.ps1'
$fastPath = Join-Path $scriptsRoot 'Invoke-AgyFast.ps1'
$deepPath = Join-Path $scriptsRoot 'Invoke-AgyDeep.ps1'
$planReviewPath = Join-Path $scriptsRoot 'Invoke-AgyPlanReview.ps1'
$runnerPath = Join-Path $scriptsRoot 'Invoke-AiTeamReadOnlyFailover.ps1'

foreach ($path in @($helperPath, $fastPath, $deepPath, $planReviewPath, $runnerPath)) {
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path -LiteralPath $path),
        [ref]$null,
        [ref]$parseErrors
    ) > $null
    Assert-AiTeam ($parseErrors.Count -eq 0) "PowerShell parse failed: $path"
}

$helperSource = Get-Content -LiteralPath $helperPath -Raw
Assert-AiTeam ($helperSource -match 'process_start_timeout' -and $helperSource -match 'Stop-AiTeamProcessTree -Process \$process') 'startup timeout cleanup guard missing'
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptsRoot)
$ciPath = Join-Path $repoRoot '.github/workflows/ci.yml'
$ciSource = Get-Content -LiteralPath $ciPath -Raw
Assert-AiTeam ($ciSource -match 'pip install[^\r\n]*\.ai-team/mcp_server/requirements\.txt') 'CI does not install MCP requirements'
Assert-AiTeam ($ciSource -match '(?m)^  push:\s*$' -and $ciSource -match 'npm run lint' -and $ciSource -match 'npm run test:coverage') 'push CI does not run lint and unit coverage tests'
Assert-AiTeam ($ciSource -notmatch '(?i)vercel\s+deploy[^\r\n]*--prod') 'push CI contains an automatic Vercel Production deploy'
$routerPath = Join-Path $repoRoot '.ai-team/config/router.json'
$routerConfig = Get-Content -LiteralPath $routerPath -Raw | ConvertFrom-Json
Assert-AiTeam ($routerConfig.git_policy.auto_push.enabled -and $routerConfig.git_policy.auto_merge.enabled) 'controlled Git promotion policy is not enabled'
Assert-AiTeam (-not $routerConfig.git_policy.auto_push.force_push -and -not $routerConfig.git_policy.auto_push.direct_default_branch_push) 'Git promotion policy allows unsafe direct or force push'
Assert-AiTeam (-not $routerConfig.git_policy.production_deploy.enabled -and $routerConfig.git_policy.production_deploy.approval -eq 'manual') 'Production deployment policy is not manual-only'
Assert-AiTeam ($routerConfig.plan_review.model -eq 'claude-sonnet-4.6-thinking' -and -not $routerConfig.plan_review.required) 'optional Claude plan review policy is invalid'
$workerLock = if ($routerConfig.agents.worker.PSObject.Properties['reasoning_lock']) { $routerConfig.agents.worker.reasoning_lock } else { $null }
Assert-AiTeam ($routerConfig.agents.worker.model -eq 'gpt-5.6-luna' -and ($null -eq $workerLock -or $workerLock -in @('low', 'medium', 'high', 'max'))) 'general Worker reasoning configuration is invalid'
$agentNames = @($routerConfig.agents.PSObject.Properties.Name)
$profileNames = @($routerConfig.codex_profiles.PSObject.Properties.Name)
Assert-AiTeam (-not ($agentNames -contains 'worker-critical') -and -not ($profileNames -contains 'luna_critical_worker')) 'legacy critical write profile remains configured'
Assert-AiTeam ($routerConfig.agents.reviewer.model -eq 'gpt-5.6-terra' -and $routerConfig.agents.reviewer.sandbox_mode -eq 'read-only') 'Reviewer is not Terra read-only'
Assert-AiTeam ($routerConfig.agents.explorer.luna_escalation.model -eq 'gpt-5.6-luna' -and $routerConfig.agents.analyst.luna_escalation.model -eq 'gpt-5.6-luna') 'Explorer/Analyst Luna escalation is missing'
$fastSource = Get-Content -LiteralPath $fastPath -Raw
Assert-AiTeam ($fastSource -match "gemini-3\.8-flash-high") 'AGY Fast model is not pinned to gemini-3.8-flash-high'
$planReviewSource = Get-Content -LiteralPath $planReviewPath -Raw
Assert-AiTeam ($planReviewSource -match "claude-sonnet-4\.6-thinking" -and $planReviewSource -match "skip_if_unavailable") 'Claude plan-review wrapper policy missing'
Assert-AiTeam ($planReviewSource -match "--mode', 'plan" -and $planReviewSource -match "--sandbox") 'Claude plan-review wrapper is not read-only plan mode'

$continuous = Invoke-AiTeamProcess `
    -FilePath $pwsh.Source `
    -ArgumentList (New-AiTeamCommandArgs '1..8 | ForEach-Object { Write-Output "tick$_"; Start-Sleep -Milliseconds 100 }') `
    -Profile 'synthetic' `
    -Model 'synthetic-child' `
    -ReasoningEffort 'none' `
    -FirstOutputTimeoutSeconds 5 `
    -IdleTimeoutSeconds 5 `
    -HardTimeoutSeconds 10
Assert-AiTeam ($continuous.status -eq 'SUCCESS') 'continuous output should complete'
Assert-AiTeam ($null -ne $continuous.firstOutputAt) 'first output timestamp missing'
Assert-AiTeam ($null -ne $continuous.lastActivityAt) 'last activity timestamp missing'

$hardTimeout = Invoke-AiTeamProcess `
    -FilePath $pwsh.Source `
    -ArgumentList (New-AiTeamCommandArgs 'Write-Output "started"; Start-Sleep -Seconds 20') `
    -Profile 'synthetic' `
    -Model 'synthetic-child' `
    -ReasoningEffort 'none' `
    -FirstOutputTimeoutSeconds 5 `
    -IdleTimeoutSeconds 20 `
    -HardTimeoutSeconds 10
Assert-AiTeam ($hardTimeout.status -eq 'HARD_TIMEOUT') 'hard timeout classification incorrect'
Assert-AiTeam $hardTimeout.wasKilled 'hard timeout did not kill the process'
$hardProcessAlive = if ($null -ne $hardTimeout.processId) { $null -ne (Get-Process -Id $hardTimeout.processId -ErrorAction SilentlyContinue) } else { $false }
Assert-AiTeam (-not $hardProcessAlive) 'hard timeout process remained alive after cleanup'

$idleTimeout = Invoke-AiTeamProcess `
    -FilePath $pwsh.Source `
    -ArgumentList (New-AiTeamCommandArgs 'Write-Output "started"; Start-Sleep -Seconds 20') `
    -Profile 'synthetic' `
    -Model 'synthetic-child' `
    -ReasoningEffort 'none' `
    -FirstOutputTimeoutSeconds 5 `
    -IdleTimeoutSeconds 5 `
    -HardTimeoutSeconds 10
Assert-AiTeam ($idleTimeout.status -eq 'IDLE_TIMEOUT') 'idle timeout classification incorrect'

$requiredFixes = Invoke-AiTeamProcess `
    -FilePath $pwsh.Source `
    -ArgumentList (New-AiTeamCommandArgs 'Write-Output ''required_fixes: []''') `
    -Profile 'synthetic' `
    -Model 'synthetic-child' `
    -ReasoningEffort 'none' `
    -FirstOutputTimeoutSeconds 5 `
    -IdleTimeoutSeconds 5 `
    -HardTimeoutSeconds 10
Assert-AiTeam ($requiredFixes.status -eq 'SUCCESS') 'required_fixes was incorrectly classified'

$authFailure = Invoke-AiTeamProcess `
    -FilePath $pwsh.Source `
    -ArgumentList (New-AiTeamCommandArgs 'Write-Error ''authentication required''; exit 1') `
    -Profile 'synthetic' `
    -Model 'synthetic-child' `
    -ReasoningEffort 'none' `
    -FirstOutputTimeoutSeconds 5 `
    -IdleTimeoutSeconds 5 `
    -HardTimeoutSeconds 10
Assert-AiTeam ($authFailure.status -eq 'AUTH_REQUIRED') 'explicit authentication failure was not classified'

$temporaryConfig = Join-Path ([IO.Path]::GetTempPath()) ("ai-team-resilience-{0}.json" -f ([guid]::NewGuid().ToString('N')))
try {
    $config = [ordered]@{
        gemini_profiles = [ordered]@{
            fast = [ordered]@{ model = 'synthetic-fast'; reasoning_effort = 'high'; wrapper = 'missing-fast.ps1' }
            deep = [ordered]@{ model = 'synthetic-deep'; reasoning_effort = 'high'; wrapper = 'missing-deep.ps1' }
        }
        codex_profiles = [ordered]@{
            luna = [ordered]@{
                model = 'gpt-5.6-luna'; reasoning_effort = 'high'; reasoning_minimum = 'high'; reasoning_maximum = 'max'
                reasoning_selection = 'adaptive_lowest_sufficient'; sandbox_mode = 'read-only'
                availability = 'runtime_dependent'; invocation = 'native_agent_handoff_only'
            }
        }
        fallback_chains = [ordered]@{
            gemini_fast = [ordered]@{
                max_total_attempts = 2
                profiles = @(
                    [ordered]@{ profile = 'gemini_fast'; max_attempts = 1 }
                    [ordered]@{ profile = 'gemini_deep'; max_attempts = 1 }
                    [ordered]@{ profile = 'codex_luna'; max_attempts = 0 }
                )
            }
        }
    }
    $config.fallback_chains.gemini_fast.profiles = @(
        [ordered]@{ profile = 'gemini_fast'; max_attempts = 1 }
        [ordered]@{ profile = 'gemini_deep'; max_attempts = 1 }
    )
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporaryConfig -Encoding utf8
    $allFailedOutput = & $pwsh.Source -NoProfile -File $runnerPath -Prompt 'safe synthetic task' -ConfigPath $temporaryConfig 2>$null | Out-String
    $allFailed = $allFailedOutput | ConvertFrom-Json
    Assert-AiTeam ($allFailed.status -eq 'ALL_APPROVED_MODELS_FAILED') 'fallback did not stop at total attempt limit'
    Assert-AiTeam (@($allFailed.attempts).Count -eq 2) 'fallback exceeded total attempt limit'

    $config.fallback_chains.gemini_fast.profiles = @(
        [ordered]@{ profile = 'gemini_fast'; max_attempts = 1 }
        [ordered]@{ profile = 'gemini_deep'; max_attempts = 1 }
        [ordered]@{ profile = 'codex_luna'; max_attempts = 0 }
    )
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporaryConfig -Encoding utf8
    $fullChainOutput = & $pwsh.Source -NoProfile -File $runnerPath -Prompt 'safe synthetic task' -ConfigPath $temporaryConfig 2>$null | Out-String
    $fullChain = $fullChainOutput | ConvertFrom-Json
    Assert-AiTeam ($fullChain.status -eq 'FALLBACK_HANDOFF_REQUIRED') 'full fallback chain did not reach Luna handoff'
    Assert-AiTeam ($fullChain.finalModel -eq 'gpt-5.6-luna') 'full fallback chain Luna model missing'
    Assert-AiTeam ($fullChain.handoff.reasoningEffort -eq 'high') 'Luna balanced default reasoning missing'
    Assert-AiTeam ($fullChain.handoff.reasoningMinimum -eq 'high' -and $fullChain.handoff.reasoningMaximum -eq 'max') 'Luna reasoning bounds missing'
    Assert-AiTeam (@($fullChain.attempts).Count -eq 2) 'full fallback chain exceeded approved model attempts'

    $config.fallback_chains.gemini_fast.profiles = @(
        [ordered]@{ profile = 'codex_luna'; max_attempts = 0 }
    )
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporaryConfig -Encoding utf8
    $handoffOutput = & $pwsh.Source -NoProfile -File $runnerPath -Prompt 'safe synthetic task' -ConfigPath $temporaryConfig 2>$null | Out-String
    $handoff = $handoffOutput | ConvertFrom-Json
    Assert-AiTeam ($handoff.status -eq 'FALLBACK_HANDOFF_REQUIRED') 'Luna handoff status missing'
    Assert-AiTeam ($handoff.finalModel -eq 'gpt-5.6-luna') 'Luna handoff model missing'
    Assert-AiTeam ($handoff.handoff.reasoningSelection -eq 'adaptive_lowest_sufficient') 'Luna adaptive reasoning policy missing'
} finally {
    if (Test-Path -LiteralPath $temporaryConfig) { Remove-Item -LiteralPath $temporaryConfig -Force }
}

$sensitiveOutput = & $pwsh.Source -NoProfile -File $runnerPath -Prompt 'token: do-not-process' 2>$null | Out-String
$sensitive = $sensitiveOutput | ConvertFrom-Json
Assert-AiTeam ($sensitive.status -eq 'BLOCKED_SENSITIVE_INPUT') 'sensitive prompt started a process'

Write-Output 'AI_TEAM_RESILIENCE_TESTS=PASS'
