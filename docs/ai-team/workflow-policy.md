# AI Team Workflow Policy

本文件是 CelebrateDeal 的 canonical policy。專案目前處於尚未對外營運的 `PRELAUNCH_DEV_AUTONOMOUS`，目標是快速完成產品功能，再補足品質與上線證據。流程應服務產品價值，不應把工作切碎成無限等待。

## 自主長程 Goal

- 一個 Goal 可以連續處理多個 Work Package、Milestone 與修復輪次。
- Goal 建立後，主代理可依 value-ranked roadmap 自動選擇、實作、驗證並接續下一項。
- Planner 不再受「一次、30～90 分鐘、完成後停止」限制；只有 scope、風險、授權或架構改變時才重新規劃。
- 主代理具備 Direct Autonomous 端到端直通模式，可直接規劃、實作、自測並建立 checkpoint commit。
- 日常 70% 任務（UI、文案、簡單 Bug）通過本地 `typecheck` 與 targeted tests 即可交付，直接跳過 AI 複審以極限節省 Token 額度。
- 高風險任務啟動四級審查降級鏈（Review Fallback Ladder）：Tier 1 Claude Sonnet 4.6（反過度設計）→ Tier 2 Gemini 3.8 Flash High（零額度焦慮）→ Tier 3 GPT-5.6-Terra medium（客觀嚴謹，不用 Sol 避免發散）→ Tier 4 本地測試防線。
- 一般實作由 `gpt-5.6-luna high` Worker 執行（解除 max 鎖定以節省額度）；複雜跨檔或困難診斷由 `gpt-5.6-terra` Worker Deep 執行，Reviewer 固定使用 Terra read-only。
- Explorer／Analyst 預設維持 AGY 唯讀路徑；`complex`／`critical` 任務可升級至 Luna read-only。
- 推理程度動態選擇，採最低足夠成本：Sol `low`～`xhigh`、Terra `low`～`xhigh`、Luna `high`～`max`。一般任務使用中間值。
- 只要同一檔案、資料資源或外部資源沒有 writer 衝突，不同 scope 可以並行。
- 每個 checkpoint 只需保存精確結果、證據、回滾方式與下一步；不因 checkpoint 自動停止 Goal。

## 安全底線

以下規則永遠有效，任何產品或流程需求都不能覆蓋：

- 不讀取、輸出或傳送 `.env*`、憑證、Token、Cookie、私鑰、正式 Secret、正式客戶資料或付款資料。
- 不操作正式資料庫、正式付款、正式退款、正式寄信或正式服務。Production deployment 需要另外明確授權。
- 不執行未核准的破壞性 migration、資料刪除、廣域 Docker cleanup 或不可逆外部操作。
- 不偽造 evidence，不把未執行或失敗的測試標成 `PASS`。
- 不降低 assertion、coverage threshold 或資料驗證強度；不得用 skip、exclude、刪資料或假 fixture 掩蓋失敗。
- 保留使用者既有變更，不覆蓋未知 ownership。
- 禁止使用 `reset`、`clean`、`stash`、`restore`、`checkout`、`rebase` 或其他丟棄未知變更的 Git 操作。
- 同一檔案或同一資料資源同一時間只允許一個 writer；不同 scope 可以並行。
- 外部、staging、sandbox、disposable 操作必須使用最小 scope，並保存 sanitized、可驗證的 evidence。

## 開發與測試

- 允許本機、loopback、disposable PostgreSQL、Docker、Preview、staging、sandbox、Browser 與 PayUni Sandbox，前提是非 Production、scope 明確且不讀取秘密。
- 允許 Preview／staging deploy、環境驗證與 rollback rehearsal；不得把它們誤標成 Production readiness。
- 允許使用 synthetic data、mock boundary、deterministic tests、integration tests 與真實 sandbox reconciliation。
- 測試命令依產品風險與價值選擇，不強制每個 WP 都執行完整 test suite。
- Coverage threshold 維持既有值，但 coverage 失敗不再自動阻擋功能測試或 E2E；報告中必須清楚區分功能失敗、品質 gate 失敗與 schema drift。
- E2E 可在功能測試與環境身份可驗證後執行；不必等待 coverage gate。
- AGY 是輔助 evidence，不能取代 deterministic tests、功能驗證或正式人工簽核。
- Claude plan review 是 advisory evidence，額度不足、登入阻擋或工具錯誤必須如實記錄，不得標成 PASS。

## AGY fallback

- 重要產品／安全／release 工作可依序使用 AGY Fast → AGY Deep → native Luna。
- Fast、Deep、Luna 均必須如實保存 `PASS`、`TOOL_BLOCKED`、`LOGIN_REQUIRED` 或 `FALLBACK_HANDOFF_REQUIRED`。
- 允許自動 fallback；禁止對同一失敗命令無限重試。若路徑沒有改善，改用不同診斷或重新排序產品工作。

## Git 與 checkpoint

- 允許精確 scope 的本地 checkpoint commit，以降低 dirty inventory。
- 不使用 `git add .`、`git add -A` 或 `git commit -a`；只 stage 明確檔案。
- 可自動 push 到 `codex/*` 分支，並透過受保護 PR 自動 merge；不得 force push、直接 push default branch 或在 merge conflict 下合併。
- Auto-merge 必須等待既定 CI checks 通過；Production deployment 不得由 push／merge 自動觸發，仍需獨立 workflow 與人工 approval。
- 每次修改前記錄 ownership；每次 checkpoint 後執行必要的 diff/status 檢查。
- 回滾只移除本輪明確新增的 hunks、檔案或 disposable 資源，不碰既有使用者變更。

## 上下文效率與快取優化 (Context Efficiency & Prompt Caching)

- 上下文效率是第一級工程約束：預設嚴禁載入或向子代理分發全專案上下文（Repository-Wide Context）。
- 每個子代理或任務只接收嚴格必要的檔案（2~5 檔）、合約與最小驗證資訊；嚴禁無差別廣播全專案歷史。
- 子代理進場前必須宣告 `[Unique Work]` 與 `[Minimum Context]`；主代理能獨立完成的日常 90% 任務一律直通，不開子代理。
- 固定專案規範與前綴保持 100% 穩定，嚴禁插入隨機 ID 或動態時間戳記，最大化 Prompt Cache 命中率。
- 嚴禁盲目 Reset：同一 Goal 內維持 Session 連續以累積 Cache；上下文污染時透過 `goal_checkpoint` 精確接手。

## 迴圈與價值檢查

- 每次工作開始前確認它是否推進重要功能、產品安全或必要上線證據。
- 若同一根因或命令沒有改善，停止該路徑並改走不同方案；不得為了維持流程重複執行。
- `LOOP_DETECTED` 只停止無效路徑，不停止整個長程 Goal；Goal 可自動轉向下一個 value-ranked 工作。

## Handoff 與完成

- 小範圍續修使用精簡 checkpoint；只有角色、scope、風險或 Milestone 改變時才輸出完整 `AI_TEAM_HANDOFF`。
- `NEXT_PROMPT` 只在需要換角色或外部人工動作時提供，不要求每輪複製長 Prompt。
- Goal 完成前不得宣稱所有功能、外部服務或 Production ready；最終分數與 release evidence 必須可追溯。
