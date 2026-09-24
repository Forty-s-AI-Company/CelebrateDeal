# AI Team Workflow Policy

本文件是 CelebrateDeal 的 canonical policy。專案目前處於尚未對外營運的 `PRELAUNCH_DEV_AUTONOMOUS`，目標是快速完成產品功能，再補足品質與上線證據。流程應服務產品價值，不應把工作切碎成無限等待。

## 自主長程 Goal

- 一個 Goal 可以連續處理多個 Work Package、Milestone 與修復輪次。
- Goal 建立後，主代理可依 value-ranked roadmap 自動選擇、實作、驗證並接續下一項。
- Planner 不再受「一次、30～90 分鐘、完成後停止」限制；只有 scope、風險、授權或架構改變時才重新規劃。
- 主代理具備 Direct Autonomous 端到端直通模式，可直接規劃、實作、自測並建立 checkpoint commit。
- 日常 70% 任務（UI、文案、簡單 Bug）通過本地 `typecheck` 與 targeted tests 即可交付，直接跳過 AI 複審以極限節省 Token 額度。
- 高風險 review 依 vNext `review_plan` 路由：Gemini 先做廣域 candidate scan，Sonnet 做深度判斷；Critical security/payment/auth 直接使用 Opus 或其明確 Codex fallback。Review 不得因固定階梯而跳過必要審查。
- 一般模型由 `.ai-team/config/routing-policy.json` 的 `MODEL_ROUTING` 按任務 signals 選擇：清楚的小中型工程優先 GPT-6 Luna high，困難整合與推理使用 GPT-6 Sol medium/high；GPT-6 Astra 需具體例外理由。
- Explorer／Analyst 是唯讀邏輯職位，實際模型由 router 選擇；agy 只在需要且 discovery 成功時使用，未登入時走 native fallback。
- 推理程度由 complexity/risk/role 決定，不能把所有 Worker 固定成 Luna high/max，也不能因 Pro invocation 固定使用 Astra。
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
- 上述非 Production 開發與驗證不需要逐次 owner authorization、一次性 probe 或沿用舊 Work Package 的 attempt budget；固定 runner 自己必須驗證環境分類、host allowlist、資料隔離與必要設定。
- 允許 Preview／staging deploy、環境驗證與 rollback rehearsal；不得把它們誤標成 Production readiness。
- 允許使用 synthetic data、mock boundary、deterministic tests、integration tests 與真實 sandbox reconciliation。
- 測試命令依產品風險與價值選擇，不強制每個 WP 都執行完整 test suite。
- Coverage threshold 維持既有值，但 coverage 失敗不再自動阻擋功能測試或 E2E；報告中必須清楚區分功能失敗、品質 gate 失敗與 schema drift。
- E2E 可在功能測試與環境身份可驗證後執行；不必等待 coverage gate。
- AGY 是輔助 evidence，不能取代 deterministic tests、功能驗證或正式人工簽核。
- Claude plan review 是 advisory evidence，額度不足、登入阻擋或工具錯誤必須如實記錄，不得標成 PASS。
- 歷史 evidence 與 WP packet 保留原始結果，但其中的 no-rerun、single-attempt、waiting-authorization 或特定 lineage 規則不會自動限制新的非 Production 工作。

## AGY fallback

- 重要產品／安全／release 工作先由 router 選擇適合的 reviewer；需要 agy 時只做一次 bounded discovery，依實際 slug 呼叫。
- Provider 狀態必須保存 `PASS`、`TOOL_BLOCKED`、`LOGIN_REQUIRED` 或 `FALLBACK_HANDOFF_REQUIRED`；agy 不可用時 Codex fallback 仍可完成必要 native handoff。
- 允許有限 fallback；禁止對同一失敗命令無限重試，且 routing 與 fallback 必須分開記錄。

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

## vNext router gates

`PRELAUNCH_DEV` 仍遵守 `RELEASE_HARDENING` 的 Production 邊界。`UNKNOWN = 0` 不成立：未知 quota 不可當成耗盡或可用。任務邊界使用 `NEXT_TASK_REQUIRED`、`PLAN_REMEDIATION`、`CONTINUE_CURRENT_WP`、`USER_AUTHORIZATION_REQUIRED` 與 `MIXED_HUNKS` 明確表示。相同工作最多 3 輪修正、最多 2 次外部模型 attempt、最多 8 個候選 agents；實際 vNext policy 另限制每 task 4 次 dispatch、child depth 1、active agents 2，並以 sanitized self-hash／evidence 保存決策。

agy failure 必須保留實際分類：`AUTH_REQUIRED`、`HOST_PERMISSION_BLOCKED`、`AGY_NOT_INSTALLED`、`MODEL_UNAVAILABLE` 或 `AGY_RUNTIME_ERROR`。Host-side 已驗證登入時，Codex sandbox 的 Access Denied 屬於 `HOST_PERMISSION_BLOCKED`／`HOST_AUTH_CONTEXT_UNAVAILABLE`，不等於要求重新登入；所有分類都仍走適當的 Codex fallback。
