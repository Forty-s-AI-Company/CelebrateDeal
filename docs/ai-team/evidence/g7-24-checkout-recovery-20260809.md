# G7-24 Checkout and payment recovery checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL_EXTERNAL_GATE_PENDING`。本輪關閉 current source 中兩個 checkout P1：付款失敗／逾期後沒有安全重試入口，以及 provider 無法提供付款去向時仍先建立訂單或占用資源。沒有操作 PayUni Sandbox、Production、正式付款或正式資料。

## 產品修正

- 付款結果頁只對 `payment_failed` 與 `expired` 顯示重新結帳 CTA。連結由 server 驗證的 buyer-support grant、訂單 vendor 與第一個 order item product ID 組成，不採用 query string 指定商品。
- `paid`、`pending_payment`、`partially_refunded`、`refunded` 與 `cancelled` 不會顯示重付 CTA，避免已完成或不可重試訂單被導向新付款。
- Payment provider 新增 runtime readiness 契約。PayUni 只有在 merchant、key material 與 environment 都符合目前 adapter 要求時回報 ready；尚未完成的 ECPay-like adapter 回報 unavailable；demo 明確限制在非 Production。
- 商品 checkout 在建立 PaymentTransaction、CommerceOrder 與 inventory reservation 前完成 readiness 預檢。
- Invoice payment 在建立 pending transaction 前完成預檢；paid plan checkout 在 supersede 舊 subscription、建立 pending subscription、referral attribution 與 payment transaction 前完成預檢。
- provider 即使先回報 ready，若 session 沒有合法 redirect 或 form-post 目的地，商品 checkout 會執行既有 scoped compensation；invoice 與 paid plan 也會把新交易標為 failed 並清除可重試 key。

## Deterministic evidence

- 最終 targeted Vitest：`10 files／133 tests PASS`，failed=`0`、skipped=`0`、exit code=`0`。
- TypeScript `--noEmit`：`PASS`，exit code=`0`。
- scoped ESLint：`PASS`，exit code=`0`。
- 唯讀 reviewer：`NO_P0_P1`。Reviewer 沒有改檔、連外或操作資料庫。
- Source ownership 與 SHA-256：`docs/ai-team/evidence/g7-24-source-manifest-20260809.txt`、`docs/ai-team/evidence/g7-24-source-digests-20260809.txt`。
- Machine-readable report：`.ai-team/reports/g7-24-checkout-recovery-20260809.json`。

第一輪 targeted tests 曾有 `5/118` 失敗，均如實保留於工作記錄：一項測試假設 PayUni env 不存在、三項既有 fixture 與新 session destination 契約不一致、一項 Production demo 測試需明確使用 ready provider 才能驗證 app URL failure。修正 fixture 與型別後，最終 `133/133 PASS`；沒有降低 assertion 或新增 skip。

## Controlled production build

Receipt：`.ai-team/reports/g7-24-checkout-recovery-controlled-build-20260809.json`

Receipt SHA-256：`3a409e3de8ea5d7e59e8b2c88b87479ec9edfdd2051cc2d1da81420d6a34173b`

- 執行時間：2026-08-09T04:44:47.496Z 至 2026-08-09T04:59:29.917Z。
- no-env OS-temp mirror、synthetic allowlisted config、Next production build、exit code `0` 與 mirror cleanup 全部 `PASS`。
- `dotenvCopied=false`、`inheritedApplicationEnvironment=false`、external／production operations=false。

## Reviewer residual

- `P2`：若 `PAYMENT_PROVIDER` 是完全不支援的字串，商品 checkout 會在任何資料寫入前 throw，由框架處理成錯誤回應；目前缺少 bounded JSON 503 與對應 route test。這不會建立假訂單或占用庫存，也不構成本輪 P0/P1；保留給後續小型 recovery WP。

## 分數判斷

- 固定功能 `Checkout／付款` 由 `7.5` 重算為 `8.0/10`：core=`2.4`、recovery=`1.8`、UX=`1.4`、integrity/security=`1.0`、fresh evidence=`1.4`。
- canonical total 維持 `74.0`。CAT01=`8.0`、CAT02=`8.0` 沒有重複加分；CAT04=`6.0` 仍缺 fresh staging／PayUni Sandbox reconciliation，CAT10=`4.5` 仍缺真人與外部驗收。
- 本輪沒有重跑 FIN-08AA、WP-196、WP-197 或相同 terminal no-go probe。

## 回滾範圍

- Payment provider readiness type、三個 provider adapter 與 checkout destination validator。
- 商品 checkout route、invoice payment action、paid plan selection action。
- Buyer-support order item lookup與付款結果 retry CTA。
- 對應 unit／integration tests、controlled build runner 與本 checkpoint artifacts。

## 下一個最高價值工作

維持 CAT04／CAT10 blocker 跳過。重新掃描其餘 fixed functions 的 current P1，優先找會阻擋實際販售、內容建立、商家操作或買家轉換的缺口；unsupported-provider bounded JSON P2 保留為可順手合併的 recovery 項目，不先回到 coverage。
