---
name: ai-team-lite
description: CelebrateDeal 的 Lite 相容入口；依共享 vNext router 執行低成本、低風險任務。
---

# AI Team Lite

這是 thin adapter，不保存自己的模型階梯。開始前讀取：

- `.ai-team/config/routing-policy.json`
- `docs/ai-team/ROUTING.md`
- `docs/ai-team/handoff-schema.md`

以 `requested_team=ai-team-lite` 呼叫既有 `route_task` 或
`.ai-team/scripts/Invoke-AiTeamTask.ps1`。Router 依 task signals 選擇最低足夠模型：Lite 可使用 GPT-6 Luna 與已確認的 Gemini Flash Medium；能由單一 Agent 完成時不要啟動其他 Agent。硬性資源上限不可自動越界；Critical 或超出 Lite 能力時回傳阻擋或有理由的升級建議。

目前 Codex Desktop 的 PowerShell MCP 接點停用時，由主對話使用現有 Python `route_cli.py` 的 `snapshot`／`route`，明示 resolved model/effort 執行原生 `codex.exe`；再由同一 adapter 的 `record_native_execution` 核對 JSONL 終態與限定檔案，交給 `validation_runner.py` 執行必要檢查，最後呼叫 `assess_acceptance`。這是同一個 routing／gate；CLI 執行完成本身仍不是 READY。

不要固定 Planner、Worker、Reviewer 模型，不要複製 fallback 表，不要自行 spawn 或呼叫 AI Team。`AI_TEAM_CHILD=1`、`parent_depth>0` 或 dispatch budget 用盡時立即停止並保留 receipt。

遵守根目錄 `AGENTS.md` 的安全規則、單一 writer、sanitized evidence 與測試要求。外部 agy unavailable、quota exhausted 或 Host permission failure 都回到共享 Codex fallback。

路由、handoff、模型回應或測試自述都不是 READY；交付前以 MCP `assess_task` 檢查同一 snapshot 的執行、必要測試與 review 收據。
