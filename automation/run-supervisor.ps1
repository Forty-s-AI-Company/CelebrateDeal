[CmdletBinding()]
param(
    [switch]$Once,
    [double]$IntervalMinutes = 60,
    [double]$MaxRuntimeMinutes = 0
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
    $arguments = @("automation/autonomous_supervisor.py", "--interval-minutes", "$IntervalMinutes", "--max-runtime-minutes", "$MaxRuntimeMinutes")
    if ($Once) {
        $arguments += "--once"
    }
    & python @arguments
    if ($LASTEXITCODE -notin @(0, 2, 3)) {
        throw "CelebrateDeal autonomous supervisor failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
