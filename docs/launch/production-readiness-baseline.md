# Production Readiness Baseline

日期：2026-07-27
評分原則：每一分都要有目前證據；舊報告不能直接繼承。

| 類別 | 分數 | 目前證據 | 扣分原因 |
|---|---:|---|---|
| 1. 產品核心功能 | 7/10 | lint、typecheck、923 tests 與 local build 均有目前 snapshot receipt | 492 changes 尚未分批驗證 |
| 2. 註冊、登入與主要流程 | 6/10 | auth/MFA/password reset 程式與 tests 存在 | 目前 snapshot 沒有 app-level browser E2E |
| 3. 認證、權限與安全 | 6/10 | authorization matrix、security reports、targeted fixes | 52 candidates 未完整重現；外部 ACL 人工阻擋 |
| 4. 金流、訂閱、退款與帳務 | 4/10 | checkout/webhook/refund/payout 程式與 tests 存在 | sandbox/Production 未驗；candidate DB constraints 未過 Gate |
| 5. 資料完整性、Migration、備份與回滾 | 5/10 | 11 migration 已在 disposable scoped schema deploy/status 通過 | candidate migration 的獨立 review、backup/rollback 仍未驗 |
| 6. UX、RWD、無障礙與錯誤狀態 | 5/10 | UI 修改、a11y/performance specs、本地 isolated browser 可用 | 未跑目前 app E2E；screen-reader 人工阻擋 |
| 7. Unit、Integration、E2E 與回歸 | 8/10 | 116 files／923 tests coverage 通過；Playwright discovery 找到 39 tests | 沒有獨立 integration suite，也尚未實跑產品 E2E |
| 8. 效能、可靠性、Log、監控與追蹤 | 4/10 | monitoring/retry/log code 與 reports 存在 | 外部 delivery、current performance/reliability 未驗 |
| 9. 部署、環境、Release 與回滾 | 5/10 | isolated production build、synthetic env 與 cleanup receipts 通過 | 尚無部署、正式 rollback 與外部 Gate evidence |
| 10. 可販售文件、客服、法務與營運 | 2/10 | 有 runbook、manual actions、QA docs | 客服、法務、商家 onboarding、正式營運未驗 |

## 分數

- Automatable Readiness Score：**57/100**
- Full Commercial Launch Score：**45/100**

## WP-09 — AI Team runtime／工具政策第一切片（2026-07-28，COMPLETE）

完成 35 個 AI Team runtime／工具政策項目與 3 個 UNKNOWN tooling 檔的 run-scoped manifest，另如實記錄 1 個已刪除 legacy descriptor。Python syntax、strict-index、secret scan 與 Git diff check 都在 no-dotenv disposable snapshot／唯讀 Git gate 通過。此包只建立 change-batch 邊界與 runtime-output 排除規則，沒有產品測試或外部 Gate 證據，因此 Automatable Readiness 維持 **57/100**、Full Commercial Launch 維持 **45/100**。

Automatable 分數仍受限於產品 E2E、獨立 integration suite、部署與外部服務 Gate；這些未執行項目沒有算入通過。

## WP-04 目前 snapshot 回歸基準（2026-07-27）

最終 run `20260727155807-8d6acbd8` 已在不含 `.env*` 的 disposable snapshot 完成 Prisma 11 migrations、lint、兩種 typecheck、116 files／923 tests coverage、production build 與 39 個 Playwright tests discovery；schema 與 snapshot 都已清除。

Automatable Readiness 提升為 **57/100**；Full Commercial Launch 維持 **45/100**，因外部商業與人工 Gate 未執行。詳見 `docs/launch/current-snapshot-regression-baseline.md`。

WP-03 已完成 Git checkpoint refs 的唯讀診斷，但沒有修復預設 Git 行為；因此本基準分數維持不變。

## 目前通過

- AI Team v5.2 static/isolated：37/37
- lint：pass
- typecheck：pass
- file-only architecture/Prisma inventory tests：5/5 pass，但基準弱化仍未解
- synthetic isolated Browser QA fallback：pass

## 不可誤讀

