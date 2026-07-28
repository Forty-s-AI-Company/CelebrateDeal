---
name: ai-team-lite
description: 使用原生 Codex 子代理、Lite 狀態 MCP 與直接 AGY Gemini wrapper 的安全協作規則。
---

# AI Team Lite

Codex Desktop 主代理是唯一決策與驗收者。`route_task` 只提供路由建議；它不會執行任何工作。

- `/goal` 主代理必須是 `gpt-5.6-terra`／High，一次只處理一個 30～90 分鐘工作包。
- Planner 是 `gpt-5.6-sol`／High／唯讀，只規劃一次後停止。
- Explorer、Analyst、Reviewer 保持唯讀；Worker 與 Worker Deep 是唯一可寫角色，且同時只能有一個。
- Gemini Fast 與 Deep 只能由明確 PowerShell wrapper 呼叫。外部工具最多兩次，失敗標記 `TOOL_BLOCKED`。
- checkpoint 保存於 `.ai-team/state/goal-state.json`；每個可驗收 phase 後更新 checkpoint 與證據。
- 不讀取或傳送憑證、Token、金鑰或正式客戶資料；不自動 merge、push、部署或操作正式資料。
