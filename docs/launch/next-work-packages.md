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
| WP-07 | Security 52 candidates triage | **COMPLETE（第一切片）**：Authentication/MFA 四項已對帳並完成 Gemini Deep evidence-governance PASS；其中 MFA recovery race 已由 WP-17 補為 `MITIGATED_CURRENT_SNAPSHOT` | 不得宣告 52 項完成，也不得外推正式環境；本包完成後不自動選下一包 | Terra high＋Gemini Deep | 自動 | WP-04 | — | +0（分數不預支） |
| WP-17 | MFA Recovery Code PostgreSQL 併發消耗證據閉環 | **COMPLETE**：兩個 action readers 的真實 PostgreSQL conditional claim 已取得一勝一敗 receipt，schema cleanup PASS | 僅關閉單一 current-snapshot race evidence；不重新開啟 WP-07 或其餘 candidates | Terra high＋Gemini Fast | 自動 | WP-07 | — | +0（分數不預支） |
| WP-18 | Payout Batch PostgreSQL 併發 claim 證據閉環 | **COMPLETE**：WP-19 canonical run 補齊 coverage；payout race 為 bounded `MITIGATED_CURRENT_SNAPSHOT` | 107／110 targeted tests、119 files／939 tests coverage、雙 schema cleanup 與品質 gates PASS；不外推 production 或 E2E | Terra high＋Gemini Fast | 自動 | WP-17 | — | +0（分數不預支） |
| WP-19 | Coverage synthetic schema flag propagation | **COMPLETE**：雙 owner schema flags 已安全傳入 coverage projects，TB-16 已解除 | canonical run `20260728213657260`；詳見 `docs/launch/wp19-coverage-synthetic-schema-20260728.md` | Terra High | 自動 | WP-18 closure checkpoint | — | +0（分數不預支） |
| WP-08 | 產品 Browser QA | **COMPLETE**：canonical run `20260729050408559` 通過 39 Browser tests、119 files／939 tests coverage（0 failed／0 skipped）與全部 local cleanup／integrity gates | 38／1是歷史evidence；Sol已重評Automatable 63／Full 45，不外推deployment、外部服務或商業上線 | Terra High＋Playwright | 自動 | WP-04 | — | Automatable +6 |
| WP-24 | Canonical security／authorization residual inventory | **COMPLETE**：以current HEAD重建20個具名歷史候選、6個current authorization residuals、27 route handlers與50 textual exported actions；未具名32項只記`HISTORICAL_DETAIL_UNAVAILABLE` | 純靜態文件WP；沒有產品測試／runner／外部工具；下一個local候選是webinar owner-boundary release E2E，必須交回Sol另規劃 | Terra High | 自動 | M1 COMPLETE | — | +0（readiness已由Sol重評63／45） |
| WP-09 | 492 changes 分批驗證（第一切片：AI Team runtime／工具政策） | **COMPLETE**：35 個 runtime／工具政策項目、3 個 UNKNOWN 檔與 1 個 deleted legacy descriptor 均已 manifest；沒有 stage/commit | no-dotenv py_compile、strict-index、secret scan、diff check PASS；Fast QA finding 已由 manifest／ignore evidence 處置 | Terra High＋Gemini Fast | 自動 | WP-04 | — | +0（分數不預支） |
| WP-10 | 外部商業 Gate | PayUni/Supabase/observability/DNS/legal | manual checklist 與 sandbox receipts | 人工＋Sol 驗收 | 人工 | 前述 packages | 4 | +15 |

高風險：WP-06 涉及 migration，只能在 disposable DB 做 review；不得執行正式 migration。

## Git batching handoff（2026-07-28）

本次已提交兩筆已驗證的 launch evidence／batching 文件批次。其餘 497 筆原始變更全部保留並有分類；下一個工作包不得直接混入它們，應先以 `git-change-batching-20260728-133000` 報告中列出的單一 domain 邊界重建可測試批次。

## Git backlog liquidation continuation（2026-07-28）

- 已完成可提交部分：Lite runtime、WP-04 runner、WP-12 bank encryption、canonical evidence/docs 與 generated artifact ignore。
- 下一個窄範圍包必須先處理 WP-06 tenant-ledger migration 或 no-dotenv tooling/CI，不能直接開始 WP-13／WP-14 或新的產品功能。
- 其餘 product/test/API/UI 修改已列於 `.ai-team/reports/git-backlog-liquidation-20260728-134500/remaining-uncommitted-files.txt`，必須依 domain 重建成可測試批次。

## WP-16-GR-01 checkpoint（2026-07-28）

`WP-16-GR-01` 因 clean HEAD 的既有 bank-account schema/source 不一致，以及 strict-index 需要處理範圍外 production source，標為 `NOT_READY`。下一次 Sol 規劃須先重新界定可使 HEAD 基準 typecheck 通過的依賴邊界；不得直接重試或跳到下一個 Git Review 批次。

## WP-16 結案更新（2026-07-28）

上方為歷史規劃。Git 工作樹歸零已完成，原先的 bank-account schema/source 與 strict-index 基準已修正並通過驗證；WP-13／WP-14 已作為已驗證 financial-integrity changes 提交，不應再以 frozen 或 pending 身分重啟。

下一個工作包可正常回到 Sol 規劃，從新的產品需求選擇單一 30–90 分鐘範圍；本次沒有遺留 WIP 或人工 blocker。

## WP-19 closure reconciliation checkpoint（2026-07-28）

此歷史整理已由新的 canonical run 取代作為 WP-19 結案依據。run `20260728213657260` 通過全套驗收，WP-19 為 `COMPLETE`、TB-16 為 `RESOLVED`、WP-18 為 `COMPLETE`；詳見 `docs/launch/wp19-coverage-synthetic-schema-20260728.md`。下一個工作包可回到 Sol 規劃。
