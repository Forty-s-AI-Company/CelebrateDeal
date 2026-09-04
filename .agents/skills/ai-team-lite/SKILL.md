---
name: ai-team-lite
description: 使用原生 Codex 子代理、Lite 狀態與可選 AGY／Luna 協作，持續推進 CelebrateDeal 長程 Goal。
---

# AI Team Lite Autonomous Workflow

CelebrateDeal 目前是尚未對外營運的專案，採長程 `PRELAUNCH_DEV_AUTONOMOUS`。Goal 可以連續處理多個 Work Package，不受固定 30～90 分鐘、固定角色順序或完成後停止限制。

- 主代理負責整合、價值排序與最終判斷。
- **雙模式配置（Dual Team Modes）**：
  - **低階模式 (`ai-team-lite`)**：由 `gemini-3.8-flash-high` 規劃，Claude Sonnet/Opus 複審（Sol 為 medium 後備），全隊解除推理鎖定，動態在 `low`～`high` 之間調整（routine 採 `medium`）。極致節省高階思考 Token。
  - **高階模式 (`ai-team`)**：由 `gpt-5.6-sol` 深度規劃，Claude Sonnet 4.6 複審，Worker Luna 鎖定 `high` 推理，支援 `xhigh`／`max` 深度診斷。
  - **快速切換與清單調閱**：
    - 切換高階：使用者說「**請使用 ai team 高階模式**」或「**use ai-team**」。
    - 切換低階：使用者說「**請使用 ai team 低階模式**」或「**use ai-team-lite**」。
    - 調閱清單：使用者說「**叫出 ai team 清單**」或「**list ai-team**」，即可執行 `.ai-team/scripts/Switch-AiTeamMode.ps1 -List` 查看完整名冊。
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
