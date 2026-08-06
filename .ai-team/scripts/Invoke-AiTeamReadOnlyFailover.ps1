[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$Prompt,
    [ValidateSet('gemini_fast', 'gemini_deep')]
    [string]$Role = 'gemini_fast',
    [ValidateRange(1, 2)]
    [int]$MaxTotalAttempts = 2,
    [ValidateRange(5, 600)]
    [int]$TimeoutSeconds = 300,
    [ValidateRange(5, 600)]
    [int]$FirstOutputTimeoutSeconds = 120,
    [ValidateRange(5, 600)]
    [int]$IdleTimeoutSeconds = 90,
    [ValidateRange(10, 900)]
    [int]$HardTimeoutSeconds = 600,
    [ValidateRange(500, 120000)]
    [int]$MaxOutputChars = 6000,
    [string]$ConfigPath = (Join-Path $PSScriptRoot '..\config\router.json')
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Invoke-AiTeamProcess.ps1')

function Write-AiTeamFailoverResult {
    param([Parameter(Mandatory)][hashtable]$Result)
    $Result | ConvertTo-Json -Depth 10
}

if ($Prompt -match '(?i)(api[_ -]?key|token|secret|password|private[_ -]?key|authorization)\s*[:=]') {
    Write-AiTeamFailoverResult ([ordered]@{
        status = 'BLOCKED_SENSITIVE_INPUT'
        finalStatus = 'BLOCKED_SENSITIVE_INPUT'
        requestedRole = $Role
        attempts = @()
        fallbackChain = @()
        externalSideEffects = $false
    })
    exit 2
}

try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    $chain = $config.fallback_chains.$Role
    if ($null -eq $chain -or $null -eq $chain.profiles) {
        throw 'fallback chain is not configured'
    }
} catch {
    Write-AiTeamFailoverResult ([ordered]@{
        status = 'TOOL_BLOCKED'
        finalStatus = 'TOOL_BLOCKED'
        requestedRole = $Role
        reason = 'fallback chain configuration unavailable'
        attempts = @()
        fallbackChain = @()
        externalSideEffects = $false
    })
    exit 1
}

$profiles = @($chain.profiles)
$configuredMaxAttempts = if ($null -ne $chain.max_total_attempts) { [int]$chain.max_total_attempts } else { $MaxTotalAttempts }
$effectiveMaxTotalAttempts = [Math]::Min($MaxTotalAttempts, $configuredMaxAttempts)
$fallbackChain = @($profiles | ForEach-Object { $_.profile })
$attemptReceipts = [System.Collections.Generic.List[object]]::new()
$attemptCount = 0
$final = $null

