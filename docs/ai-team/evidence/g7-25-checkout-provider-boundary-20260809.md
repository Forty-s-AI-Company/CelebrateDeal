# G7-25 Checkout unsupported-provider recovery checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL`。本輪完成 G7-24 reviewer 留下的 P2：當 `PAYMENT_PROVIDER` 是不支援的設定值時，商品 checkout 現在會在任何訂單、付款交易、庫存 reservation 或 provider session 寫入前，回傳固定且不洩漏設定細節的 JSON 503。

## 實際修改

- `admittedCheckoutProvider()` 將 provider 建立與 readiness 檢查放在同一個 fail-closed 邊界。
- 不支援的 provider、adapter readiness failure 與 provider lookup exception 都收斂成 `{ "error": "Checkout is temporarily unavailable" }`、HTTP 503。
- 回應不包含 exception message、provider 設定值或 synthetic detail。
- 寫入順序維持 provider admission 在 PaymentTransaction、CommerceOrder、InventoryReservation 與 checkout session 之前。

## Fresh deterministic evidence

- UTC：`2026-08-09T05:29:20.1388224Z`
- `npm test -- --run src/app/api/payments/checkout/route.test.ts`：`41/41 PASS`，failed=`0`、skipped=`0`、exit code=`0`。
- `npx eslint 'src/app/api/payments/checkout/route.ts' 'src/app/api/payments/checkout/route.test.ts'`：PASS，exit code=`0`。
- Full `npm run typecheck` 已於同一 current tree 執行：PASS，exit code=`0`。
- Unsupported-provider test 明確驗證固定 response body、不含原始 exception detail，且三個資料／provider write mock 均為 `not called`。

## Source digest

- `BC7F9315243E20DBFA241EFDAAE287F7D8D8F52FEFDFA786CEFFA3644F011EEA  src/app/api/payments/checkout/route.ts`
- `93A002C9FB9FCEF09F4B8FB5BCBE0E0022DFD688A204EE8209C30E6942CF41E3  src/app/api/payments/checkout/route.test.ts`

## 分數與 blocker

- G7-24 已將固定功能 `Checkout／付款` 重算為 `8.0/10`；本輪關閉 residual P2，不重複加分。
- Latest canonical total 維持 `74.0`。CAT04=`6.0` 與 CAT10=`4.5` 的外部／真人 blocker 繼續跳過，不阻擋其他產品功能。
- 沒有執行 PayUni Sandbox、staging、Production、正式付款、正式資料庫或 deploy；沒有重跑 FIN-08AA、WP-196、WP-197 的 terminal 路徑。

## 回滾範圍

- `src/app/api/payments/checkout/route.ts` 的 provider admission helper 與 503 branch。
- `src/app/api/payments/checkout/route.test.ts` 的 unsupported-provider no-write contract。

## 下一工作

轉入 G7-26，修正多筆 partial refunds 已處理完成時，客服退款 handoff 仍無法結案的 P1 功能缺口。
