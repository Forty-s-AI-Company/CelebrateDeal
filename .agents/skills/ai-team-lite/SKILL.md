---
name: ai-team-lite
description: 使用原生 Codex 子代理、Lite 狀態 MCP 與直接 AGY Gemini wrapper 的安全協作規則。
---

# AI Team Lite v5.4

Codex Desktop 主代理是唯一決策與驗收者。`route_task` 只提供路由建議；它不會執行任何工作。

- `/goal` 主代理必須是 `gpt-5.6-terra`／High，一次只處理一個 30～90 分鐘工作包。
- Canonical flow 是 Terra scan → Sol 唯讀規劃 → Terra 實作與 deterministic tests → AGY Fast 唯讀 QA → Sol 唯讀 acceptance review → 主代理 checkpoint/finalize。
- Planner 是 `gpt-5.6-sol`／High／唯讀，只規劃一次或做 acceptance review 後停止；不得寫入 current work package 或 Goal state。
- Terra 是 control-plane 與工作區的唯一可寫角色，且同時只能有一個可寫代理。Explorer、Analyst、Worker Deep、Reviewer 與 AGY Deep 均非 canonical 主流程角色；僅在使用者明確要求時作為唯讀輔助證據，且不得形成主流程分支或取得寫入權限。
- AGY Fast 與 Deep 只能由明確 PowerShell wrapper 呼叫。Canonical AGY Fast QA 固定 plan + sandbox、預設自動同意 headless 權限提示、最多兩次；失敗標記 `TOOL_BLOCKED` 或 `LOGIN_REQUIRED`，不得取代 deterministic tests。
- Terra 建立／更新 control plane；checkpoint 保存於 `.ai-team/state/goal-state.json`。Sol acceptance 僅 `ACCEPT`、`CONTINUE_CURRENT_WP` 或 `PLAN_REMEDIATION`；只有 `ACCEPT` 可 finalize。
- 不讀取或傳送憑證、Token、金鑰或正式客戶資料；不自動 merge、push、部署或操作正式資料。
