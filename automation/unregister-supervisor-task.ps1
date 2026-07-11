[CmdletBinding()]
param([string]$TaskName = "CelebrateDeal-AI-Autonomous-Supervisor")

$ErrorActionPreference = "Stop"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "supervisor-task-removed"
}
else {
    Write-Output "supervisor-task-not-found"
}
