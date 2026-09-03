---
name: ai-team-lite
description: 使用原生 Codex 子代理、Lite 狀態與可選 AGY／Luna 協作，持續推進 CelebrateDeal 長程 Goal。
---

# AI Team Lite Autonomous Workflow

CelebrateDeal 目前是尚未對外營運的專案，採長程 `PRELAUNCH_DEV_AUTONOMOUS`。Goal 可以連續處理多個 Work Package，不受固定 30～90 分鐘、固定角色順序或完成後停止限制。

- 主代理負責整合、價值排序與最終判斷。
- Sol、一般 Worker／Luna、Worker Deep／Terra、Reviewer／Terra、AGY Fast、AGY Deep 與 native Luna 唯讀升級可依工作內容協作。
- 一般實作固定由 `gpt-5.6-luna` 的 Worker 以 `max` 執行；複雜跨檔工作由 Worker Deep／Terra 負責，Reviewer 固定使用 Terra read-only。
- Explorer／Analyst 預設走 AGY 唯讀路徑；任務達到 `complex`／`critical` 時，可視情況升級至 `gpt-5.6-luna` read-only。
- Sol 的 complex／critical plan 可選擇一次 Claude Sonnet 4.6 thinking advisory review；額度不足時跳過並如實記錄。
- 推理程度採 `adaptive_lowest_sufficient`：Sol `low`～`xhigh`、Terra `low`～`xhigh`、Luna `high`～`max`。一般工作使用中間值；`low`、`xhigh`、`max` 只在任務難度真的落在該端點時使用。其他模型維持既有設定。
- 不相交的檔案、資料資源與唯讀工作可以並行；同一檔案或資源同一時間只允許一個 writer。
- 可自動從 Fast → Deep → Luna fallback，但每層結果必須如實記錄，不能把工具錯誤標成 PASS。
- 可使用本機、loopback、disposable、Preview、staging、sandbox、Docker、Browser 與 PayUni Sandbox；不需要每個 WP 都執行全部測試或建立完整 handoff。
- 允許精確 scope 的本地 checkpoint commit；可自動 push 到 `codex/*` 分支，並只透過受保護 PR 自動 merge；Production deploy 仍需人工核准。

## 永遠有效的安全底線

- 不讀取、輸出或傳送 `.env*`、密碼、Token、Cookie、私鑰、正式 Secret、正式客戶資料或付款資料。
- 不操作正式資料庫、正式付款、正式退款、正式寄信或其他正式服務；Production deployment 必須另外明確授權。
- 不執行未核准的破壞性 migration、資料刪除、廣域 Docker cleanup 或不可逆外部操作。
- 不偽造 evidence，不把未執行、失敗、timeout 或登入阻擋的測試標成 `PASS`。
- 不降低 assertion、coverage threshold 或資料驗證強度；不得用 skip、exclude、刪資料或假 fixture 掩蓋失敗。
- 保留使用者既有變更；不得使用 `reset`、`clean`、`stash`、`restore`、`checkout`、`rebase` 丟棄未知變更。
- 外部與 disposable 操作必須最小 scope、可回滾、可清理並保存 sanitized evidence。

## 執行原則

- 先選擇最能推進產品功能、安全或上線證據的動作，再決定代理與測試。
- Coverage 失敗是品質訊號，不自動阻擋功能測試或 E2E；threshold 仍不得降低。
- 同一根因或命令沒有改善時停止該路徑，改用不同診斷或下一個高價值工作，不停止整個 Goal。
- checkpoint 記錄實際結果、證據、回滾與下一步；角色或風險改變時才需要完整 handoff。
