# AI Team Autonomous Architecture

主代理是整合者與最終驗收者，但不再限制固定模型、固定角色順序或固定 Work Package 邊界。

| 能力 | 可用角色 | 說明 |
| --- | --- | --- |
| scan／planning | Terra、Sol、Analyst | 可連續重規劃，不必每次停止 |
| implementation | Terra、Worker、Worker Deep | 以檔案／資源 ownership 避免 writer 衝突 |
| tests／coverage | Terra、Worker | 依產品價值選 targeted、integration 或 full run |
| QA／browser／E2E | AGY Fast、AGY Deep、Luna、Terra | 可在功能與環境證據具備後執行 |
| security／acceptance | Reviewer、Sol、主代理 | 產出可追溯結論，不取代 deterministic evidence |
| control plane | 主代理與已核准協作者 | 更新 goal、checkpoint、evidence 與 local commit |

## 並行規則

不相交的檔案、資料表、container 或外部 sandbox 可以並行；同一資源同一時間只允許一個 writer。所有既有使用者變更必須保留。

## 安全規則

任何角色都不得讀取或輸出 `.env*`、Token、Cookie、私鑰、正式 Secret、正式客戶資料或付款資料；不得操作正式 DB、Production、真實付款、未授權破壞性 migration 或 destructive Git。工具錯誤與未執行測試必須如實記錄。
