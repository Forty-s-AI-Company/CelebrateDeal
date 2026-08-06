# AI Team Lite Troubleshooting

## MCP 沒有載入

確認 `.codex/config.toml` 的 `ai_team_router` command、args、cwd、env 路徑，以及專案 venv 存在。完整重開 Codex Desktop 後，用 `router_status` 驗證；它只讀設定，不會啟動外部程序。

## AGY 未登入或沒有輸出

先在專案目錄執行 `agy --version`、`agy models`、`agy --help`。再以 Fast 或 Deep wrapper 傳送最小唯讀 prompt。wrapper 回傳 `LOGIN_REQUIRED` 時需由使用者登入；`TOOL_BLOCKED` 時最多保留兩次嘗試證據，改由 `Invoke-AiTeamReadOnlyFailover.ps1` 依核准 chain 產生 sanitized fallback receipt，或交由 Terra／專案測試繼續。Luna 只回傳 `FALLBACK_HANDOFF_REQUIRED` metadata；不得在 PowerShell 或 MCP 中啟動 Luna。

## 子代理模型不可用

不得靜默改模型。記錄 unavailable、實際 fallback chain 與每次嘗試；Gemini fallback 受全鏈總嘗試上限約束。若需要 Luna，記錄 `FALLBACK_HANDOFF_REQUIRED`，由主代理在核准的 native-agent runtime 以 read-only 方式接手；不由 wrapper、MCP 或 PowerShell 啟動。

## Goal 恢復

呼叫 `goal_get_state` 與 `goal_resume`。若 state 不存在，建立新的單一工作包；若 state 已有未完成 phase，從它繼續並保留既有 checkpoint。

## Fast → Deep → Luna fallback

重要產品／安全／release Work Package 的 AGY QA 若 Fast 兩次都沒有 structured verdict（例如 `FIRST_OUTPUT_TIMEOUT` 或 `TOOL_BLOCKED`），才使用核准 failover wrapper 做一次 bounded Deep 唯讀審查。Deep 仍無法使用時記錄 `FALLBACK_HANDOFF_REQUIRED`，由主代理交給核准的 native-agent Luna read-only runtime；不可由 PowerShell、MCP 或 wrapper 自動啟動 Luna。每層都要保存 sanitized receipt，不得把沒有輸出或工具錯誤標成 PASS，也不得在 `LOOP_DETECTED` 後繼續重試。
