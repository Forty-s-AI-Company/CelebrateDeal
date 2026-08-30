# FIN-10：首次方案選擇的平台帳務模式修正

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_LOCAL_FUNCTIONAL_FIX`

## 發現與修正

`src/app/(app)/billing/plans/actions.ts` 在商家第一次選擇 `BillingPlan` 時，原本將 `VendorSubscription.paymentMode` 預設為 `byo`。但方案頁與 `src/lib/billing.ts` 的 settlement 計算把平台方案視為 `platform` 月結；因此新商家可能看見平台方案，卻不會進入平台月費／平台服務費的帳務路徑。

現在首次選方案明確使用 `paymentMode: "platform"`；既有訂閱變更時仍保留資料庫中原本明確設定的 payment mode，不覆蓋既有 BYO 商家設定。

## Deterministic evidence

執行：

```text
npx vitest run "src/app/(app)/billing/plans/actions.test.ts" src/lib/billing.test.ts
```

結果：2 個 test files、19 tests 全數通過，0 failed、0 skipped。新增 regression 驗證第一次選方案的 `platform` 預設值；既有 plan change、重複訂閱、inactive plan、owner authorization 與 serialization conflict 測試仍通過，billing settlement cohort 也通過。

## 分數與邊界

CAT04 維持 6.0、總分維持 73.5。這是本機產品 bug 修正，不是 staging／PayUni Sandbox／Production payment evidence；沒有執行 migration、外部付款、正式退款或外部服務操作。FIN-08AA、WP-196、WP-197 均未重試。

## Evidence

- `.ai-team/reports/fin10-platform-plan-billing-mode-closure.json`
- `src/app/(app)/billing/plans/actions.ts`
- `src/app/(app)/billing/plans/actions.test.ts`
- `src/lib/billing.ts`
- `src/lib/billing.test.ts`

