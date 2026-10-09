$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Invoke-ClaudeCliReview.ps1')
# No provider call: aliases must not shadow an installed application launch.
Set-Alias -Name claude -Value Get-Date
try { $null=Get-ClaudeCliLaunch } finally { Remove-Item Alias:claude -Force }
function Get-ClaudeCliLaunch { return @{file='offline-claude';prefix=@()} }
function Invoke-AiTeamProcess {
    param($FilePath,$ArgumentList,$StandardInputText,$Profile,$Model,$ReasoningEffort,
          [switch]$MarkAsChild,$FirstOutputTimeoutSeconds,$IdleTimeoutSeconds,$HardTimeoutSeconds,$MaxOutputChars,$MaxOutputLines)
    if (-not $MarkAsChild -or '--safe-mode' -notin $ArgumentList -or '--strict-mcp-config' -notin $ArgumentList -or
        '--no-session-persistence' -notin $ArgumentList -or '--permission-prompts' -notin $ArgumentList -or
        '--dangerously-skip-permissions' -in $ArgumentList -or
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
$null=Check AGY_RUNTIME_ERROR
function Get-ClaudeCliLaunch { return $null }
$missing=Check CLAUDE_CLI_NOT_INSTALLED
foreach($field in @('status','process_status','exit_code','observed_model','observed_effort','review_output')) {
    if (-not $missing.ContainsKey($field)) { throw "MISSING_RECEIPT_FIELD:$field" }
}
'CLAUDE_CLI_TRANSPORT_TESTS=PASS'
