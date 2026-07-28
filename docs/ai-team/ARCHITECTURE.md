# AI Team Lite v5.3 Architecture

Codex Desktop 的 `gpt-5.6-terra`／High 是唯一執行主體與最終驗收者。Lite 架構不在 MCP 內啟動模型、命令列、瀏覽器或網路請求。

## 角色

| 角色 | 模型／Effort | 範圍 |
| --- | --- | --- |
| 主代理 | `gpt-5.6-terra`／High | 派工、整合、驗證、最終決策。 |
| Planner | `gpt-5.6-sol`／High | 唯讀的一次性工作包規劃。 |
| Explorer | `gemini-3.6-flash-high`／High | 經 Fast wrapper 進行唯讀找檔與追蹤呼叫。 |
| Analyst | `gemini-3.1-pro-high`／High | 經 Deep wrapper 進行唯讀分析依賴與根因。 |
| Worker | `gpt-5.6-terra`／Medium | 一般正式實作。 |
| Worker Deep | `gpt-5.6-terra`／High | 困難除錯與跨檔實作。 |
| Reviewer | `gemini-3.1-pro-high`／High | 經 Deep wrapper 進行唯讀安全、回歸與測試缺口審查。 |
| Gemini Fast | `gemini-3.6-flash-high`／High | 短摘要、QA、E2E、UI 驗證。 |
| Gemini Deep | `gemini-3.1-pro-high`／High | 深度第二意見與跨檔審查。 |

## MCP 邊界

`ai_team_router` 僅提供固定路由與 Goal state。它不執行任務、不啟動任何外部工具、不連網、不讀取憑證，也不修改產品程式碼或 Git。

AGY 只能透過 `.ai-team/scripts/Invoke-AgyFast.ps1` 或 `Invoke-AgyDeep.ps1` 被明確呼叫。兩支 wrapper 預設 `plan` 與 sandbox、固定模型／High、最多兩次；失敗回傳 `TOOL_BLOCKED`。
