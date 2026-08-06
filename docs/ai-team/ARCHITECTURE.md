# AI Team Lite v5.4 Architecture

Codex Desktop 的 `gpt-5.6-terra`／High 是唯一執行主體與最終整合者。Lite MCP 不啟動模型、命令列、瀏覽器或網路請求。

| 階段 | 角色 | 權限與產出 |
| --- | --- | --- |
| scan | Terra | 唯讀盤點 scope、ownership、風險與 evidence。 |
| plan | Sol | 唯讀、一次性完整可執行計畫與 handoff；不寫 current-work-package 或 Goal state。 |
| implement/tests | Terra | 唯一可寫角色；更新 control plane、實作、deterministic tests 與 evidence。 |
| QA | AGY Fast | 經唯讀 wrapper 的 plan + sandbox QA，最多兩次；預設自動同意 headless 權限提示。 |
| acceptance | Sol | 唯讀 evidence 複審，僅 `ACCEPT`／`CONTINUE_CURRENT_WP`／`PLAN_REMEDIATION`。 |
| finalize | 主代理 | 僅在 Sol `ACCEPT` 後 checkpoint、驗證 handoff、Git diff/status 與 finalize。 |

`ai_team_router` 僅提供固定 recommendation 路由與本機 Goal state，不執行任務、不連網、不讀取憑證，也不修改產品程式碼或 Git。

AGY 只能透過 `.ai-team/scripts/Invoke-AgyFast.ps1` 或 `Invoke-AgyDeep.ps1` 被明確呼叫。Fast QA wrapper 預設 plan、sandbox 與自動同意 headless 權限提示，固定模型／High、最多兩次；失敗回傳 `TOOL_BLOCKED` 或 `LOGIN_REQUIRED`，不會取代 deterministic tests。

對重要產品／安全／release Work Package，Fast 兩次均無 structured verdict 後，才可經核准 failover wrapper 進行一次 bounded Deep 唯讀審查；Deep 仍不可用時只產生 `FALLBACK_HANDOFF_REQUIRED`，由 native-agent Luna 接手。Luna 不由 PowerShell、MCP 或 wrapper 自動啟動，任何層級都不能取代 deterministic tests 或 Sol acceptance。
