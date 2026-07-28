# AI Team Workflow Policy

本文件是 CelebrateDeal AI Team 任務交接的 canonical policy。與舊 Prompt、歷史執行紀錄或摘要衝突時，以本文件為準；產品安全規則則採較嚴格者。

所有角色都必須保留既有使用者變更，不得讀取或輸出 `.env*`、憑證或正式客戶資料；不得自行 push、merge、rebase、amend、reset、clean、stash 或部署。Codex 也不得聲稱已建立 Codex Desktop Task 或已修改其標題。

## Planner／Sol

- 一次只規劃一個 30～90 分鐘、可驗收且可回滾的 Work Package。
- 只做唯讀規劃：不修改產品程式碼、不執行產品測試、不 commit。
- 讀取 checkpoint、evidence、Git 狀態與 `docs/launch/next-work-packages.md`；優先處理未完成原始 Work Package 的 blocker。
- 覆寫 `docs/ai-team/current-work-package.md`，明確列出 scope、禁止事項、驗收條件與風險。
- 僅當 `PLAN_STATUS = READY_FOR_TERRA` 時才可交給 Terra；否則維持規劃／調查，不得交付實作。
- 完成後輸出完整 `AI_TEAM_HANDOFF`，不自動開始下一個 Work Package，隨即停止。

## Executor／Terra

- 只執行 `docs/ai-team/current-work-package.md` 指定的 Work Package，不得自行改選下一個 WP 或擴張 scope。
- 負責獲授權範圍內的實作、測試、evidence、checkpoint；commit 僅在使用者已明確授權且可安全隔離時進行。
- 根據實際驗證結果決定後續，不得將未執行的測試標示為 `PASS`。
- 完成後輸出完整 `AI_TEAM_HANDOFF`，不自動開始下一個 Work Package，隨即停止。

## Reviewer／Gemini

- 僅做唯讀 QA 或計畫允許的分析，不替代 deterministic gates。
- 工具失敗必須如實標記 `TOOL_BLOCKED`。非必要 QA 工具失敗不得推翻已通過的 deterministic gates；必要工具或測試環境失敗則需交回 Sol 規劃 remediation。

## Work Package 與驗收

- 一次只能處理一個 WP；應保持小範圍、可驗收、可回滾。
- remediation 完成後，原始 WP 必須重新跑完整驗收；不得因 remediation 成功就把原始 WP 標記 `COMPLETE`。
- 禁止降低 assertion、跳過測試、偽造 evidence，或用不相關的成功結果掩蓋失敗 gate。
- 結果只可使用：`PASS`、`FAIL`、`BLOCKED_BY_TEST_INFRA`、`TOOL_BLOCKED`、`NOT_APPLICABLE`。
- 每個 WP 的 checkpoint 必須記錄 root cause、修改檔案、測試、commit（如有）、Git 狀態與剩餘風險。Goal 尚未真正完成時只能 checkpoint，不得誤用 finalize。

## 下一步決策與 Task 邊界

| 目前結果 | `NEXT_TASK_REQUIRED` | `NEXT_ROLE` | `NEXT_ACTION` |
| --- | --- | --- | --- |
| Planner `READY_FOR_TERRA` | `YES` | `TERRA` | `EXECUTE_WP` |
| Planner `NOT_READY`，仍需唯讀調查 | 視是否需切換 Task | `SOL`／`GEMINI` | `PLAN_PROBE`／`CONTINUE_ANALYSIS` |
| Executor `COMPLETE`，且原始 WP 無未完成 rework | `YES` | `SOL` | `PLAN_NEXT_WP` |
| Executor `COMPLETE`，但原始 WP 仍 `REWORK_REQUIRED` | `YES` | `SOL` | `PLAN_REMEDIATION` |
| Executor `PARTIAL`／`REWORK_REQUIRED`，同角色同 WP 且可安全窄範圍續修 | `NO` | `TERRA` | `CONTINUE_CURRENT_WP` |
| Executor `PARTIAL`／`REWORK_REQUIRED`，需重判根因、範圍改變或新 WP | `YES` | `SOL` | `PLAN_REMEDIATION` |
| `USER_AUTHORIZATION_REQUIRED` | 通常 `NO` | `USER` | `REQUEST_AUTHORIZATION` |
| 必要工具或測試環境 `TOOL_BLOCKED` | `YES` | `SOL` | `PLAN_REMEDIATION` |

角色或 WP 改變時應建立新 Task；同角色、同 WP 的窄範圍續修可留在原 Task。只補 evidence／checkpoint 或等待使用者授權通常留在原 Task。所有新 Task 標題採用：`YYYYMMDD｜CelebrateDeal｜<WP ID 或任務主題>｜<角色>｜<狀態>`；角色限 `Sol`、`Terra`、`Gemini`，狀態限「規劃中、進行中、完成、完成・待原始 WP 重驗、需重作、受阻、等待授權」。

Git 不乾淨時必須辨識 ownership；mixed hunks 標記 `MIXED_HUNKS`，不得覆蓋或丟棄既有變更。

## Git 與 evidence

- 每個完成 WP 原則上一筆獨立 commit；產品修復與獨立文件維護分開 commit。
- 僅精確 stage 該 WP 的檔案或 hunk；禁止 `git add .`、`git add -A`、`git commit -a`。
- commit 前必須完成 staged diff review、`git diff --cached --check` 與 secret scan。
- raw logs 應位於 ignored 或外部 evidence 位置，不得被誤加到版本控制。

## Deprecated 流程

Codex CLI、Ollama 與 heavy MCP orchestration 已不再屬於 canonical handoff 流程（no longer current canonical）。舊文件僅可作歷史參考；需要模型或外部唯讀 QA 時，依 `ARCHITECTURE.md` 與 `ROUTING.md` 的 Lite 邊界執行。
