[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$Prompt,
    [ValidateRange(5, 120)]
    [int]$TimeoutSeconds = 45,
    [ValidateRange(500, 12000)]
    [int]$MaxOutputChars = 6000
)

$ErrorActionPreference = 'Stop'
$model = 'gemini-3.6-flash-high'
$effort = 'high'
$profile = 'gemini_fast'

function Limit-Text([string]$Value, [int]$Limit) {
    if ($null -eq $Value) { return @{ text = ''; truncated = $false } }
    if ($Value.Length -le $Limit) { return @{ text = $Value; truncated = $false } }
    return @{ text = $Value.Substring(0, $Limit); truncated = $true }
}

function Write-Result([hashtable]$Result) {
    $Result | ConvertTo-Json -Depth 5
}

if ($Prompt -match '(?i)(api[_ -]?key|token|secret|password|private[_ -]?key|authorization)\s*[:=]') {
    Write-Result @{ status = 'BLOCKED_SENSITIVE_INPUT'; profile = $profile; model = $model; effort = $effort; attempts = 0 }
    exit 2
}

$agy = Get-Command agy -ErrorAction SilentlyContinue
if ($null -eq $agy) {
    Write-Result @{ status = 'TOOL_BLOCKED'; profile = $profile; model = $model; effort = $effort; attempts = 0; reason = 'agy command not found' }
    exit 1
}

$last = $null
for ($attempt = 1; $attempt -le 2; $attempt++) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $agy.Source
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.CreateNoWindow = $true
    foreach ($argument in @('--print', $Prompt, '--model', $model, '--effort', $effort, '--mode', 'plan', '--sandbox', '--print-timeout', "${TimeoutSeconds}s")) {
        [void]$info.ArgumentList.Add($argument)
    }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $info
    [void]$process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $finished = $process.WaitForExit(($TimeoutSeconds + 10) * 1000)
    if (-not $finished) {
        $process.Kill($true)
        $process.WaitForExit()
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $watch.Stop()
    $combined = "$stdout`n$stderr"
    $out = Limit-Text $stdout $MaxOutputChars
    $err = Limit-Text $stderr $MaxOutputChars
    $last = @{ status = if ($finished -and $process.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($stdout)) { 'OK' } else { 'TOOL_BLOCKED' }; profile = $profile; model = $model; effort = $effort; execution_mode = 'plan'; sandbox = $true; attempt = $attempt; exit_code = if ($finished) { $process.ExitCode } else { $null }; elapsed_ms = $watch.ElapsedMilliseconds; stdout = $out.text; stderr = $err.text; stdout_truncated = $out.truncated; stderr_truncated = $err.truncated }
    if ($combined -match '(?i)(login|required|sign in|authenticate)') { $last.status = 'LOGIN_REQUIRED'; Write-Result $last; exit 1 }
    if ($last.status -eq 'OK') { Write-Result $last; exit 0 }
}
Write-Result $last
exit 1
