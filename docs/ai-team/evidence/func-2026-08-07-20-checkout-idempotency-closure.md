# FUNC-2026-08-07-20 Checkout idempotency closure

時間：2026-08-07（Asia/Taipei）

## 結果

本輪關閉可重現的 checkout 重送缺口：`POST /api/payments/checkout` 現在要求 bounded UUID `idempotencyKey`，`PaymentTransaction` 以 nullable legacy-safe 的 `(vendorId, checkoutIdempotencyKey)` unique index 作為資料庫併發屏障。相同 key 只能保留一筆 pending transaction；已完成 provider session 的重送會 replay 保存的 checkout payload，尚未完成或已 terminal 的交易會回 bounded 409，不會再次呼叫 provider。

LivePlayback 為每個商品保留一次 key，讓 provider response 遺失時的 retry 不會偷偷建立第二筆交易。key 也會綁定商品、金額與幣別，跨商品或價格變更重用會 fail closed。

## 驗證

- targeted Vitest：4 files／55 passed／0 failed／0 skipped。
- loopback PostgreSQL concurrent duplicate regression：同 key 同時兩次建立，1 transaction、1 reservation，另一個得到 `CheckoutIdempotencyConflictError`。
- full Vitest：187 files／1340 passed／0 failed／0 skipped。
- Node contracts：679/679 passed。
- typecheck、architecture/inventory gate、secret scan：PASS。
- full lint：0 errors，僅 2 個既有 `wp130` unused-import warnings。
- loopback disposable `celebratedeal_test` catalog：`checkoutIdempotencyKey` 欄位與 vendor-scoped unique index 均存在。
- diff check：PASS；只有既有 Windows LF/CRLF normalization warning。

## 邊界與分數

本輪只使用本機 synthetic fixture 與 loopback disposable PostgreSQL；沒有啟動 Next server、Browser、staging、PayUni、Production 或外部付款。沒有讀取或輸出 secret、cookie、token、正式資料；沒有重試 FIN-08AA、FIN-08AB、WP-196、WP-197 或既有 PayUni external failure。

全域 coverage 沒有在本輪重算；最新 authoritative 仍是 QUAL-18：statements／branches／functions／lines `40.65／46.46／49.16／61.08`，低於既有 `63／57／60／65` gate。未修改 threshold、inventory、exclude、skip 或 assertion。

CAT04 `6.0`、CAT10 `4.5`、總分 `73.5` 維持不變。這是功能可靠性 closure，不是 CAT04 staging／PayUni receipt 或 CAT10 真人／外部 owner acceptance，因此不套用 score uplift。

可追溯 machine receipt：`.ai-team/reports/func-2026-08-07-20-checkout-idempotency-closure.json`。
