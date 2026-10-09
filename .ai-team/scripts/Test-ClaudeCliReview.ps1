$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Invoke-ClaudeCliReview.ps1')
# No provider call: aliases must not shadow an installed application launch.
Set-Alias -Name claude -Value Get-Date
try {
    $launch=Get-ClaudeCliLaunch
    if ($launch -and $launch.file -isnot [string]) { throw 'CLI_LAUNCH_MUST_BE_ONE_EXECUTABLE' }
} finally { Remove-Item Alias:claude -Force }
function Get-ClaudeCliLaunch { return @{file='offline-claude';prefix=@()} }
function Invoke-AiTeamProcess {
    param($FilePath,$ArgumentList,$StandardInputText,$Profile,$Model,$ReasoningEffort,
          [switch]$MarkAsChild,$FirstOutputTimeoutSeconds,$IdleTimeoutSeconds,$HardTimeoutSeconds,$MaxOutputChars,$MaxOutputLines)
    if (-not $MarkAsChild -or '--safe-mode' -notin $ArgumentList -or '--strict-mcp-config' -notin $ArgumentList -or
        '--no-session-persistence' -notin $ArgumentList -or '--permission-prompts' -notin $ArgumentList -or
        '--dangerously-skip-permissions' -in $ArgumentList -or
        $ArgumentList[[Array]::IndexOf($ArgumentList,'--permission-mode')+1] -ne 'dontAsk' -or
        $ArgumentList[[Array]::IndexOf($ArgumentList,'--tools')+1] -ne '') { throw 'UNSAFE_CLI_ARGUMENTS' }
    return $script:fixture
}
$terminal=@{type='result';subtype='success';is_error=$false;modelUsage=@{'claude-opus-5-5'=@{}};result='{"summary":"fixture","findings":[]}'}
function Check([string]$Expected) {
    $result=Invoke-ClaudeCliReview -Prompt 'fixed synthetic fixture' -Alias opus -ObservedPattern 'claude-opus-\d+(?:[.-]\d+)+'
    if ($result.status -ne $Expected) { throw "Expected $Expected, got $($result.status)" }
    return $result
}
$script:fixture=@{status='SUCCESS';exitCode=0;stdoutTruncated=$false;stdout=($terminal|ConvertTo-Json -Depth 8 -Compress)}
$result=Check SUCCESS
if ($result.observed_model -ne 'claude-opus-5-5' -or $result.observed_effort -ne 'unknown') { throw 'INVALID_OBSERVATION' }
$valid=$script:fixture.stdout
$structured=$terminal.Clone();$structured['structured_output']=@{summary='structured fixture';findings=@()};$structured.result=''
$script:fixture.stdout=$structured|ConvertTo-Json -Depth 8 -Compress
$structuredResult=Check SUCCESS
if (($structuredResult.review_output | ConvertFrom-Json).summary -ne 'structured fixture') { throw 'STRUCTURED_OUTPUT_NOT_EXTRACTED' }
$script:fixture.stdout='{"type":"system","subtype":"init"}'+"`n"+$valid
$null=Check SUCCESS
$hostTerminal=$terminal.Clone();$hostTerminal['permission_denials']=@();$hostTerminal.result='{"summary":"Finding quotes permission denied; no actual denied operation","findings":[]}'
$script:fixture=@{status='HOST_PERMISSION_BLOCKED';exitCode=0;stdoutTruncated=$false;stderr='';stdout=($hostTerminal|ConvertTo-Json -Depth 8 -Compress)}
$recovered=Check SUCCESS
if ($recovered.classification_note -ne 'HOST_TEXT_FALSE_POSITIVE_VERIFIED_TERMINAL') { throw 'MISSING_CLASSIFICATION_PROVENANCE' }
$formatter='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"StructuredOutput"}]}}'
$script:fixture.stdout=$formatter+"`n"+($hostTerminal|ConvertTo-Json -Depth 8 -Compress);$null=Check SUCCESS
$script:fixture.stderr='permission denied';$null=Check HOST_PERMISSION_BLOCKED
$script:fixture.stderr='';$script:fixture.exitCode=1;$null=Check HOST_PERMISSION_BLOCKED
$script:fixture.exitCode=0;$hostTerminal.permission_denials=@(@{tool_name='synthetic'});$script:fixture.stdout=$hostTerminal|ConvertTo-Json -Depth 8 -Compress;$null=Check HOST_PERMISSION_BLOCKED
$hostTerminal.Remove('permission_denials');$script:fixture.stdout=$hostTerminal|ConvertTo-Json -Depth 8 -Compress;$null=Check HOST_PERMISSION_BLOCKED
$hostTerminal.permission_denials=@();$tool='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"synthetic"}]}}'
$script:fixture.stdout=$tool+"`n"+($hostTerminal|ConvertTo-Json -Depth 8 -Compress);$null=Check HOST_PERMISSION_BLOCKED
$hostTerminal.is_error=$true;$script:fixture.stdout=$hostTerminal|ConvertTo-Json -Depth 8 -Compress;$null=Check HOST_PERMISSION_BLOCKED
$script:fixture=@{status='SUCCESS';exitCode=0;stdoutTruncated=$false;stdout=$valid}
$script:fixture.stdout=$valid+"`n"+$valid
$null=Check INVALID_REVIEW
$terminal.modelUsage=@{'claude-sonnet-5-5'=@{}}
$script:fixture.stdout=$terminal|ConvertTo-Json -Depth 8 -Compress
$null=Check MODEL_UNAVAILABLE
$terminal.is_error=$true;$terminal.result='Not logged in';$script:fixture.stdout=$terminal|ConvertTo-Json -Depth 8 -Compress
$null=Check AUTH_REQUIRED
$terminal.result='usage limit reached';$script:fixture.stdout=$terminal|ConvertTo-Json -Depth 8 -Compress
$null=Check QUOTA_EXHAUSTED
$script:fixture.stdout='non-json';$null=Check INVALID_REVIEW
$script:fixture.stdoutTruncated=$true;$null=Check TRUNCATED_REVIEW
$script:fixture.stdoutTruncated=$false;$script:fixture.status='IDLE_TIMEOUT';$script:fixture.stdout=$terminal|ConvertTo-Json -Depth 8 -Compress
$null=Check CLAUDE_CLI_RUNTIME_ERROR
function Get-ClaudeCliLaunch { return $null }
$missing=Check CLAUDE_CLI_NOT_INSTALLED
foreach($field in @('status','process_status','exit_code','observed_model','observed_effort','review_output')) {
    if (-not $missing.ContainsKey($field)) { throw "MISSING_RECEIPT_FIELD:$field" }
}
'CLAUDE_CLI_TRANSPORT_TESTS=PASS'