Browser fallback 只證明本機 Playwright 與 isolated context 可用，不代表產品主流程、AGY Playwright MCP 或 Production browser QA 通過。

## WP-06 Candidate Migration DB Review（2026-07-28，REWORK_REQUIRED）

Run `20260727163722-a1e8affb` 在 loopback disposable DB 以 9 migrations upgrade baseline 完成 clean、dirty commission、valid bank backfill 與 masked-only bank backfill scenarios。Prisma validate/generate、targeted lint/typecheck、163 targeted tests、secret scan 與 schema cleanup 均通過。

兩支 candidate 都未解除 DB Review Gate：銀行帳戶 envelope 缺少 key version、rotation 與 recovery 契約；佣金 migration 對 non-null source identity 的 unique/atomic forward recovery 合格，但 `sourceId IS NULL` 可重複且 status 尚無 DB 約束。因此 Automatable Readiness 維持 **57/100**、Full Commercial Launch 維持 **45/100**。

## WP-12 — 銀行帳戶 key lifecycle remediation（2026-07-28，完成）

本機 disposable run `wp-12-bank-key-lifecycle-20260728012418-235` 已通過 versioned envelope、old-key recovery、rotation/idempotency、Prisma validate/generate/deploy/status、17 targeted tests、lint、typecheck 與 secret scan；`wp12_*` schema 已 marker 驗證後清除。Build-only retry `wp-12-bank-key-lifecycle-20260728015054-733` 以 `cmd setlocal` 注入 synthetic variables，`npm run build` exit 0。

Candidate 11 的佣金缺口仍未處理，故 Automatable Readiness 維持 **57/100**、Full Commercial Launch 維持 **45/100**。

## WP-13 — Commission NULL identity/status remediation（2026-07-28，完成）

在只含 synthetic 環境的 disposable `wp13_*` schema 中，canonical `deduplicationKey`、vendor scoped unique、NULL source token fail-closed、五態 PostgreSQL enum、conditional transition 與 legacy fail-closed migration 已取得 receipts。valid legacy fixture 成功升級；active NULL source 與未知 status 均在 contract 前拒絕。Prisma、45 targeted tests、lint、typecheck、build、secret scan 與 diff check 全通過，schema 已清理。

Automatable Readiness Score 維持 **57/100**，Full Commercial Launch Score 維持 **45/100**：本工作包解除 candidate 11 的程式與 disposable DB 缺口，但不替未完成的 E2E、部署、外部商業與人工 gate 預支分數。

## WP-14 — Commission accounting ledger（2026-07-28，COMPLETE）

Append-only ledger、forward-only migration、cutover opening snapshot、paid refund／admin reversal、synthetic dispute 與 payout paid transition 已完成。isolated `wp14_*` runner 已通過 npm ci、secret scan、Prisma validate/generate/deploy/status、162 targeted tests、lint、typecheck、build、diff check 與 marker cleanup；另有 legacy baseline → WP-14 opening snapshot probe，確認恰好一筆 `opening_balance`。

Gemini Fast／Deep 在使用者完成互動式登入後的 sanitized 複核皆回傳 PASS、無 Critical／High 項目；Deep wrapper 的 `LOGIN_REQUIRED` 是其將成功 JSON 欄位 `required_fixes` 誤判的 false positive，底層程序 exit 0。Automatable Readiness 維持 **57/100**、Full Commercial Launch 維持 **45/100**：本包解除帳務 core gap，但不預支 E2E、部署與外部商業 gate 的總分。

## WP-05 — Vendor Member action boundary（2026-07-28，COMPLETE）

三個 Vendor Member Server Actions 已實際抽離，root split count 由 2,379 降為 2,029，固定 architecture ceiling 恢復為 2,300。110 項 targeted actions／architecture tests、full lint、typecheck 與 diff check 均通過；未讀取 `.env*`，僅使用 process-only synthetic keyring。Gemini Fast 是 non-blocking QA，但 wrapper 在參數驗證即停止，未執行模型；deterministic evidence 不受影響。

