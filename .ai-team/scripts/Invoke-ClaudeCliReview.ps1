# Standalone transport adapter: no routing, spawning, tools or secret inspection.
function Get-ClaudeCliLaunch {
    $command = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    if ($command.Source -like '*.exe' -or -not $IsWindows) {
        return @{file=$command.Source; prefix=@()}
    }
    # Launch npm's installed JS entry directly; ProcessStartInfo cannot execute a shim.
    $package = Join-Path (Split-Path $command.Source) 'node_modules/@anthropic-ai/claude-code'
    $native = Join-Path $package 'bin/claude.exe'
    if (Test-Path -LiteralPath $native -PathType Leaf) { return @{file=$native; prefix=@()} }
    $entry = Join-Path $package 'cli.js'
    $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($node -and (Test-Path -LiteralPath $entry -PathType Leaf)) {
        return @{file=$node.Source; prefix=@($entry)}
    }
    return $null
}

function Invoke-ClaudeCliReview {
    param([Parameter(Mandatory)][string]$Prompt,
          [Parameter(Mandatory)][string]$Alias,
          [Parameter(Mandatory)][string]$ObservedPattern,
          [ValidateRange(10,900)][int]$HardTimeoutSeconds=360)
    $launch = Get-ClaudeCliLaunch
    if (-not $launch) { return @{status='CLAUDE_CLI_NOT_INSTALLED'; process_status='NOT_STARTED'; exit_code=$null; observed_model='unknown'; observed_effort='unknown'; review_output=$null} }
    # Wire schema is an adapter for the canonical validator, not acceptance itself.
    $properties = @{}
    foreach ($name in @('severity','file','area','issue','evidence','impact','recommended_fix','required_test')) {
        $properties[$name] = @{type='string'}
    }
    $properties['confidence'] = @{type='number';minimum=0;maximum=1}
    $finding = @{type='object';additionalProperties=$false;properties=$properties;required=@($properties.Keys)}
    $schema = @{type='object';additionalProperties=$false;required=@('summary','findings');
        properties=@{summary=@{type='string'};findings=@{type='array';items=$finding;maxItems=100}}} | ConvertTo-Json -Depth 10 -Compress
    # Safe mode keeps subscription OAuth while disabling hooks, plugins, memory and
    # project customization. Empty tools plus strict MCP prevent repository access.
    $arguments = @($launch.prefix) + @('--print','--output-format','stream-json','--verbose','--model',$Alias,
        '--effort','high','--safe-mode','--tools','','--strict-mcp-config',
        '--no-session-persistence','--no-chrome','--disable-slash-commands',
        '--json-schema',$schema,
        '--permission-mode','plan','--permission-prompts','none',
        '--system-prompt','Review only the supplied text. Return the requested JSON. No tools or external actions.')
    $result = Invoke-AiTeamProcess -FilePath $launch.file -ArgumentList $arguments `
        -StandardInputText ($Prompt + "`n") -Profile 'claude-cli-readonly' -Model $Alias `
        -ReasoningEffort 'high' -MarkAsChild -FirstOutputTimeoutSeconds 120 `
        -IdleTimeoutSeconds 300 -HardTimeoutSeconds $HardTimeoutSeconds `
        -MaxOutputChars 120000 -MaxOutputLines 1000
    $receipt = @{status='AGY_RUNTIME_ERROR'; process_status=$result.status;
        exit_code=$result.exitCode; observed_model='unknown'; observed_effort='unknown'; review_output=$null}
    if ($result.stdoutTruncated) { $receipt.status='TRUNCATED_REVIEW'; return $receipt }
    if ($result.status -in @('AUTH_REQUIRED','HOST_PERMISSION_BLOCKED','MODEL_UNAVAILABLE')) {
        $receipt.status=$result.status; return $receipt
    }
    if ($result.status -match 'TIMEOUT|BLOCKED|FAILED_TO_START') { return $receipt }
    try {
        $terminals = @()
        foreach ($line in ($result.stdout -split "`r?`n")) {
            if (-not $line.Trim()) { continue }
            $event = $line | ConvertFrom-Json -AsHashtable
            if ($event.type -eq 'result') { $terminals += ,$event }
        }
        if ($terminals.Count -ne 1) { $receipt.status='INVALID_REVIEW'; return $receipt }
        $terminal = $terminals[0]
        if ($terminal.is_error -eq $true) {
            # Classify in memory; never emit diagnostics, credentials or raw logs.
            $diagnostic = [string]$terminal.result
            $receipt.status = if ($diagnostic -match '(?i)not logged in|authentication|login required|invalid.*key') {'AUTH_REQUIRED'}
                elseif ($diagnostic -match '(?i)rate.limit|usage.limit|quota') {'QUOTA_EXHAUSTED'}
                elseif ($diagnostic -match '(?i)permission denied|not permitted') {'HOST_PERMISSION_BLOCKED'}
                elseif ($diagnostic -match '(?i)model.*(?:unavailable|not found)') {'MODEL_UNAVAILABLE'} else {'AGY_RUNTIME_ERROR'}
            return $receipt
        }
        if ($result.status -ne 'SUCCESS' -or $terminal.type -ne 'result' -or $terminal.subtype -ne 'success') { return $receipt }
        $models = @($terminal.modelUsage.Keys)
        # A success/alias alone cannot qualify a reviewer; reject silent model fallback.
        if ($models.Count -ne 1 -or $models[0] -notmatch ('^(?:' + $ObservedPattern + ')$')) {
            $receipt.status='MODEL_UNAVAILABLE'; return $receipt
        }
        $receipt.observed_model=$models[0]
        $receipt.review_output = if ($terminal.ContainsKey('structured_output')) {
            $terminal.structured_output | ConvertTo-Json -Depth 20 -Compress
        } else { [string]$terminal.result }
        $receipt.status='SUCCESS'
    } catch { $receipt.status='INVALID_REVIEW' }
    return $receipt
}
