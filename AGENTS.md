# CelebrateDeal Agent Rules

## 回覆與技術風格

- 所有回覆使用自然的繁體中文。
- 修改 Next.js 程式前，先閱讀對應的本機 Next.js 文件。
- 直接推進使用者目標；只有安全、授權或不可驗證的阻擋才停下詢問。

## Autonomous prelaunch mode

CelebrateDeal 目前是尚未對外營運的專案，預設採 `PRELAUNCH_DEV_AUTONOMOUS`：

- 一個長程 Goal 可以連續執行多個 Work Package，不需要每 30～90 分鐘停止。
- Sol、一般 Worker／Luna、Worker Deep／Terra、Reviewer／Terra、AGY 與 Luna 唯讀升級可依工作需要自動協作；不強制每個 WP 都走相同階段。
- 已核准 roadmap 內的下一個 WP 可在 checkpoint 後自動接續。
- Planner 可重新規劃、更新 plan metadata；一般 Worker／Luna 可直接在同一 Goal 內實作與驗證，複雜跨檔工作交給 Worker Deep／Terra。
- 低風險測試、文件、coverage 與本地功能修正可並行；高風險工作才需要額外 acceptance。
- Agent 可以使用本機、loopback、disposable、staging 與 sandbox 資源，只要符合安全底線與明確 scope。
- 允許建立精確 scope 的本地 checkpoint commit；可自動 push 到 `codex/*` 分支，並只透過受保護 PR 自動 merge。
- Production deployment 不得因 push／merge 自動觸發，仍需獨立 workflow 與人工核准。

## 不可放寬的安全底線

- 不讀取、輸出或傳送 `.env*`、密碼、Token、Cookie、私鑰、正式 Secret、正式客戶資料或付款資料。
- 不操作正式資料庫、正式付款、正式退款、正式寄信或其他正式服務；Production deployment 仍需另外明確授權。
- 不執行未核准的破壞性 migration、資料刪除、廣域 Docker cleanup 或不可逆外部操作。
- 不偽造 evidence，不把未執行、失敗或工具阻擋的測試標成 `PASS`。
- 不降低 assertion、coverage threshold、資料驗證強度；不得用 skip、exclude 或刪資料掩蓋失敗。
- 保留所有使用者既有變更；不得覆蓋未知 ownership，也不得使用 `reset`、`clean`、`stash`、`restore`、`checkout` 丟棄工作。
- 同一檔案或資料資源同一時間只允許一個 writer；不同 scope 可並行。
- 所有外部、staging、sandbox 與 disposable 操作必須保存最小化、可驗證的 sanitized evidence。

## Approved secret-aware runner

- Agent 只能觸發已合併至受保護預設分支的
  `.github/workflows/secure-staging-validation.yml`，且只能選擇 workflow
  明列的固定 task；feature branch、未受保護分支或任意 command 不得取得 Secret。
- Agent 可以讀取 sanitized receipt，但不得列舉 GitHub Environment Secrets、
  Secret Store、child-process environment 或 raw logs，也不得執行 `.env*`、
  `vercel env pull`、`vercel env run` 等載入方式。
- Trusted runner 必須先驗證 exact Preview source／deployment lineage，並維持
  fixed-host outbound allowlist、固定 side-effect budget 與 canonical receipt
  validator；任一條件不成立即 fail closed。
- Trusted runner 的加入不授權 Production、正式付款／退款、migration write、
  deployment、alias mutation、資料刪除、force push 或 merge。

## 代理協作與審查機制

- **主代理端到端直通（Direct Autonomous Delivery）**：主代理負責整合與最終判斷，具備直接規劃、編碼、自測與 checkpoint 提交權限，毋須進行多代理強制 handoff。
- **日常任務免複審（Skip Routine Review）**：非重大金流、資安、資料庫 Migration 的日常任務（UI、文案、一般 Bug 修復），跑過本地 `typecheck` 與 targeted tests 即可直接交付，跳過 AI 複審以極限節省額度。
- **高風險任務四級審查降級鏈（Review Fallback Ladder）**：
  1. **Tier 1 首選**：`Claude Sonnet 4.6 thinking` 或 `Claude Opus`（以奧坎剃刀原則審核：嚴禁過度設計、抓真實致命漏洞，防止鑽牛角尖）。
  2. **Tier 2 備選（Claude 額度不足時）**：`GPT-5.6-Sol (medium)`（當 Claude 額度竭盡時由 Sol 接手複審，平時由 Gemini Flash 規劃以節省 Sol 85%+ 額度）。
  3. **Tier 3 備選（若 Sol 額度不足）**：`Gemini 3.8 Flash High`（零額度焦慮、百萬 Context、快速反向防呆把關）。
  4. **Tier 4 終極防線（額度全竭時）**：直接跳過 AI 複審，以本地型別檢查與 3,134 個單元測試為最終驗證防線。
- **省額度模式（Low-Quota AI Team Mode）與模型分工**：
  - **規劃端（Planner）**：由 `gemini-3.8-flash-high` 負責草擬與架構，出圖／出文零焦慮；Sol 僅作為後備與 Tier 2 複審，大幅省下高階思考 Token。
  - **動態推理（Unfrozen Reasoning）**：其他模型不固定鎖死高階推理，全面依任務難度在 `low`～`high` 彈性調整（`trivial: low`、`routine: medium`、`complex: high`、`critical: high`）。解除 Luna 鎖死 high/max，日常寫入以 medium 推進。
  - **各司其職**：一般寫入 Worker 為 `gpt-5.6-luna`；困難診斷與跨檔 Worker Deep 為 `gpt-5.6-terra`；Reviewer 為 `gpt-5.6-terra` read-only；Explorer／Analyst 維持 AGY Fast／Deep。
  - **標準設定備份**：原標準 team 設定已安全備份至 `.ai-team/config/router.astra-standard.json`，額度重置時可一鍵切回。
- `ai_team_router` 可執行已核准的本地協作，但不得繞過安全底線或擴大 scope。
- AGY Fast 失敗後可自動轉 Deep，再轉 native Luna；不可無限重試同一個失敗命令。

## 驗證與進度

- 依產品價值選擇 targeted tests、integration tests、coverage、Browser、staging 或 sandbox 驗證，不強制每輪執行全部命令。
- Coverage gate 是品質訊號；不得降低門檻，但不再阻擋功能測試或 E2E 的合理執行。
- 發現同一失敗沒有改善時，停止該路徑並改用不同診斷或產品工作；不得在同一死路無限重試。
- 每個 checkpoint 保存 scope、實際結果、證據、回滾方式與下一步；完整 handoff 只在角色或風險真正變更時輸出。
- 最終 Goal 只有在所有目標與必要 release evidence 完成後才可標記 `COMPLETE`。

## 文件優先順序

- Canonical workflow：`docs/ai-team/workflow-policy.md`
- Goal protocol：`docs/ai-team/GOAL-PROTOCOL.md`
- Routing：`docs/ai-team/ROUTING.md`
- Handoff schema：`docs/ai-team/handoff-schema.md`
- 歷史 WP 的一次性 scope 只對該 WP 有效，不得被當成全域限制。
