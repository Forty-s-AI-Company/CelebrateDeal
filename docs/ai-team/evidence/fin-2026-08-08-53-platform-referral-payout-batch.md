# FIN-2026-08-08-53｜聯盟 commission 到 owner payout batch

## 結果

`COMPLETE_LOCAL_FINANCE_INTEGRATION_NO_SCORE_CHANGE`。本輪把聯盟推薦 commission 的可信付款事件、immutable ledger balance、owner/month payable read model 與 local payout batch 串成 PostgreSQL-backed 的本機功能證據；同一 `batchNumber` 重播會重用原批次，不會建立第二個批次。

這是販售／帳務功能的整合驗證，不是外部付款轉帳驗收。local payout batch 仍是 provider-neutral、可人工審核的批次邊界；本輪沒有對 PayUni、銀行、正式付款或正式 payout 發出請求。

## 驗證內容

- 以 disposable PostgreSQL-backed payment webhook fixture 建立 platform subscription、referral attribution 與 server-created platform payment transaction。
- trusted `paid` webhook 將 TWD 10,000 交易產生 TWD 1,000（10%）platform referral commission ledger accrual。
- `syncPlatformReferralPayoutsForMonth` 只建立該 owner／月份的 pending payable，金額由 immutable ledger 重算。
- `createPlatformReferralPayoutBatch` 建立一筆 `draft` batch：`totalAmountCents=1000`、`totalCount=1`，並將 payout claim 為 `batched`。
- 以相同 `batchNumber` replay，回傳原 batch id，資料庫仍只有一筆 batch；payment transaction 維持 `paid`。
- 測試月份每次使用唯一合法月份，避免 append-only accounting fixture 在 disposable runner 中保留時污染其他測試；仍保留 owner 數量、批次數量、金額與 idempotency 的精確 assertion。

## 驗證結果

- `npx vitest run src/lib/payment-webhooks.test.ts`：43/43 PASS，0 failed、0 skipped。
- payout read-model／action／tenant ledger invariant cohort：3 files、14/14 PASS。
- `npx tsc --noEmit`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS。

## 分數與邊界

canonical readiness 維持 73.5：CAT01=7.5、CAT02=8.0、CAT03=8.0、CAT04=6.0、CAT05=8.5、CAT06=7.0、CAT07=9.0、CAT08=7.5、CAT09=7.5、CAT10=4.5；`current_goal_score_change=0`。

本輪只證明 local product correctness 與 disposable PostgreSQL integration，不等於 CAT04 所需的 authorized staging／PayUni Sandbox receipt，也不等於 CAT10 所需的真人 merchant、客服、法律／隱私／退款、財務與 release owner acceptance，因此沒有虛增分數。

## 安全與回滾

- 只新增測試與 evidence/control-plane metadata；沒有修改 schema、migration 或 production source。
- 未讀取或輸出 `.env*` 內容、credential、token、cookie、正式資料或付款資料。
- 沒有 production DB、正式付款／退款／寄信、外部 payout、staging、PayUni Sandbox、部署、push 或 merge 操作。
- 沒有降低 coverage threshold、exclude、skip、assertion 或資料驗證強度；coverage gate 不在本輪重算，也沒有阻擋這些功能測試。
- FIN-08AA、WP-196、WP-197 terminal no-go 路徑沒有重試。
- 回滾範圍限於新增 test case 與本輪 evidence／control-plane metadata；既有 dirty worktree 變更全部保留。

## 下一步

繼續 FINANCE-CLOSURE 的 provider-neutral recurring／overage business rule 與 fail-closed charging boundary；CAT04 只走新的、可追溯外部 evidence 路徑，CAT10 只接受真人與外部 owner evidence。
