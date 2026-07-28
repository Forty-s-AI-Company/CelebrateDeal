# AI Team Lite Troubleshooting

## MCP 沒有載入

確認 `.codex/config.toml` 的 `ai_team_router` command、args、cwd、env 路徑，以及專案 venv 存在。完整重開 Codex Desktop 後，用 `router_status` 驗證；它只讀設定，不會啟動外部程序。

## AGY 未登入或沒有輸出

先在專案目錄執行 `agy --version`、`agy models`、`agy --help`。再以 Fast 或 Deep wrapper 傳送最小唯讀 prompt。wrapper 回傳 `LOGIN_REQUIRED` 時需由使用者登入；`TOOL_BLOCKED` 時最多保留兩次嘗試證據，改由 Terra 或專案測試繼續。

## 子代理模型不可用

不得靜默改模型。記錄 unavailable，並由主代理接手或請使用者調整可用模型。

## Goal 恢復

呼叫 `goal_get_state` 與 `goal_resume`。若 state 不存在，建立新的單一工作包；若 state 已有未完成 phase，從它繼續並保留既有 checkpoint。
