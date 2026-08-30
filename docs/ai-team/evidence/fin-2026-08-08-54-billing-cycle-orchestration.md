# FIN-2026-08-08-54｜月結週期與 fail-closed 帳單生成

## 結果

`COMPLETE_LOCAL_PRODUCT_FIX_NO_SCORE_CHANGE`。本輪把既有手動月結邏輯抽成可重用的 billing-cycle domain service，新增受 `JOB_SECRET` 保護的 billing-cycle job route：排程只處理上一個結算期已到 billing cycle day 的 active vendor、建立或更新月結 invoice、將逾期 issued invoice 標記為 overdue，並以固定計數回應。

這是販售／帳務產品功能閉環的一部分，不是自動扣款完成證明。job 明確不會對儲存的 payment method 或 PayUni 發起 charge；目前 Stream 超額仍依產品政策停止新播放，月結帳單由既有安全 checkout 手動付款。沒有猜測 PayUni recurring charge request 欄位，也沒有把 provider-neutral orchestration 冒充 PayUni Sandbox evidence。

## 實際產品修正

- `generateSettlementForVendor` 統一 Server Action 與排程 job 的 settlement／invoice 生成邏輯，使用 Serializable transaction，並保留既有 adjustment、lock 與 optimistic conflict 邊界。
- 已付款、部分退款或全額退款 invoice 若重算後金額漂移，transaction 會以 `terminal_invoice_amount_conflict` fail closed；不會覆寫 terminal invoice，也不會寫 audit success。
- terminal invoice 金額相同時只更新 due date，保留 status／paidAt；open invoice 可更新金額但不會被重設 status。
- 新增 `/api/jobs/billing-cycle`，拒絕未授權呼叫，拒絕外部傳入 month，錯誤只回固定 `billing_cycle_failed`。
- plans UI 明確顯示超額停止新播放、月結依用量產生、目前未啟用自動超額扣款與帳單手動付款邊界。

## 驗證結果

- `src/lib/billing-cycle.test.ts`：5/5 PASS，涵蓋建立 invoice、terminal 金額漂移 rollback boundary、terminal 同額保留狀態、invalid month、locked settlement。
- `src/lib/billing-cycle-job.test.ts`：2/2 PASS，涵蓋去重、未到期跳過、逾期標記、locked／terminal drift／generic failure 計數分類。
- `src/app/api/jobs/billing-cycle/route.test.ts`：4/4 PASS，涵蓋 job secret、sanitized success、sanitized 503。
- `src/app/actions.test.ts`：153/153 PASS，包含原 settlement action regression 與 paid invoice 金額漂移 fail-closed regression。
- finance regression cohort：4 files、57/57 PASS（payment webhook、invoice checkout、platform payout、tenant ledger）。
- `npx tsc --noEmit`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS。
- `npx next build`：PASS；production route manifest 包含 `/api/jobs/billing-cycle`。

## 分數與未完成邊界

canonical readiness 維持 73.5：CAT01=7.5、CAT02=8.0、CAT03=8.0、CAT04=6.0、CAT05=8.5、CAT06=7.0、CAT07=9.0、CAT08=7.5、CAT09=7.5、CAT10=4.5；`current_goal_score_change=0`。

本輪沒有執行 PayUni Sandbox、staging、Production、正式付款／退款、外部 payout 或真人簽核；沒有 global coverage 重算。CAT04 仍需要新的可追溯 provider／staging／Sandbox receipt，CAT10 仍需要真人 merchant、客服、法務／隱私／退款、財務、release owner 與 external monitoring evidence。

## 安全與回滾

- 修改範圍為 billing-cycle production source、job route、plans UI、對應 deterministic tests 與本輪 evidence／control-plane metadata；沒有 schema／migration 變更。
- 未讀取或輸出 `.env*`、credential、token、cookie、正式資料或付款資料；沒有正式服務操作。
- 沒有降低 coverage threshold、coverage inventory、exclude、skip、assertion 或資料驗證強度。
- FIN-08AA、WP-196、WP-197 terminal no-go 路徑沒有重試。
- 回滾限於本輪新增／修改的 billing-cycle source、route、plans text、tests 與 evidence；既有 dirty worktree 變更全部保留。

## 下一步

繼續 FINANCE-CLOSURE：補 recurring／overage 的 provider-neutral business rule 與可觀測的 manual-payment／failure handoff，並在有明確新路徑時再做 CAT04 外部證據；不重試既有 terminal external path。之後進入 FUNC、CAT06／CAT10、QUAL 與 release reconciliation。
