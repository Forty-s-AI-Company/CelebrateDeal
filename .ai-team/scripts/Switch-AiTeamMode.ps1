[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [ValidateSet('high','low','pro','style','高階','低階','進階','風格','視覺','設計','高階模式','低階模式','進階模式','風格模式','視覺模式','設計模式','ai-team','ai-team-lite','ai-team-pro','ai-team-style','list','清單','status','current','info')]
    [string]$Mode='', [switch]$Status, [switch]$List
)
$ErrorActionPreference = 'Stop'
$configDir = Join-Path $PSScriptRoot '../config'
$targetPath = Join-Path $configDir 'router.json'
$policy = Get-Content -LiteralPath (Join-Path $configDir 'routing-policy.json') -Raw | ConvertFrom-Json

function Show-Mode([string]$Path) {
    $selector = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    [pscustomobject]@{
        Team = $selector.active_mode_id
        Routing = 'Task-first; risk overrides complexity; routing-policy.json'
        Default = 'Luna first; Sol for difficult work, Astra only with a reason'
        ModelPermission = if ($selector.active_mode -eq 'pro') { 'Luna / Sol / Astra / Gemini / Claude; no mandatory high-end model' } elseif ($selector.active_mode -eq 'high') { 'Luna / Sol / Gemini / Sonnet' } else { 'Luna / Gemini Medium; other models require tier escalation' }
        AutomaticSpawn = $policy.limits.automatic_spawn
    }
}
if ($List -or $Mode -in @('list','清單')) {
    foreach ($key in @('low','high','pro','style')) { Show-Mode (Join-Path $configDir "router.$key.json") }
    exit 0
}
if ($Status -or $Mode -in @('status','current','info','')) { Show-Mode $targetPath; exit 0 }
$key = if ($Mode -in @('style','ai-team-style','風格','風格模式','視覺','視覺模式','設計','設計模式')) { 'style' } elseif ($Mode -in @('pro','ai-team-pro','進階','進階模式')) { 'pro' } elseif ($Mode -in @('high','ai-team','高階','高階模式')) { 'high' } else { 'low' }
$source = Join-Path $configDir "router.$key.json"
# Only the next task's tier changes; never mutate a running model or agent descriptor.
$temporary = Join-Path $configDir ('router-' + [guid]::NewGuid().ToString('N') + '.tmp')
try {
    Copy-Item -LiteralPath $source -Destination $temporary
    Move-Item -LiteralPath $temporary -Destination $targetPath -Force
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
}
Show-Mode $targetPath
