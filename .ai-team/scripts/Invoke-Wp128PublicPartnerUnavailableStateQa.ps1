[CmdletBinding()]
param(
  [ValidateRange(60, 180)]
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$node = Get-Command node -ErrorAction Stop
$process = Start-Process -FilePath $node.Source -ArgumentList @("scripts/wp128-public-partner-unavailable-state-runner.mjs") -WorkingDirectory $root -NoNewWindow -PassThru -Wait
if ($process.ExitCode -ne 0) { exit $process.ExitCode }
