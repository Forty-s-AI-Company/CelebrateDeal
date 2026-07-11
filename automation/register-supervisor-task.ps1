[CmdletBinding()]
param([string]$TaskName = "CelebrateDeal-AI-Autonomous-Supervisor")

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$supervisor = Join-Path $PSScriptRoot "autonomous_supervisor.py"
$python = (Get-Command python -CommandType Application -ErrorAction Stop).Source
$action = New-ScheduledTaskAction `
    -Execute $python `
    -Argument "`"$supervisor`" --once" `
    -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 55) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Hourly unified CelebrateDeal discovery, QA, regression, quota resume and commit-evidence supervisor." `
    -Force
