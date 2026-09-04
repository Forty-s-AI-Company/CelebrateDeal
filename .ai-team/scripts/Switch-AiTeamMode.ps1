[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [ValidateSet('high', 'low', '高階', '低階', '高階模式', '低階模式', 'ai-team', 'ai-team-lite', 'list', '清單', 'status', 'current', 'info')]
    [string]$Mode = '',
    [switch]$Status,
    [switch]$List
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

function Get-AiTeamDetails {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $cfg = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $modeKey = if ($cfg.active_mode) { [string]$cfg.active_mode } else { 'low' }
    $isHigh = ($modeKey -in @('high', 'ai-team', '高階'))
    return [pscustomobject]@{
        Name = if ($isHigh) { "高階模式 (ai-team)" } else { "低階模式 (ai-team-lite)" }
        Id = if ($isHigh) { "ai-team" } else { "ai-team-lite" }
        Chinese = if ($isHigh) { "高階模式" } else { "低階模式" }
        Planner = [string]$cfg.agents.planner.model
        Review = @($cfg.plan_review.fallback_chain | ForEach-Object {
            if ($_.profile) { "$($_.profile) ($($_.model))" } else { "skip_review" }
        }) -join " -> "
        Worker = "$($cfg.agents.worker.model) (預設: $($cfg.agents.worker.reasoning_effort))"
        WorkerLock = if ($cfg.agents.worker.PSObject.Properties['reasoning_lock']) { [string]$cfg.agents.worker.reasoning_lock } else { "無鎖定 (動態 low~high)" }
        WorkerDeep = "$($cfg.agents.'worker-deep'.model) ($($cfg.agents.'worker-deep'.reasoning_effort))"
        Reviewer = "$($cfg.agents.reviewer.model) ($($cfg.agents.reviewer.reasoning_effort), read-only)"
        Explorer = "$($cfg.agents.explorer.model)"
        Analyst = "$($cfg.agents.analyst.model)"
        Raw = $cfg
    }
}

function Show-AiTeamList {
    $current = Get-AiTeamDetails -Path $targetPath
    $currentId = if ($current) { $current.Id } else { "unknown" }

    Write-Host "`n==================================================================================" -ForegroundColor Cyan
    Write-Host "                CelebrateDeal AI TEAM 完整清單 (Dual Team Roster)" -ForegroundColor Cyan
    Write-Host "==================================================================================" -ForegroundColor Cyan
    Write-Host "目前生效中的團隊: " -NoNewline
    if ($currentId -eq 'ai-team-lite') {
        Write-Host "$($current.Name) ★" -ForegroundColor Green
    } else {
        Write-Host "$($current.Name) ★" -ForegroundColor Magenta
    }
    Write-Host "----------------------------------------------------------------------------------" -ForegroundColor DarkGray

    # 1. 低階模式 ai-team-lite
    Write-Host "【1】低階模式 ⇋ ai-team-lite" -ForegroundColor Green -NoNewline
    if ($currentId -eq 'ai-team-lite') { Write-Host " [目前運行中 ACTIVE]" -ForegroundColor Yellow } else { Write-Host "" }
    Write-Host "  * 英文名稱: ai-team-lite  |  中文名稱: 低階模式 / 省額度模式" -ForegroundColor Gray
    Write-Host "  * 主規劃端 (Planner)  : gemini-3.8-flash-high (出圖出架構零焦慮、百萬 Context)"
    Write-Host "  * 審查階梯 (Review)   : Claude Sonnet/Opus -> Sol (medium, 二線後備省85%+額度) -> Gemini Flash -> Skip"
    Write-Host "  * 一般實作 (Worker)   : gpt-5.6-luna (解除鎖定，依難度自適應 low ~ high，routine 採 medium)"
    Write-Host "  * 困難診斷 (Deep)     : gpt-5.6-terra (high)"
    Write-Host "  * 安全審核 (Reviewer) : gpt-5.6-terra (medium, read-only)"
    Write-Host "  * 唯讀探索 (Explorer) : gemini-3.8-flash-high (可升級 Luna read-only)"
    Write-Host "  * 適用情境: ASTRA 額度吃緊、日常 UI/CRUD 功能迭代、極限省高階 Token"
    Write-Host "  * 切換語法: " -NoNewline
    Write-Host "請使用 ai team 低階模式" -ForegroundColor Cyan -NoNewline
    Write-Host "  或  " -NoNewline
    Write-Host "use ai-team-lite" -ForegroundColor Cyan

    Write-Host "`n----------------------------------------------------------------------------------" -ForegroundColor DarkGray

    # 2. 高階模式 ai-team
    Write-Host "【2】高階模式 ⇋ ai-team" -ForegroundColor Magenta -NoNewline
    if ($currentId -eq 'ai-team') { Write-Host " [目前運行中 ACTIVE]" -ForegroundColor Yellow } else { Write-Host "" }
    Write-Host "  * 英文名稱: ai-team  |  中文名稱: 高階模式 / 標準模式" -ForegroundColor Gray
    Write-Host "  * 主規劃端 (Planner)  : gpt-5.6-sol (端到端全域高階架構深度規劃)"
    Write-Host "  * 審查階梯 (Review)   : Claude Sonnet 4.6 (thinking) -> Gemini Flash -> Terra -> Skip"
    Write-Host "  * 一般實作 (Worker)   : gpt-5.6-luna (鎖定 high 推理，支援 xhigh/max 升級)"
    Write-Host "  * 困難診斷 (Deep)     : gpt-5.6-terra (high)"
    Write-Host "  * 安全審核 (Reviewer) : gpt-5.6-terra (high, read-only)"
    Write-Host "  * 唯讀探索 (Explorer) : gemini-3.8-flash-high (可升級 Luna read-only)"
    Write-Host "  * 適用情境: ASTRA 額度充足、重大資安／金流架構改版、頂級大腦深度思考"
    Write-Host "  * 切換語法: " -NoNewline
    Write-Host "請使用 ai team 高階模式" -ForegroundColor Cyan -NoNewline
    Write-Host "  或  " -NoNewline
    Write-Host "use ai-team" -ForegroundColor Cyan

    Write-Host "==================================================================================`n" -ForegroundColor Cyan
}

function Show-AiTeamStatus {
    $curr = Get-AiTeamDetails -Path $targetPath
    if (-not $curr) {
        Write-Error "找不到設定檔: $targetPath"
        return
    }

    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "   CelebrateDeal AI Team 當前配置狀態" -ForegroundColor Cyan
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "目前模式: $($curr.Name)" -ForegroundColor Yellow
    Write-Host "主規劃端: $($curr.Planner)"
    Write-Host "審查階梯: $($curr.Review)"
    Write-Host "一般工作: $($curr.Worker)"
    Write-Host "推理鎖定: $($curr.WorkerLock)"
    Write-Host "深度除錯: $($curr.WorkerDeep)"
    Write-Host "安全審核: $($curr.Reviewer)"
    Write-Host "-------------------------------------------------" -ForegroundColor Gray
    if ($curr.Id -eq 'ai-team-lite') {
        Write-Host "【低階模式特點 (ai-team-lite)】" -ForegroundColor Green
        Write-Host "  1. 由 Gemini 3.8 Flash 負責初版規劃，出圖／架構零額度焦慮。"
        Write-Host "  2. Claude Sonnet/Opus 負責奧坎剃刀防過度設計複審。"
        Write-Host "  3. GPT-5.6-Sol 降為二線後備（僅在 Claude 額度不足時接手），省 85%+ 額度。"
        Write-Host "  4. 全隊解鎖高階推理，日常寫入以 medium 推進，上限收斂至 high。"
    } else {
        Write-Host "【高階模式特點 (ai-team)】" -ForegroundColor Magenta
        Write-Host "  1. 由 GPT-5.6-Sol 負責全域深度架構規劃。"
        Write-Host "  2. Claude Sonnet 4.6 負責外部反思複審。"
        Write-Host "  3. Worker Luna 鎖定 high 推理，支援 xhigh / max 高難度診斷。"
        Write-Host "  4. 適用於 ASTRA 額度充足、重大資安／金流架構改動。"
    }
    Write-Host "=================================================" -ForegroundColor Cyan
}

if ($List -or $Mode -in @('list', '清單')) {
    Show-AiTeamList
    exit 0
}

if ($Status -or $Mode -in @('status', 'current', 'info', '')) {
    Show-AiTeamStatus
    exit 0
}

$isHighTarget = ($Mode -in @('high', '高階', '高階模式', 'ai-team'))
$sourceFile = if ($isHighTarget) { $highTemplate } else { $lowTemplate }

if (-not (Test-Path -LiteralPath $sourceFile)) {
    throw "找不到範本檔: $sourceFile"
}

Copy-Item -LiteralPath $sourceFile -Destination $targetPath -Force

# 同步專案 .codex/config.toml 與 .codex/agents/worker.toml，確保 Codex 原生執行環境 100% 一致
$localCodexConfig = Join-Path $repoRoot '.codex/config.toml'
$workerAgentToml = Join-Path $repoRoot '.codex/agents/worker.toml'

if (Test-Path -LiteralPath $localCodexConfig) {
    $rawConfig = Get-Content -LiteralPath $localCodexConfig -Raw
    $targetEffort = if ($isHighTarget) { "high" } else { "medium" }
    $updatedConfig = $rawConfig `
        -replace '(?m)^#?model\s*=.*', 'model = "gpt-5.6-luna"' `
        -replace '(?m)^#?model_reasoning_effort\s*=.*', "model_reasoning_effort = `"$targetEffort`""
    $updatedConfig | Set-Content -LiteralPath $localCodexConfig -Encoding utf8
}

if (Test-Path -LiteralPath $workerAgentToml) {
    $rawWorker = Get-Content -LiteralPath $workerAgentToml -Raw
    $targetWorkerEffort = if ($isHighTarget) { "high" } else { "medium" }
    $updatedWorker = $rawWorker -replace '(?m)^model_reasoning_effort\s*=.*', "model_reasoning_effort = `"$targetWorkerEffort`""
    $updatedWorker | Set-Content -LiteralPath $workerAgentToml -Encoding utf8
}

Write-Host "`n>> 切換成功！已同步更新 router.json 與 .codex 設定`n" -ForegroundColor Green
Show-AiTeamStatus
