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
$selector = Get-Content -LiteralPath $routerPath -Raw | ConvertFrom-Json
$routerConfig = Get-Content -LiteralPath (Join-Path $repoRoot '.ai-team/config/routing-policy.json') -Raw | ConvertFrom-Json
Assert-AiTeam ($selector.version -eq '6.0') 'selector version is unsupported'
Assert-AiTeam ($routerConfig.git_policy.auto_push.enabled -and $routerConfig.git_policy.auto_merge.enabled) 'controlled Git promotion policy missing'
Assert-AiTeam (-not $routerConfig.git_policy.auto_push.force_push -and -not $routerConfig.git_policy.auto_push.direct_default_branch_push) 'unsafe Git promotion policy'
Assert-AiTeam (-not $routerConfig.git_policy.production_deploy.enabled -and $routerConfig.git_policy.production_deploy.approval -eq 'manual') 'Production deployment must require manual approval'
Assert-AiTeam (-not $routerConfig.limits.automatic_spawn -and $routerConfig.limits.max_agent_depth -eq 1) 'recursion guard missing'
$taskSource = Get-Content -LiteralPath (Join-Path $scriptsRoot 'Invoke-AiTeamTask.ps1') -Raw
Assert-AiTeam ($taskSource -match "--mode', 'plan" -and $taskSource -match "--sandbox") 'review must remain read-only'
Assert-AiTeam ($taskSource -notmatch 'dangerously-skip-permissions') 'permission bypass is prohibited'
Assert-AiTeam ($taskSource -match 'validate_review' -and $taskSource -match 'accepted=\$false') 'process success must not become review acceptance'

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

# AGY can emit blank lines on either stream; preserve them without a binding failure.
$blankLines = Invoke-AiTeamProcess `
    -FilePath $pwsh.Source `
    -ArgumentList (New-AiTeamCommandArgs '[Console]::Out.WriteLine(""); [Console]::Error.WriteLine(""); [Console]::Out.WriteLine("ready")') `
    -Profile 'synthetic' -Model 'synthetic-child' -ReasoningEffort 'none' `
    -FirstOutputTimeoutSeconds 5 -IdleTimeoutSeconds 5 -HardTimeoutSeconds 10
Assert-AiTeam ($blankLines.status -eq 'SUCCESS' -and $blankLines.stdout.Contains('ready')) 'blank stdout/stderr interrupted process collection'
Assert-AiTeam ($blankLines.cleanupResult -eq 'process_exited') 'blank-line process did not exit normally'

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

# AGY models can report a sign-in requirement without the older "login required" wording.
foreach ($authText in @('Error: Please sign in to view available models.', 'You are not logged into Antigravity.')) {
    $classification = Get-AiTeamFailureClassification -Stdout $authText -Stderr '' -ExitCode 1 -WasKilled $false -TimedOut $false -HadOutput $true
    Assert-AiTeam ($classification -eq 'AUTH_REQUIRED') 'AGY model-list authentication failure was misclassified'
}

$hostPermission = Get-AiTeamFailureClassification -Stdout '' -Stderr 'Error: Access is denied while opening the Antigravity CLI log.' -ExitCode 1 -WasKilled $false -TimedOut $false -HadOutput $true -IsAgy $true
Assert-AiTeam ($hostPermission -eq 'HOST_PERMISSION_BLOCKED') 'Access Denied was incorrectly classified as authentication failure'
$hostPermissionWithAuthText = Get-AiTeamFailureClassification -Stdout '' -Stderr 'authentication required: Access is denied by host policy.' -ExitCode 1 -WasKilled $false -TimedOut $false -HadOutput $true -IsAgy $true
Assert-AiTeam ($hostPermissionWithAuthText -eq 'HOST_PERMISSION_BLOCKED') 'host Access Denied was overridden by authentication wording'
$modelUnavailable = Get-AiTeamFailureClassification -Stdout 'Error: model not found' -Stderr '' -ExitCode 1 -WasKilled $false -TimedOut $false -HadOutput $true -IsAgy $true
Assert-AiTeam ($modelUnavailable -eq 'MODEL_UNAVAILABLE') 'missing AGY model was not classified as MODEL_UNAVAILABLE'
$agyRuntime = Get-AiTeamFailureClassification -Stdout '' -Stderr 'unexpected provider failure' -ExitCode 1 -WasKilled $false -TimedOut $false -HadOutput $true -IsAgy $true
Assert-AiTeam ($agyRuntime -eq 'AGY_RUNTIME_ERROR') 'generic AGY failure was not classified as AGY_RUNTIME_ERROR'
$toolDenied = Get-AiTeamFailureClassification -Stdout '{"status":"completed"}' -Stderr 'shell command denied by host policy' -ExitCode 0 -WasKilled $false -TimedOut $false -HadOutput $true -IsAgy $true
Assert-AiTeam ($toolDenied -eq 'TOOL_DENIED') 'exit 0 with denied required tool cannot pass QA'
$actualHeadlessDenial = Get-AiTeamFailureClassification -Stdout 'jetski: no output produced - a tool required the command permission that headless mode cannot prompt for, so it was auto-denied.' -Stderr '' -ExitCode 0 -WasKilled $false -TimedOut $false -HadOutput $true -IsAgy $true
Assert-AiTeam ($actualHeadlessDenial -eq 'TOOL_DENIED') 'actual AGY headless permission denial was misclassified'


