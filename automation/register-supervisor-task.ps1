[CmdletBinding()]
param(
    [string]$TaskName = "CelebrateDeal-AI-Quota-Supervisor"
)

$ErrorActionPreference = "Stop"
$runner = Join-Path $PSScriptRoot "run-supervisor.ps1"
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" `
    -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Hourly CelebrateDeal Codex/Antigravity quota probe and resumable AI pipeline supervisor." `
    -Force
