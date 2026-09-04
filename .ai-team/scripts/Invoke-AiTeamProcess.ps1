Set-StrictMode -Version Latest

function Limit-AiTeamText {
    param(
        [AllowNull()]
        [string]$Value,
        [Parameter(Mandatory)]
        [ValidateRange(100, 120000)]
        [int]$Limit
    )

    if ($null -eq $Value) {
        return [pscustomobject]@{ text = ''; truncated = $false }
    }
    if ($Value.Length -le $Limit) {
        return [pscustomobject]@{ text = $Value; truncated = $false }
    }
    return [pscustomobject]@{
        text = $Value.Substring(0, $Limit)
        truncated = $true
    }
}

function Add-AiTeamBoundedLine {
    param(
        [AllowEmptyCollection()]
        [AllowEmptyString()]
        [Parameter(Mandatory)]
        [System.Collections.Generic.List[string]]$Buffer,
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Line,
        [Parameter(Mandatory)]
        [ValidateRange(10, 1000)]
        [int]$MaxLines
    )

    [void]$Buffer.Add($Line)
    while ($Buffer.Count -gt $MaxLines) {
        $Buffer.RemoveAt(0)
    }
}

function Quote-AiTeamProcessArgument {
    param([AllowNull()][string]$Argument)

    if ($null -eq $Argument) { return '""' }
    if ($Argument -notmatch '[\s"]') { return $Argument }
    return '"' + ($Argument -replace '(\\*)"', '$1$1\\"') + '"'
}

function Set-AiTeamProcessArguments {
    param(
        [Parameter(Mandatory)]
        [System.Diagnostics.ProcessStartInfo]$StartInfo,
        [Parameter(Mandatory)]
        [string[]]$ArgumentList
    )

    $argumentListProperty = $StartInfo.PSObject.Properties['ArgumentList']
    if ($null -ne $argumentListProperty -and $null -ne $StartInfo.ArgumentList) {
        foreach ($argument in $ArgumentList) {
            [void]$StartInfo.ArgumentList.Add($argument)
        }
        return
    }
    $StartInfo.Arguments = (($ArgumentList | ForEach-Object {
        Quote-AiTeamProcessArgument $_
    }) -join ' ')
}

function Get-AiTeamFailureClassification {
    param(
        [AllowNull()][string]$Stdout,
        [AllowNull()][string]$Stderr,
        [AllowNull()][int]$ExitCode,
        [bool]$WasKilled,
        [bool]$TimedOut,
        [bool]$HadOutput
    )

    $combined = "$Stdout`n$Stderr"
    if ($combined -match '(?i)(login required|not authenticated|not logged in|sign[ -]?in required|authentication required)') {
        return 'AUTH_REQUIRED'
    }
    if ($combined -match '(?i)(rate limit|too many requests|\b429\b)') {
        return 'RATE_LIMITED'
    }
    if ($combined -match '(?i)(network error|connection reset|timed out|temporarily unavailable|service unavailable)') {
        return 'NETWORK_TRANSIENT'
    }
    if ($TimedOut) { return 'HARD_TIMEOUT' }
    if ($WasKilled) { return 'PROCESS_CRASHED' }
    if (-not $HadOutput -and $ExitCode -eq 0) { return 'NO_STDOUT' }
    if ($ExitCode -ne 0) { return 'PROCESS_CRASHED' }
    if (-not $HadOutput) { return 'NO_STDOUT' }
    return 'SUCCESS'
}

function Stop-AiTeamProcessTree {
    param(
        [Parameter(Mandatory)]
        [System.Diagnostics.Process]$Process,
        [Parameter(Mandatory)]
        [ValidateRange(1, 60)]
        [int]$GracefulShutdownSeconds
    )

    $wasKilled = $false
    $cleanupResult = 'already_exited'
    if (-not $Process.HasExited) {
        $cleanupResult = 'graceful_stop_attempted'
        try { [void]$Process.CloseMainWindow() } catch { }
        if (-not $Process.WaitForExit($GracefulShutdownSeconds * 1000)) {
            try {
                $Process.Kill($true)
                $wasKilled = $true
                $cleanupResult = 'process_tree_killed'
            } catch {
                try {
                    $Process.Kill()
                    $wasKilled = $true
                    $cleanupResult = 'process_killed'
                } catch {
                    $cleanupResult = 'kill_failed'
                }
            }
            try { [void]$Process.WaitForExit(2000) } catch { }
        } else {
            $cleanupResult = 'graceful_stop_succeeded'
        }
    }
    return [pscustomobject]@{
        wasKilled = $wasKilled
        cleanupResult = $cleanupResult
    }
}

