# AI Team Troubleshooting

## MCP、模型或工具不可用

記錄實際錯誤與 sanitized 摘要，然後自動改用可用模型、deterministic tests 或 Terra 本地診斷。不要因單一工具無法啟動而停止整個 Goal。

## AGY fallback

AGY 可依序 Fast → Deep → native Luna。每層都必須如實標記 `PASS`、`TOOL_BLOCKED`、`LOGIN_REQUIRED` 或 `FALLBACK_HANDOFF_REQUIRED`，不能把沒有輸出寫成 PASS。對同一失敗命令不得無限重試；改用不同診斷或繼續其他產品工作。

## Goal 恢復與連續推進

讀取目前 Goal state 與最後 checkpoint，從未完成的最高價值工作繼續。不要建立不必要的新 Task，也不要因完成一個 WP 就停止長程 Goal。

## 外部／staging／sandbox 阻擋

若需要 Preview、staging、sandbox、disposable DB、Browser 或 PayUni Sandbox，可在非 Production 且 scope 明確時繼續。若需要正式 Secret、正式 DB、真實付款、Production 或不可逆操作，才停下要求授權。

## 安全底線

任何診斷都不得讀取或輸出 `.env*`、Token、Cookie、正式 Secret、正式客戶資料或付款資料；不得偽造 evidence、虛報 PASS、降低 assertion／threshold、用 skip／exclude 掩蓋失敗，或使用 destructive Git。
