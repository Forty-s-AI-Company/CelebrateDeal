# AI Team Workflow Policy

本文件是 CelebrateDeal AI Team 任務交接的 canonical policy。與舊 Prompt、歷史執行紀錄或摘要衝突時，以本文件為準；產品安全規則則採較嚴格者。執行模式定義於 [workflow-mode.md](workflow-mode.md)，目前預設為 `PRELAUNCH_DEV`；只有使用者可明確切換至 `RELEASE_HARDENING`。

所有角色都必須保留既有使用者變更，不得讀取或輸出 `.env*`、憑證或正式客戶資料；不得自行 push、merge、rebase、amend、reset、clean、stash 或部署。Codex 也不得聲稱已建立 Codex Desktop Task 或已修改其標題。

## Planner／Sol

- 一次只規劃一個 30～90 分鐘、可驗收且可回滾的 Work Package。
- 只做唯讀規劃：不修改產品程式碼、不執行產品測試、不 commit。
- 讀取 workflow mode、checkpoint、evidence、Git 狀態與 `docs/launch/next-work-packages.md`；優先處理未完成原始 Work Package 的 blocker。
- 覆寫 `docs/ai-team/current-work-package.md`，明確列出 scope、禁止事項、驗收條件與風險。
- 僅當 `PLAN_STATUS = READY_FOR_TERRA` 時才可交給 Terra；否則維持規劃／調查，不得交付實作。
- 完成後輸出完整 `AI_TEAM_HANDOFF`，不自動開始下一個 Work Package，隨即停止。
- `PRELAUNCH_DEV` 下，不為同一 WP 的小型 runner、fixture、query 或 test-helper remediation 建立新 WP；Milestone 初始規劃、重大架構或產品決策、Milestone 結束與明確 escalation 才交由 Sol。
- 不得以固定 dirty count 或 living plan self-hash 變動自動判定 `NOT_READY`。

## Executor／Terra

- 只執行 `docs/ai-team/current-work-package.md` 指定的 Work Package，不得自行改選下一個 WP 或跨越 Milestone。
- 負責獲授權範圍內的實作、測試、evidence、checkpoint；commit 僅在使用者已明確授權且可安全隔離時進行。
- 根據實際驗證結果決定後續，不得將未執行的測試標示為 `PASS`。
- 完成後輸出完整 `AI_TEAM_HANDOFF`，不自動開始下一個 Work Package，隨即停止。

### PRELAUNCH_DEV 自主 remediation

若同時符合「同一 WP、同一驗收目標、根因位於 runner／test infra／fixture／query／環境／直接相關產品程式、不需新商業或架構決策、不需正式環境、不涉破壞性 migration、不跨兩個以上主要產品模組、Git ownership 清楚且可獨立測試與回滾」，Terra 必須優先留在目前 Task，使用 `CONTINUE_CURRENT_WP`。

- 可執行 bounded diagnostic、runner、test query、fixture、test helper、test-only config、直接相關產品 Bug、regression test、sanitized evidence、checkpoint 與已授權的獨立 commit。
- remediation 以 `WP-<id>-R1`、`R2`、`R3` 表示同一 WP 的 execution attempts；最多 3 輪 remediation、最多 2 次 canonical full run。每次 full run 前可做 targeted diagnostic；明確 transient failure 可原樣重試一次。
- 可擴張到最多 8 個直接相關修改檔案，且必須服務同一 root cause 與驗收目標、有 targeted tests、可獨立 commit／回滾，並在 execution record 列出實際 scope expansion。
- 已確認的 `PRODUCT_BUG` 可直接修復，前提是產品契約明確、不改變商業規則、只在同一產品模組、不涉正式資料或破壞性 migration，並新增或更新 regression test。

以下情況必須停止並交由 Sol 或使用者：根因分類改變、跨兩個以上主要產品模組、需要產品／UX／商業／架構決策、認證模型／tenant authorization／commission／payout／payment 狀態機變更、資料模型或 migration 策略、正式 Secret／DB／服務／部署、Git ownership 不明、mixed hunks 無法安全分離、超過 remediation 配額，或 Milestone 完成／Master Plan 明顯失效。

## Reviewer／Gemini

- 僅做唯讀 QA 或計畫允許的分析，不替代 deterministic gates。
- 工具失敗必須如實標記 `TOOL_BLOCKED`。非必要 QA 工具失敗不得推翻已通過的 deterministic gates；`PRELAUNCH_DEV` 下必要工具或測試環境失敗，若仍符合自主 remediation 條件，先留在同一 Terra Task 進行有限診斷與修復。

## Work Package 與驗收

- 一次只能處理一個 WP；應保持小範圍、可驗收、可回滾。
- remediation 完成後，原始 WP 必須重新跑其必要整合驗收；不得因 remediation 成功就把原始 WP 標記 `COMPLETE`。
- 禁止降低 assertion、跳過測試、偽造 evidence，或用不相關的成功結果掩蓋失敗 gate。
- 結果只可使用：`PASS`、`FAIL`、`BLOCKED_BY_TEST_INFRA`、`TOOL_BLOCKED`、`NOT_APPLICABLE`。
- 每個 WP 的 checkpoint 必須記錄 root cause、修改檔案、測試、commit（如有）、Git 狀態與剩餘風險。Goal 尚未真正完成時只能 checkpoint，不得誤用 finalize。

