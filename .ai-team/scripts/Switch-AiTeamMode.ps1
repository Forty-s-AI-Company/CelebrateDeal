[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [ValidateSet('high', 'low', '高階', '低階', 'status', 'current', 'info')]
    [string]$Mode = '',
    [switch]$Status
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$scriptsRoot = $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptsRoot)
$configDir = Join-Path $repoRoot '.ai-team/config'
$targetPath = Join-Path $configDir 'router.json'
$highTemplate = Join-Path $configDir 'router.high.json'
$lowTemplate = Join-Path $configDir 'router.low.json'

function Show-AiTeamStatus {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Error "找不到設定檔: $Path"
        return
    }
    $cfg = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $modeName = if ($cfg.active_mode_name) { $cfg.active_mode_name } else { if ($cfg.active_mode -eq 'high') { '高階模式' } else { '低階模式' } }
    $modeId = if ($cfg.active_mode) { $cfg.active_mode } else { 'unknown' }
    $planner = $cfg.agents.planner.model
    $reviewTiers = @($cfg.plan_review.fallback_chain | ForEach-Object {
        if ($_.profile) { "$($_.profile) ($($_.model))" } else { "skip_review" }
    }) -join ' -> '
    $worker = "$($cfg.agents.worker.model) (預設推理: $($cfg.agents.worker.reasoning_effort))"
    $workerLock = if ($cfg.agents.worker.PSObject.Properties['reasoning_lock']) { $cfg.agents.worker.reasoning_lock } else { "無鎖定 (動態 low~high)" }

    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "   CelebrateDeal AI Team 當前配置狀態" -ForegroundColor Cyan
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "目前模式: $modeName [$modeId]" -ForegroundColor Yellow
    Write-Host "主規劃端: $planner"
    Write-Host "審查階梯: $reviewTiers"
    Write-Host "一般工作: $worker"
    Write-Host "推理鎖定: $workerLock"
    Write-Host "-------------------------------------------------" -ForegroundColor Gray
    if ($modeId -eq 'low') {
        Write-Host "【低階模式特點】" -ForegroundColor Green
        Write-Host "  1. 由 Gemini 3.8 Flash 負責初版規劃，出圖／架構零額度焦慮。"
        Write-Host "  2. Claude Sonnet/Opus 負責奧坎剃刀防過度設計複審。"
        Write-Host "  3. GPT-5.6-Sol 降為二線後備（僅在 Claude 額度不足時接手），省 85%+ 額度。"
        Write-Host "  4. 全隊解鎖高階推理，日常寫入以 medium 推進，上限收斂至 high。"
    } else {
        Write-Host "【高階模式特點】" -ForegroundColor Magenta
        Write-Host "  1. 由 GPT-5.6-Sol 負責全域深度架構規劃。"
        Write-Host "  2. Claude Sonnet 4.6 負責外部反思複審。"
        Write-Host "  3. Worker Luna 鎖定 high 推理，支援 xhigh / max 高難度診斷。"
        Write-Host "  4. 適用於 ASTRA 額度充足、重大資安／金流架構改動。"
    }
    Write-Host "=================================================" -ForegroundColor Cyan
}

if ($Status -or $Mode -in @('status', 'current', 'info', '')) {
    Show-AiTeamStatus -Path $targetPath
    exit 0
}

$targetMode = if ($Mode -in @('high', '高階')) { 'high' } else { 'low' }
$sourceFile = if ($targetMode -eq 'high') { $highTemplate } else { $lowTemplate }

if (-not (Test-Path -LiteralPath $sourceFile)) {
    throw "找不到範本檔: $sourceFile"
}

Copy-Item -LiteralPath $sourceFile -Destination $targetPath -Force
Write-Host "`n>> 切換成功！已載入: $sourceFile -> $targetPath`n" -ForegroundColor Green
Show-AiTeamStatus -Path $targetPath
