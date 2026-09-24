---
name: ai-team
description: CelebrateDeal 的 Standard 相容入口；依共享 vNext router 執行日常正式工程。
---

# AI Team Standard

這是 thin adapter，不保存自己的模型或 review 階梯。開始前讀取 `.ai-team/config/routing-policy.json`、`docs/ai-team/ROUTING.md` 與 `docs/ai-team/handoff-schema.md`。

以 `requested_team=ai-team` 呼叫既有 `route_task` 或 `.ai-team/scripts/Invoke-AiTeamTask.ps1`。Standard 可使用 GPT-6 Luna、GPT-6 Sol、Gemini Flash Medium/High 與已驗證的 Sonnet；由 router 依任務與證據選最低足夠模型。規格清楚的中型工程先用 Luna high，困難整合用 Sol medium/high；不要無條件啟動所有角色。

Gemini 只回報 candidate findings；Sonnet 做深度 review；重大安全、金流、Auth、Migration 或資料完整性決策依 review plan 升級。Reviewer 不直接修改程式碼。

不要自行 spawn、遞迴呼叫 AI Team 或複製 fallback。`AI_TEAM_CHILD=1`、`parent_depth>0`、dispatch budget 用盡、agy unavailable 或 Host permission failure 都依共享 policy 記錄並走 Codex fallback。

路由、handoff、模型回應或測試自述都不是 READY；交付前以 MCP `assess_task` 檢查同一 snapshot 的執行、必要測試與 review 收據。