foreach ($entry in $profiles) {
    $profile = [string]$entry.profile
    if ($profile -eq 'codex_luna') {
        $luna = $config.codex_profiles.luna
        $final = [ordered]@{
            status = 'FALLBACK_HANDOFF_REQUIRED'
            finalStatus = 'FALLBACK_HANDOFF_REQUIRED'
            requestedRole = $Role
            primaryModel = if ($attemptReceipts.Count -gt 0) { $attemptReceipts[0].model } else { $null }
            finalModel = $luna.model
            fallbackChain = $fallbackChain
            attempts = @($attemptReceipts)
            handoff = [ordered]@{
                profile = 'codex_luna'
                model = $luna.model
                reasoningEffort = $luna.reasoning_effort
                sandboxMode = $luna.sandbox_mode
                availability = $luna.availability
                invocation = $luna.invocation
                reason = 'native-agent runtime handoff required; this runner never starts Codex CLI or Luna'
            }
            completedScope = @($attemptReceipts | Where-Object { $_.status -eq 'SUCCESS' } | ForEach-Object { $_.profile })
            remainingScope = @('fallback review')
            deterministicGates = 'NOT_RUN_BY_FAILOVER_RUNNER'
            externalSideEffects = $false
        }
        break
    }
    if ($attemptCount -ge $effectiveMaxTotalAttempts) { break }

    $profileConfig = if ($profile -eq 'gemini_fast') { $config.gemini_profiles.fast } elseif ($profile -eq 'gemini_deep') { $config.gemini_profiles.deep } else { $null }
    if ($null -eq $profileConfig) {
        $attemptReceipts.Add([ordered]@{ profile = $profile; status = 'MODEL_UNAVAILABLE'; model = $null })
        continue
    }
    if ($entry.max_attempts -le 0) { continue }
    $wrapperPath = Join-Path $PSScriptRoot (Split-Path -Leaf $profileConfig.wrapper)
    if (-not (Test-Path -LiteralPath $wrapperPath)) {
        $attemptReceipts.Add([ordered]@{ profile = $profile; status = 'PROCESS_START_FAILED'; model = $profileConfig.model })
        $attemptCount++
        continue
    }

    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($null -eq $pwsh) {
        $attemptReceipts.Add([ordered]@{ profile = $profile; status = 'PROCESS_START_FAILED'; model = $profileConfig.model; reason = 'pwsh command not found' })
        $attemptCount++
        continue
    }

    $arguments = @(
        '-NoProfile', '-File', $wrapperPath,
        '-Prompt', $Prompt,
        '-TimeoutSeconds', $TimeoutSeconds,
        '-FirstOutputTimeoutSeconds', $FirstOutputTimeoutSeconds,
        '-IdleTimeoutSeconds', $IdleTimeoutSeconds,
        '-HardTimeoutSeconds', $HardTimeoutSeconds,
        '-MaxAttempts', 1,
        '-MaxOutputChars', $MaxOutputChars
    )
    $processResult = Invoke-AiTeamProcess `
        -FilePath $pwsh.Source `
        -ArgumentList $arguments `
        -Profile $profile `
        -Model $profileConfig.model `
        -ReasoningEffort $profileConfig.reasoning_effort `
        -FirstOutputTimeoutSeconds $FirstOutputTimeoutSeconds `
        -IdleTimeoutSeconds $IdleTimeoutSeconds `
        -HardTimeoutSeconds $HardTimeoutSeconds `
        -MaxOutputChars $MaxOutputChars
    $attemptCount++

    $wrapperPayload = $null
    if (-not [string]::IsNullOrWhiteSpace($processResult.stdout)) {
        try { $wrapperPayload = $processResult.stdout | ConvertFrom-Json } catch { }
    }
    $hasNormalizedStatus = $null -ne $wrapperPayload -and @($wrapperPayload.PSObject.Properties.Name) -contains 'normalized_status'
    $normalizedStatus = if ($hasNormalizedStatus) { [string]$wrapperPayload.normalized_status } elseif ($processResult.status -eq 'SUCCESS') { 'SUCCESS' } else { $processResult.status }
    $attemptReceipts.Add([ordered]@{
        attempt = $attemptCount
        profile = $profile
        model = $profileConfig.model
        status = $normalizedStatus
        processStarted = $processResult.processStarted
        firstOutputAt = $processResult.firstOutputAt
        lastActivityAt = $processResult.lastActivityAt
        stdoutBytes = $processResult.stdoutBytes
        stderrBytes = $processResult.stderrBytes
        stderr = $processResult.stderr
        exitCode = $processResult.exitCode
        wasKilled = $processResult.wasKilled
        cleanupResult = $processResult.cleanupResult
        partialOutput = $processResult.stdout
    })
    if ($normalizedStatus -eq 'SUCCESS') {
        $final = [ordered]@{
            status = if ($attemptCount -eq 1) { 'COMPLETED_PRIMARY_MODEL' } else { 'COMPLETED_FALLBACK_MODEL' }
            finalStatus = if ($attemptCount -eq 1) { 'COMPLETED_PRIMARY_MODEL' } else { 'COMPLETED_FALLBACK_MODEL' }
            requestedRole = $Role
            primaryModel = if ($attemptReceipts.Count -gt 0) { $attemptReceipts[0].model } else { $null }
            finalModel = $profileConfig.model
            fallbackChain = $fallbackChain
            attempts = @($attemptReceipts)
            completedScope = @($attemptReceipts | Where-Object { $_.status -eq 'SUCCESS' } | ForEach-Object { $_.profile })
            remainingScope = @()
            deterministicGates = 'NOT_RUN_BY_FAILOVER_RUNNER'
            externalSideEffects = $false
        }
        break
    }
}

if ($null -eq $final) {
    $final = [ordered]@{
        status = 'ALL_APPROVED_MODELS_FAILED'
        finalStatus = 'ALL_APPROVED_MODELS_FAILED'
        requestedRole = $Role
        primaryModel = if ($attemptReceipts.Count -gt 0) { $attemptReceipts[0].model } else { $null }
        finalModel = $null
        fallbackChain = $fallbackChain
        attempts = @($attemptReceipts)
        completedScope = @($attemptReceipts | Where-Object { $_.status -eq 'SUCCESS' } | ForEach-Object { $_.profile })
        remainingScope = @($Role)
        deterministicGates = 'NOT_RUN_BY_FAILOVER_RUNNER'
        externalSideEffects = $false
    }
}

Write-AiTeamFailoverResult $final
if ($final.status -like 'COMPLETED_*' -or $final.status -eq 'FALLBACK_HANDOFF_REQUIRED') { exit 0 }
exit 1