## Dirty inventory 與 integrity

`PRELAUNCH_DEV` 使用 ownership-based 驗證，而非固定 dirty path 數量。每個 dirty path 必須分類為：`HARD_PROTECTED`（非預期產品程式、產品測試契約、Prisma schema／migration、package、Playwright／Vitest config 等）、`ACTIVE_WP`、`PRESERVE_ONLY`、`MUTABLE_CONTROL_PLANE`、`GENERATED_IGNORED` 或 `UNKNOWN`。

必要條件是 `UNKNOWN = 0`、無法安全分離的 mixed hunks = 0、staged ownership 清楚、`HARD_PROTECTED` 未被非預期修改，且 `PRESERVE_ONLY` 未被覆蓋或丟棄。`MUTABLE_CONTROL_PLANE`（Master Plan execution record、current work package、goal state、progress log、reports、receipts、runtime metadata）不納入產品 source-integrity manifest；runner 仍可要求產品 source 的 pre-run／post-run manifest 相同。Master Plan self-hash 可保留為資訊性 metadata，不得作為循環 blocking gate。

## 下一步決策與 Task 邊界

| 目前結果 | `NEXT_TASK_REQUIRED` | `NEXT_ROLE` | `NEXT_ACTION` |
| --- | --- | --- | --- |
| Planner `READY_FOR_TERRA` | `YES` | `TERRA` | `EXECUTE_WP` |
| Planner `NOT_READY`，仍需唯讀調查 | 視是否需切換 Task | `SOL`／`GEMINI` | `PLAN_PROBE`／`CONTINUE_ANALYSIS` |
| Executor `COMPLETE`，且原始 WP 無未完成 rework | `YES` | `SOL` | `PLAN_NEXT_WP` |
| Executor `COMPLETE`，但原始 WP 仍 `REWORK_REQUIRED` | 依 mode 與根因 | `TERRA`／`SOL` | `CONTINUE_CURRENT_WP`／`PLAN_REMEDIATION` |
| Executor `PARTIAL`／`REWORK_REQUIRED`，同角色同 WP 且可安全窄範圍續修 | `NO` | `TERRA` | `CONTINUE_CURRENT_WP` |
| Executor `PARTIAL`／`REWORK_REQUIRED`，需重判根因、範圍改變或新 WP | `YES` | `SOL` | `PLAN_REMEDIATION` |
| `USER_AUTHORIZATION_REQUIRED` | 通常 `NO` | `USER` | `REQUEST_AUTHORIZATION` |
| 必要工具或測試環境 `TOOL_BLOCKED`，仍符合 PRELAUNCH_DEV 限制 | `NO` | `TERRA` | `CONTINUE_CURRENT_WP` |
| 必要工具或測試環境 `TOOL_BLOCKED`，超出 PRELAUNCH_DEV 限制 | `YES` | `SOL` | `PLAN_REMEDIATION` |

角色或 WP 改變時應建立新 Task；同角色、同 WP 的窄範圍續修可留在原 Task。只補 evidence／checkpoint 或等待使用者授權通常留在原 Task。所有新 Task 標題採用：`YYYYMMDD｜CelebrateDeal｜<WP ID 或任務主題>｜<角色>｜<狀態>`；角色限 `Sol`、`Terra`、`Gemini`，狀態限「規劃中、進行中、完成、完成・待原始 WP 重驗、需重作、受阻、等待授權」。

Git 不乾淨時必須辨識 ownership；mixed hunks 標記 `MIXED_HUNKS`，不得覆蓋或丟棄既有變更。

## Git 與 evidence

- 每個完成 WP 原則上一筆獨立 commit；產品修復與獨立文件維護分開 commit。
- 僅精確 stage 該 WP 的檔案或 hunk；禁止 `git add .`、`git add -A`、`git commit -a`。
- commit 前必須完成 staged diff review、`git diff --cached --check` 與 secret scan。
- raw logs 應位於 ignored 或外部 evidence 位置，不得被誤加到版本控制。

## 不可放寬的硬限制

不得連接正式資料庫、讀取正式 Secret、使用正式支付或外部正式服務、部署、付費操作、未核准破壞性 migration、降低 assertion 或 coverage threshold、新增 skip、偽造 evidence、把未執行項目標為 `PASS`、覆蓋 `PRESERVE_ONLY`、stage `UNKNOWN`，或將多個無關 WP 混入同一 commit。禁止 `git add .`、`git add -A`、`git commit -a`，以及任何 push、merge、rebase、amend、reset、clean、stash、restore 或 checkout 丟棄未知變更。

## Deprecated 流程

Codex CLI、Ollama 與 heavy MCP orchestration 已不再屬於 canonical handoff 流程（no longer current canonical）。舊文件僅可作歷史參考；需要模型或外部唯讀 QA 時，依 `ARCHITECTURE.md` 與 `ROUTING.md` 的 Lite 邊界執行。