# Capability-preserving fallback, attempt budgets and compatibility wrappers are exercised
# by Test-AiTeamRouting.ps1 with isolated synthetic providers, never live accounts.
& (Join-Path $scriptsRoot 'Test-AiTeamRouting.ps1')
if ($LASTEXITCODE -ne 0) { throw 'routing integration failed' }

$sensitiveOutput = & $pwsh.Source -NoProfile -File $runnerPath -Prompt 'token: do-not-process' 2>$null | Out-String
$sensitive = $sensitiveOutput | ConvertFrom-Json
Assert-AiTeam ($sensitive.status -eq 'BLOCKED_SENSITIVE_INPUT') 'sensitive prompt started a process'

Write-Output 'AI_TEAM_RESILIENCE_TESTS=PASS'

Assert-AiTeam ((Quote-AiTeamProcessArgument '') -eq '""') 'empty print argument was dropped on legacy runtimes'
$utf8Input = Invoke-AiTeamProcess -FilePath $pwsh.Source `
    -ArgumentList (New-AiTeamCommandArgs '$b=[Console]::OpenStandardInput(); $bytes=New-Object byte[] 3; [void]$b.Read($bytes,0,3); [Console]::Out.Write([BitConverter]::ToString($bytes))') `
    -StandardInputText '{"event":"user"}' -Profile synthetic -Model synthetic -ReasoningEffort none `
    -FirstOutputTimeoutSeconds 5 -IdleTimeoutSeconds 5 -HardTimeoutSeconds 10
Assert-AiTeam ($utf8Input.status -eq 'SUCCESS' -and $utf8Input.stdout -eq '7B-22-65') 'stdin JSON contains a UTF-8 BOM'
# Large Unicode scopes must use stdin rather than Windows command-line arguments.
$largeScope = ('審查範圍' * 11000) + 'END_MARKER'
$largeInput = Invoke-AiTeamProcess -FilePath $pwsh.Source `
    -ArgumentList (New-AiTeamCommandArgs '[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); $s=[Console]::In.ReadToEnd(); [Console]::Out.Write($s.Length.ToString()+":"+$s.Substring($s.Length-10))') `
    -StandardInputText $largeScope -Profile synthetic -Model synthetic -ReasoningEffort none `
    -FirstOutputTimeoutSeconds 10 -IdleTimeoutSeconds 10 -HardTimeoutSeconds 20
Assert-AiTeam ($largeInput.status -eq 'SUCCESS' -and $largeInput.stdout -eq ($largeScope.Length.ToString()+':END_MARKER')) 'large Unicode stdin was lost'
$validResult = @{event='result';result=@{status='SUCCESS';response='{"summary":"verified","findings":[]}'}} | ConvertTo-Json -Depth 4 -Compress
Assert-AiTeam ((Get-AiTeamAgyReviewOutput $validResult) -eq '{"summary":"verified","findings":[]}') 'terminal response was not extracted'
foreach ($badStream in @(($validResult+"`n"+$validResult), '{"event":"result","result":{"status":"ERROR","response":"{}"}}', '{"event":"init"}', '{broken')) {
    $rejected = $false
    try { Get-AiTeamAgyReviewOutput $badStream > $null } catch { $rejected = $true }
    Assert-AiTeam $rejected 'invalid or duplicate terminal result was accepted'
}
$blockedInput = Invoke-AiTeamProcess -FilePath $pwsh.Source `
    -ArgumentList (New-AiTeamCommandArgs 'Write-Output "started"; Start-Sleep -Seconds 30') `
    -StandardInputText ('x' * 200000) -Profile synthetic -Model synthetic -ReasoningEffort none `
    -FirstOutputTimeoutSeconds 5 -IdleTimeoutSeconds 5 -HardTimeoutSeconds 10 -GracefulShutdownSeconds 1
Assert-AiTeam ($blockedInput.status -eq 'IDLE_TIMEOUT' -and $blockedInput.wasKilled) 'blocked stdin bypassed timeout cleanup'
Write-Output 'AGY stdin and terminal-response regressions passed'
$discardedTerminal = Invoke-AiTeamProcess -FilePath $pwsh.Source `
    -ArgumentList (New-AiTeamCommandArgs 'Write-Output ''{"event":"result","result":{"status":"SUCCESS","response":"{}"}}''; 1..10 | ForEach-Object { Write-Output ''{"event":"progress"}'' }; Write-Output ''{"event":"result","result":{"status":"SUCCESS","response":"{}"}}''') `
    -Profile synthetic -Model synthetic -ReasoningEffort none -MaxOutputLines 10 `
    -FirstOutputTimeoutSeconds 5 -IdleTimeoutSeconds 5 -HardTimeoutSeconds 10
Assert-AiTeam ($discardedTerminal.status -eq 'SUCCESS' -and $discardedTerminal.stdoutTruncated) 'discarded terminal event was concealed by the line limit'
Write-Output 'AGY line-limit truncation regression passed'
