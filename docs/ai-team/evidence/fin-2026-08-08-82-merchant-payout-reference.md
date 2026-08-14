# FIN-2026-08-08-82｜Merchant payout paid-reference closure

記錄時間：2026-08-08（Asia/Taipei）  
結果：`COMPLETE_LOCAL_FINANCE_P1_NO_SCORE_CHANGE`

## 本輪完成的產品功能

補上平台商家 payout batch 的 paid-outcome evidence boundary：

- `updatePayoutItemStatusAction` 只有在 paid transition 提供 1～200 字的人工出款／provider reference 時才會繼續；空白、超長或缺漏會在讀取 payout item 前 fail closed。
- payout item 新增 additive nullable `outcomeReference` 欄位；歷史 paid row 沒有 reference 時保留 `null`，不回填或推測不存在的證據。
- admin payout UI 顯示既有 reference，paid 操作要求輸入人工 reference。
- payout CSV 將 reference 一起匯出，讓批次狀態、金額與人工出款依據可在同一份 finance artifact 追溯。
- failed／retrying transition 會清除 outcome reference；只有已核准的 paid transition 才能保留它。

這使 affiliate／settlement payout 的「建立批次 → 匯出 → 人工確認出款 → 標記 paid → settlement／commission paid」邊界一致；沒有呼叫銀行、PayUni 或其他外部 payout provider。

## Deterministic verification

- `src/app/actions.test.ts` + payout page／CSV tests：3 files、160/160 PASS。
- expanded payout／billing cohort：8 files、31/31 PASS。
- disposable database cohort：`src/lib/tenant-ledger-invariants.test.ts` 4/4、`src/app/actions.payout-db.test.ts` 4/4 PASS。
- loopback PostgreSQL marker schema 套用完整 33 migrations，包含 `20260808070000_merchant_payout_outcome_reference`；schema cleanup verification PASS。
- `prisma validate`：PASS。
- Prisma generate：PASS。
- scoped ESLint：PASS，0 errors／0 warnings。
- `npx tsc --noEmit`：PASS。
- `npm run build`：PASS；Next production build static pages 89/89。
- `git -c core.autocrlf=false diff --check`：PASS。

本輪初次直接使用既有本機 dev schema 的 tenant regression 收到 `P2022 PayoutItem.outcomeReference does not exist`；沒有修改該 schema，也沒有把它列為成功。改用帶 marker 的 loopback disposable schema 套用全部 migrations 後，database-backed cohort 與 cleanup 均 PASS。

## 分數與未完成邊界

Canonical readiness truth 維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。本地 payout reference gate 不冒充 CAT04 所需的 authorized staging／PayUni Sandbox provider receipt，也不冒充 CAT10 真人 finance／legal／release owner 或 external monitoring acceptance。

本輪沒有 Production、正式資料庫、正式付款／退款／銀行轉帳、寄信、PayUni Sandbox、staging、deployment、push 或 merge；沒有讀取或輸出 secrets、正式客戶資料或付款資料。沒有重試 FIN-08AA、WP-196 或 WP-197。

沒有降低 coverage threshold、source inventory、exclude、skip、assertion 或資料驗證強度；global coverage 未在本 WP 重算，且不阻擋功能與 disposable database 驗證。

## 回滾與下一步

回滾範圍限於本輪 payout action／UI／CSV、Prisma schema／additive migration、對應 tests 與 evidence／control-plane metadata；migration 未在正式資料庫執行。下一步繼續處理尚未完成的產品功能或必要外部／真人驗收，不把本地 payout evidence 提升為 CAT04／CAT10 分數。
