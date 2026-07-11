[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
    & npm.cmd run ai:supervisor
    if ($LASTEXITCODE -notin @(0, 2)) {
        throw "CelebrateDeal quota supervisor failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
