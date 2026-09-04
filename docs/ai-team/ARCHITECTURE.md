# AI Team Autonomous Architecture

主代理是整合者與最終驗收者，但不再限制固定模型、固定角色順序或固定 Work Package 邊界。

| 能力 | 可用角色 | 說明 |
| --- | --- | --- |
| scan／planning | AGY Fast、AGY Deep、Sol、Explorer、Analyst | Explorer／Analyst 預設唯讀；complex／critical 時可升級 Luna read-only |
| implementation | Worker／Luna high、Worker Deep／Terra high | 一般實作由 Worker 使用 `gpt-5.6-luna high`；複雜跨檔與困難診斷由 Worker Deep 使用 Terra |
| tests／coverage | Worker／Luna、Worker Deep／Terra | 依產品價值選 targeted、integration 或 full run |
| QA／browser／E2E | AGY Fast、AGY Deep、Luna、Terra | AGY Fast 使用 `gemini-3.8-flash-high`，可在功能與環境證據具備後執行 |
| plan review | Claude Sonnet 4.6 thinking、Reviewer、Sol | Claude 只作可選 advisory review；額度不足可跳過 |
| security／acceptance | Reviewer、Sol、主代理 | Reviewer 必須 read-only；產出可追溯結論，不取代 deterministic evidence |
| control plane | 主代理與已核准協作者 | 更新 goal、checkpoint、evidence、local commit，以及受保護 PR 的 push／merge |

## 並行規則

不相交的檔案、資料表、container 或外部 sandbox 可以並行；同一資源同一時間只允許一個 writer。所有既有使用者變更必須保留。

一般 Worker 使用 Luna high 並維持 workspace-write；Worker Deep 使用 Terra high。Explorer／Analyst 的 Luna 升級維持 read-only，不能取得寫入權限或取代 deterministic evidence。

## 安全規則

任何角色都不得讀取或輸出 `.env*`、Token、Cookie、私鑰、正式 Secret、正式客戶資料或付款資料；不得操作正式 DB、Production、真實付款、未授權破壞性 migration 或 destructive Git。工具錯誤與未執行測試必須如實記錄。

Git 可自動 push `codex/*` 分支並透過受保護 PR merge；Production deploy 仍維持獨立 workflow 與人工核准，不能由 merge 自動觸發。
