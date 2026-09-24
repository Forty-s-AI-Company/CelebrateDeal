---
name: ai-team-pro
description: CelebrateDeal 的 Pro 相容入口；提供最高能力上限，但仍由 vNext router 動態選擇模型。
---

# AI Team Pro

這是 thin adapter，不代表每次都啟動 Astra、Opus 或所有角色。開始前讀取 `.ai-team/config/routing-policy.json`、`docs/ai-team/ROUTING.md` 與 `docs/ai-team/handoff-schema.md`。

以 `requested_team=ai-team-pro` 呼叫既有 `route_task` 或 `.ai-team/scripts/Invoke-AiTeamTask.ps1`。Pro 開放全部模型，但簡單 copy/UI 仍應選 Luna；Astra 只有具體 `astra_reason` 才會選用；Critical review 依 review plan 使用 Opus 或 Codex fallback。

不要固定角色順序、複製 fallback 表、直接修改 reviewer finding、spawn 未授權 Agent 或遞迴呼叫 AI Team。遵守 `max_agent_depth`、`max_parallel_agents`、`max_dispatches_per_task` 與 automatic spawn=false，保留完整 sanitized handoff 與測試證據。

路由、handoff、模型回應或測試自述都不是 READY；交付前以 MCP `assess_task` 檢查同一 snapshot 的執行、必要測試與 review 收據。