此包只消除局部架構債，沒有新的可比較產品全域覆蓋或外部 Gate 證據，因此 Automatable Readiness 維持 **57/100**、Full Commercial Launch 維持 **45/100**。

## WP-07 — Security 52 candidates triage（Authentication／MFA 第一切片，2026-07-28，COMPLETE）

本切片只對帳四個具名候選，不宣告 52 項全部完成。no-dotenv disposable `wp07_*` snapshot 已通過 Prisma validate/generate/deploy、120 targeted tests、lint、typecheck、secret scan、diff check、source hash comparison 與 marker cleanup。password reset enumeration/token race 及 MFA redirect 為目前快照 mitigation；MFA recovery code race 缺少 DB concurrency receipt，維持 `INSUFFICIENT_EVIDENCE`。必要的 Gemini Deep Reviewer 已以互動式唯讀審查回傳 `PASS`，無未解 Critical／High evidence-governance issue，故此第一切片為 `COMPLETE`。兩個 readiness 分數均維持 **57/100**／**45/100**。

## WP-17 — MFA recovery-code PostgreSQL 併發消耗證據閉環（2026-07-28，COMPLETE）

no-dotenv disposable `wp17_*` snapshot 以兩個 action-level `verifyMfaAction` 呼叫與 read barrier，證明真實 PostgreSQL conditional `updateMany` 只允許一個 recovery-code consumer 成功：一個 success redirect、另一個 `error=invalid` fail closed、session verified 一次、lost-claim audit 一次，且資料庫只留下單一 `usedAt` claim。npm ci、Prisma validate/generate/deploy/status、107 targeted tests、lint、typecheck、strict-index、coverage、secret scan、diff check、source hash 與 marker cleanup 均 PASS。

此 evidence 僅將該單一 race 列為 `MITIGATED_CURRENT_SNAPSHOT`；完整 MFA journey、其餘 security candidates、E2E、部署與外部／人工 gates 均未外推。Gemini Fast wrapper 在模型啟動前 `TOOL_BLOCKED`，為 non-blocking QA。Automatable Readiness 維持 **57/100**，Full Commercial Launch 維持 **45/100**。

## WP-18 — Payout Batch PostgreSQL 併發 claim 證據閉環（2026-07-28，COMPLETE）

no-dotenv disposable `wp18_*` runner 已通過 Prisma validate/generate/deploy/status、110 targeted tests、lint、typecheck、strict-index、marker cleanup、source hash 與 WP-17 protected hash。兩個 action callers 確實同時讀到同一 settlement；以不同 synthetic batch number 進行真實 PostgreSQL transaction claim 後，得到一個正常 redirect、一個 `error=conflict`、恰好一個 batch／item／settlement link，沒有 orphan batch 或 raw DB error。

WP-19 已以兩個互斥 synthetic schema owner coverage projects 補齊必要 gate：WP-17 107 targeted、WP-18 110 targeted、119 files／939 tests coverage、Prisma、lint、typecheck、strict-index、secret scan、protected hashes 與雙 marker-gated cleanup 均 PASS。因此 payout batch race 是 bounded `MITIGATED_CURRENT_SNAPSHOT`；兩個 readiness 分數仍維持 **57/100**／**45/100**，不外推到 E2E、部署或外部商業 gate。

## WP-19 — Coverage synthetic schema flag propagation（2026-07-28，COMPLETE）

既有 `5c9139c` 候選修復在新的 no-dotenv canonical run 中通過：coverage runner 以 process-scoped bridge variables 傳遞兩個真實、互斥 owner schema，再由 coverage-only Vitest projects 注入對應的 `WP17_DISPOSABLE_SCHEMA` 或 `WP18_DISPOSABLE_SCHEMA`。沒有讀取 `.env*`、沒有使用正式資料庫，雙 schema cleanup PASS。TB-16 已解除，WP-18 改為 `COMPLETE`；Automatable Readiness 維持 **57/100**，Full Commercial Launch 維持 **45/100**，因本包沒有新增 E2E、部署或外部 Gate 證據。詳見 `docs/launch/wp19-coverage-synthetic-schema-20260728.md`。
