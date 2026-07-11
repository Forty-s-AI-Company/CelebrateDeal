[CmdletBinding()]
param(
    [string]$Task,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$arguments = @("$PSScriptRoot/orchestrator.py")
if ($Task) { $arguments += @("--task", $Task) }
if ($DryRun) { $arguments += "--dry-run" }

Push-Location $repoRoot
try {
    & python @arguments
    if ($LASTEXITCODE -ne 0) { throw "CelebrateDeal orchestrator failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}
