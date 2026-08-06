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
$runnerPath = Join-Path $scriptsRoot 'Invoke-AiTeamReadOnlyFailover.ps1'

foreach ($path in @($helperPath, $fastPath, $deepPath, $runnerPath)) {
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
                model = 'gpt-5.6-luna'; reasoning_effort = 'xhigh'; sandbox_mode = 'read-only'
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
    Assert-AiTeam (@($fullChain.attempts).Count -eq 2) 'full fallback chain exceeded approved model attempts'

    $config.fallback_chains.gemini_fast.profiles = @(
        [ordered]@{ profile = 'codex_luna'; max_attempts = 0 }
    )
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporaryConfig -Encoding utf8
    $handoffOutput = & $pwsh.Source -NoProfile -File $runnerPath -Prompt 'safe synthetic task' -ConfigPath $temporaryConfig 2>$null | Out-String
    $handoff = $handoffOutput | ConvertFrom-Json
    Assert-AiTeam ($handoff.status -eq 'FALLBACK_HANDOFF_REQUIRED') 'Luna handoff status missing'
    Assert-AiTeam ($handoff.finalModel -eq 'gpt-5.6-luna') 'Luna handoff model missing'
} finally {
    if (Test-Path -LiteralPath $temporaryConfig) { Remove-Item -LiteralPath $temporaryConfig -Force }
}

$sensitiveOutput = & $pwsh.Source -NoProfile -File $runnerPath -Prompt 'token: do-not-process' 2>$null | Out-String
$sensitive = $sensitiveOutput | ConvertFrom-Json
Assert-AiTeam ($sensitive.status -eq 'BLOCKED_SENSITIVE_INPUT') 'sensitive prompt started a process'

Write-Output 'AI_TEAM_RESILIENCE_TESTS=PASS'