function Invoke-AiTeamProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$FilePath,
        [Parameter(Mandatory)]
        [string[]]$ArgumentList,
        [Parameter(Mandatory)]
        [string]$Profile,
        [Parameter(Mandatory)]
        [string]$Model,
        [Parameter(Mandatory)]
        [string]$ReasoningEffort,
        [ValidateRange(5, 120)]
        [int]$StartupTimeoutSeconds = 30,
        [ValidateRange(5, 600)]
        [int]$FirstOutputTimeoutSeconds = 120,
        [ValidateRange(5, 600)]
        [int]$IdleTimeoutSeconds = 90,
        [ValidateRange(10, 900)]
        [int]$HardTimeoutSeconds = 600,
        [ValidateRange(1, 60)]
        [int]$GracefulShutdownSeconds = 10,
        [ValidateRange(100, 120000)]
        [int]$MaxOutputChars = 6000,
        [ValidateRange(10, 1000)]
        [int]$MaxOutputLines = 80
    )

    $startedAt = [DateTime]::UtcNow
    $stdoutLines = [System.Collections.Generic.List[string]]::new()
    $stderrLines = [System.Collections.Generic.List[string]]::new()
    $process = $null
    $firstOutputAt = $null
    $lastActivityAt = $null
    $wasKilled = $false
    $cleanupResult = 'not_started'
    $exitCode = $null
    $startupFailure = $null
    $startupTimedOut = $false
    $processStarted = $false
    $processId = $null

    try {
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $FilePath
        $startInfo.UseShellExecute = $false
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.CreateNoWindow = $true
        Set-AiTeamProcessArguments -StartInfo $startInfo -ArgumentList $ArgumentList

        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        $startWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $started = $process.Start()
        $startWatch.Stop()
        if (-not $started) { throw 'process_start_returned_false' }
        $processStarted = $true
        $processId = $process.Id
        if ($startWatch.Elapsed.TotalSeconds -gt $StartupTimeoutSeconds) {
            $startupTimedOut = $true
            throw 'process_start_timeout'
        }
        $cleanupResult = 'running'
    } catch {
        if ($startupTimedOut -and $null -ne $process) {
            $stop = Stop-AiTeamProcessTree -Process $process -GracefulShutdownSeconds $GracefulShutdownSeconds
            $wasKilled = $stop.wasKilled
            $cleanupResult = $stop.cleanupResult
            try { if ($process.HasExited) { $exitCode = $process.ExitCode } } catch { }
            $startupFailure = 'PROCESS_START_TIMEOUT'
        } else {
            $startupFailure = 'PROCESS_START_FAILED'
        }
    }

    if ($null -ne $startupFailure) {
        return [pscustomobject]@{
            status = $startupFailure
            profile = $Profile
            model = $Model
            reasoningEffort = $ReasoningEffort
            processStarted = $processStarted
            processId = $processId
            startedAt = $startedAt.ToString('o')
            firstOutputAt = $null
            lastActivityAt = $null
            stdoutBytes = 0
            stderrBytes = 0
            stdout = ''
            stderr = ''
            stdoutTruncated = $false
            stderrTruncated = $false
            exitCode = $null
            wasKilled = $wasKilled
            cleanupResult = $cleanupResult
            currentPhase = 'startup'
        }
    }

    $stdoutReader = $process.StandardOutput.ReadLineAsync()
    $stderrReader = $process.StandardError.ReadLineAsync()
    $stdoutDone = $false
    $stderrDone = $false
    $timedOut = $false
    $timeoutStatus = $null

    while ($true) {
        if (-not $stdoutDone -and $stdoutReader.IsCompleted) {
            $line = $stdoutReader.GetAwaiter().GetResult()
            if ($null -eq $line) {
                $stdoutDone = $true
            } else {
                Add-AiTeamBoundedLine -Buffer $stdoutLines -Line $line -MaxLines $MaxOutputLines
                $lastActivityAt = [DateTime]::UtcNow
                if ($null -eq $firstOutputAt) { $firstOutputAt = $lastActivityAt }
                $stdoutReader = $process.StandardOutput.ReadLineAsync()
            }
        }
        if (-not $stderrDone -and $stderrReader.IsCompleted) {
            $line = $stderrReader.GetAwaiter().GetResult()
            if ($null -eq $line) {
                $stderrDone = $true
            } else {
                Add-AiTeamBoundedLine -Buffer $stderrLines -Line $line -MaxLines $MaxOutputLines
                $lastActivityAt = [DateTime]::UtcNow
                if ($null -eq $firstOutputAt) { $firstOutputAt = $lastActivityAt }
                $stderrReader = $process.StandardError.ReadLineAsync()
            }
        }

        $now = [DateTime]::UtcNow
        $elapsedSeconds = ($now - $startedAt).TotalSeconds
        if ($process.HasExited -and $stdoutDone -and $stderrDone) {
            $exitCode = $process.ExitCode
            $cleanupResult = 'process_exited'
            break
        }
        if ($null -eq $firstOutputAt -and $elapsedSeconds -ge $FirstOutputTimeoutSeconds) {
            $timedOut = $true
            $timeoutStatus = 'FIRST_OUTPUT_TIMEOUT'
            break
        }
        if ($null -ne $firstOutputAt -and ($now - $lastActivityAt).TotalSeconds -ge $IdleTimeoutSeconds) {
            $timedOut = $true
            $timeoutStatus = 'IDLE_TIMEOUT'
            break
        }
        if ($elapsedSeconds -ge $HardTimeoutSeconds) {
            $timedOut = $true
            $timeoutStatus = 'HARD_TIMEOUT'
            break
        }
        Start-Sleep -Milliseconds 50
    }

    if ($timedOut) {
        $stop = Stop-AiTeamProcessTree -Process $process -GracefulShutdownSeconds $GracefulShutdownSeconds
        $wasKilled = $stop.wasKilled
        $cleanupResult = $stop.cleanupResult
        try { if ($process.HasExited) { $exitCode = $process.ExitCode } } catch { }
    }

    $stdout = ($stdoutLines -join "`n")
    $stderr = ($stderrLines -join "`n")
    $out = Limit-AiTeamText -Value $stdout -Limit $MaxOutputChars
    $err = Limit-AiTeamText -Value $stderr -Limit $MaxOutputChars
    $classification = Get-AiTeamFailureClassification -Stdout $stdout -Stderr $stderr -ExitCode $exitCode -WasKilled $wasKilled -TimedOut $timedOut -HadOutput ($stdoutLines.Count -gt 0 -or $stderrLines.Count -gt 0)
    if ($null -ne $timeoutStatus) { $classification = $timeoutStatus }

    return [pscustomobject]@{
        status = $classification
        profile = $Profile
        model = $Model
        reasoningEffort = $ReasoningEffort
        processStarted = $true
        processId = $process.Id
        startedAt = $startedAt.ToString('o')
        firstOutputAt = if ($null -ne $firstOutputAt) { $firstOutputAt.ToString('o') } else { $null }
        lastActivityAt = if ($null -ne $lastActivityAt) { $lastActivityAt.ToString('o') } else { $null }
        stdoutBytes = [Text.Encoding]::UTF8.GetByteCount($stdout)
        stderrBytes = [Text.Encoding]::UTF8.GetByteCount($stderr)
        stdout = $out.text
        stderr = $err.text
        stdoutTruncated = $out.truncated
        stderrTruncated = $err.truncated
        exitCode = $exitCode
        wasKilled = $wasKilled
        cleanupResult = $cleanupResult
        currentPhase = if ($classification -eq 'SUCCESS') { 'completed' } else { 'failed' }
    }
}
