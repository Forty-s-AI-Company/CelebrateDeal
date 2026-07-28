# Next Work Packages

每包控制在 30–90 分鐘；本次未執行。

| ID | 名稱 | 目標／現況 | 驗收與安全測試 | 建議模型／工具 | 自動／人工 | 依賴 | 優先級 | 預計分數 |
|---|---|---|---|---|---|---|---:|---:|
| WP-01 | 恢復 AGY 登入 | 解 TB-01；不得讀憑證 | `agy models` 一次成功，確認兩個 slug | 人工＋AGY | 人工 | 無 | 1 | +2 |
| WP-02 | Playwright MCP 單一註冊 | 在備份後新增 isolated server，無重複 | JSON parse、`/mcp`、本地 title/element | Terra medium＋AGY fast | 混合 | WP-01 | 2 | +2 |
| WP-03 | Git checkpoint refs 稽核 | **診斷完成**：5 refs 均為 tree，且預設 Windows Git 遭 260-char loose-path 阻塞；未刪除或修復 | inventory、fsck、long-path probe、review verdict 已保存；TB-06 仍阻擋 | Terra High＋AGY QA/Deep review | 自動 | 無 | 1 | +0 |
| WP-11 | Git checkpoint refs 授權修復評估 | 僅在使用者明確授權後評估持久 long-path 設定與安全 checkpoint-ref 遷移／備份方案 | 先驗證 backup、rollback、default `git log --all`；不得沿用 WP-03 直接修改 | Terra High＋Reviewer | 人工授權 | WP-03 | 1 | 待評估 |
| WP-04 | 無正式 env 的回歸基準 | **完成**：disposable snapshot、synthetic env、Prisma、lint、typecheck、923 tests、build 與 E2E discovery 均有目前 receipts | run `20260727155807-8d6acbd8`；不讀正式 `.env*` | Terra high | 自動 | 無 | — | +8 |
| WP-05 | Vendor Member action 拆分 | **COMPLETE**：三個 actions 已抽至 domain module，root 使用 explicit named re-export，2300 ceiling 已恢復 | 2026-07-28 receipts：110 targeted tests、architecture gate、lint/typecheck、diff check PASS；Gemini Fast non-blocking QA TOOL_BLOCKED | Terra high | 自動 | WP-04 | — | +0（既有總分不預支） |
| WP-06 | Candidate migration DB Review | **已完成 review，REWORK_REQUIRED**：candidate 10 的 key lifecycle 與 candidate 11 的 NULL/status policy 未達 Gate | run `20260727163722-a1e8affb` receipts；不得誤列為上線許可 | Terra high＋Gemini Deep | 自動 | WP-04 | — | +0 |
| WP-12 | 銀行帳戶 key lifecycle remediation | **完成**：versioned key、rotation/recovery、disposable lifecycle 與 synthetic `npm run build` gate 均通過 | candidate 10 evidence complete；不得將結果誤延伸到 WP-13 佣金範圍 | Terra high＋Gemini Deep | 自動 | WP-06 review | — | +0 |
| WP-13 | Commission NULL source identity／status DB policy | **完成**：canonical key、NULL source fail-closed、五態 status、conditional update 與 disposable legacy fixtures 已有 receipts | final verdict 與 `wp13_*` cleanup；不得誤延伸至 paid 後 reversal | Terra high＋Gemini Deep | 自動 | WP-06 review | — | +0（既有總分不預支） |
| WP-14 | Paid commission reversal、dispute 與 immutable accounting trail | **COMPLETE**：append-only ledger、opening snapshot、paid reversal／dispute、payout transition、disposable verification與 Fast／Deep 複核均完成 | final verdict、162 targeted tests、migration receipts 與 Fast／Deep evidence；不自動選下一包 | Terra high＋Gemini Fast/Deep | 自動 | WP-13 | — | +0（既有總分不預支） |
| WP-07 | Security 52 candidates triage | **COMPLETE（第一切片）**：Authentication/MFA 四項已對帳並完成 Gemini Deep evidence-governance PASS；MFA recovery race 仍如實為 `INSUFFICIENT_EVIDENCE` | 不得宣告 52 項完成。若後續另建包，才以 disposable DB 補 MFA recovery concurrent receipt；本包完成後不自動選下一包 | Terra high＋Gemini Deep | 自動 | WP-04 | — | +0（分數不預支） |
| WP-08 | 產品 Browser QA | 在本地安全環境跑主要 journey/a11y/performance | screenshots、trace、git status before/after | AGY fast 或 Playwright | 自動 | WP-02、WP-04 | 3 | +5 |
| WP-09 | 492 changes 分批驗證（第一切片：AI Team runtime／工具政策） | **COMPLETE**：35 個 runtime／工具政策項目、3 個 UNKNOWN 檔與 1 個 deleted legacy descriptor 均已 manifest；沒有 stage/commit | no-dotenv py_compile、strict-index、secret scan、diff check PASS；Fast QA finding 已由 manifest／ignore evidence 處置 | Terra High＋Gemini Fast | 自動 | WP-04 | — | +0（分數不預支） |
| WP-10 | 外部商業 Gate | PayUni/Supabase/observability/DNS/legal | manual checklist 與 sandbox receipts | 人工＋Sol 驗收 | 人工 | 前述 packages | 4 | +15 |

高風險：WP-06 涉及 migration，只能在 disposable DB 做 review；不得執行正式 migration。

## Git batching handoff（2026-07-28）

本次已提交兩筆已驗證的 launch evidence／batching 文件批次。其餘 497 筆原始變更全部保留並有分類；下一個工作包不得直接混入它們，應先以 `git-change-batching-20260728-133000` 報告中列出的單一 domain 邊界重建可測試批次。
