# PR #454 複審：工作線 A 修正

- 範圍：`git diff 074f5c33..HEAD`，4 個 commit：
  - ff9e07f0：A-1、A-2、A-6
  - 144f6e01：A-3、A-7
  - 8fee2838：A-4、A-8
  - 74ce8ec7：A-9
- 對照：`docs/review-2026Q4/35-pr454-lineA-review.md`
- 審查者：reviewer 子代理（Opus），只回報、不改程式

## 逐條狀態

| # | 原等級 | 狀態 | 說明 |
|---|---|---|---|
| A-1 | MAJOR | **已修正** | 細節見下方「A-1 確認」。 |
| A-2 | MINOR | **已修正** | 沒有序號的退款一律 `refund_reference_missing`，不會入帳。`payuni.test.ts` 的 it.each 涵蓋同額第二筆、只有合成 EventId、序號為空白三種情況。 |
| A-3 | MINOR | **大致修正** | `billing.ts` 新增 `refundRecord.count`（`paymentTransaction.currency != TWD`）。當月退款若屬於早期的非 TWD 交易，會丟 `UnsupportedCurrencyError`。佣金 ledger 彙總仍沒有幣別條件（見 R-3），上線前有 runbook 9.1 的查詢把關，降為 NIT。 |
| A-4 | MINOR | **已修正** | 遠端 deploy 要同時滿足三個條件：`ALLOW_REMOTE_MIGRATE_DEPLOY=1`、`MIGRATE_DEPLOY_WORKFLOW` 在 `APPROVED_REMOTE_MIGRATE_WORKFLOWS` 白名單內（用 `Object.hasOwn`，`constructor` 這類原型鍵會被拒絕）、平台標記也要對應（`vercel-staging-build` 需要 `VERCEL=1`）。單獨的 `GITHUB_ACTIONS` 或 `VERCEL` 不再足夠。runbook 改寫為：production 目前沒有登記的 workflow，需 owner 授權後以 PR 新增；並註明這是防誤用，不是權限控制。 |
| A-5 | NIT | 不變 | gate 數字同步。複審時用 `vitest list` 計數：merchant-affiliate 67、subscription-recovery 88、post-purchase 單元 199，與三個 gate 的設定值一致。 |
| A-6 | NIT | **已修正** | `KNOWN_FAILURES` 新增 `scope_missing` 與 `order_ambiguous` 兩個分類，並有測試。 |
| A-7 | NIT | **已修正** | `billing-cycle-job` 新增 `unsupportedCurrency` 計數，並有 job 與 route 測試。 |
| A-8 | NIT | **已修正** | `validateMigrateArguments`：deploy 不接受任何參數；dev 只接受 `--name`／`-n`、`--create-only`、`--skip-seed`、`--skip-generate`。`--schema`、`--config`、`--url`、`--force` 都會回 `argument-not-allowed`。 |
| A-9 | NIT | **已修正** | `product-form.test.tsx` 補了舊幣別勾選框與 hidden TWD 的測試；`reconciliation.test.ts` 補了 metadata referral 的測試。 |
| A-10 | NIT | 不變 | 原本就不需處理。 |

## A-1 確認

1. **有序號時的 eventId**：退款通知以 `CloseNo ?? RefundNo` 作為 eventId（`payuni.ts` 的 `legacyNoticeEventId`），與本地退款寫入的 `RefundRecord.providerEventId`（`CloseNo ?? RefundNo ?? TradeNo`）同源。同一序號重送時，會在 `WebhookEvent` 去重，也會被 `duplicateRefund` 判成重複；wp4 第二個新測試驗證了這點。provider 的 `EventId` 對退款通知不再有效，只有失敗通知仍使用 `EventId` 或 `failed:<TradeNo>`。eventId 是否全域唯一，取決於 PayUni 序號的實際語意，見 R-1。
2. **沒有序號時**：丟出 `PaymentWebhookNotActionableError("refund_reference_missing")`，`tradeStatus` 為 `legacy_refund`。
   - route 的 `notActionableResponse` 會呼叫 `recordPaymentWebhookManualReconciliation`，建立 `manual:<TradeNo>:legacy_refund:none` 事件，狀態為 `needs_manual_reconciliation`，並帶 vendorId。
   - 因為 `tradeStatus` 不是 `1`，不會走 `alreadyPaid` 的捷徑。route 會送出 `captureOperationalError`（level error），回 200 `manual_reconciliation`。
   - 不會建立 `RefundRecord`，也不會改 `refundedAmountCents`。
   - `resolveManualReconciliationForPaidTrade` 只關閉 `:1:` 的紀錄，不會誤關這類紀錄。
3. **三組測試是否涵蓋要求的情境**
   - 同額兩筆無序號：wp4 第一個新測試送兩次相同通知，斷言只有一筆 manual 事件、0 筆 `RefundRecord`、交易仍是 paid。`payuni.test.ts` 也在 normalize 層涵蓋。
   - 有序號重送：wp4 第二個新測試斷言第一次入帳、重送回 `duplicate: true`、只有一筆 `RefundRecord`，且 `providerEventId` 為序號。
   - TradeNo 與序號混淆：`payment-webhooks.test.ts` 的 it.each 有兩個方向：本地以 TradeNo 記帳後收到序號通知；本地以序號記帳後重放 TradeNo。兩者都 `rejects.toThrow("需人工對帳")`，`RefundRecord` 仍是 1 筆，金額不變。
   - 我沒有可用的 PostgreSQL，這三組 DB 測試是讀碼確認，沒有實跑。
4. **retry 對舊事件的處理**
   - `webhook-retry` 本身沒有修改，仍使用已儲存的 eventId 重放。
   - 舊格式 `TradeNo` 的事件：已有 processed 退款時，`hasAmbiguousPayUniRefundIdentity` 會拒絕，以 `order_ambiguous` 失敗，最後 exhausted 並告警。沒有 processed 退款時會先入帳；之後收到的序號通知會因為「TradeNo 退款已存在」被拒絕。兩條路徑都不會重複入帳。
   - 舊格式 `EventId` 的事件（只出現在合成 fixture）在程式裡沒有防護，改由 runbook 9.2 的部署前唯讀查詢把關：`received`／`retrying`／`failed` 的 payuni 退款事件必須為空。retry job 只會認領 `failed`，`exhausted` 不會自動重放，所以查詢範圍足夠。

## 新發現或殘留

| # | 等級 | 位置 | 問題 | 建議 |
|---|---|---|---|---|
| R-1 | MINOR | `src/lib/payment-providers/payuni.ts`（`legacyNoticeEventId`）；`src/lib/payment-webhook-invariants.ts:29-35` | **序號語意未經 Sandbox 驗證，程式內也已標示「待確認」。** (a) eventId 直接使用原始序號，沒有加上 TradeNo 命名空間。若 PayUni 的 `CloseNo` 只在單一交易內唯一（例如每筆交易都從 1 起算），另一筆交易的退款通知會在全域的 `WebhookEvent(provider, eventId)` 被當成重複，靜默少記。(b) 若退款 API 回傳 `CloseNo`，而通知只帶 `RefundNo`，同一筆退款會被當成兩筆。fixture 註解說明這種通知並非 PayUni 實際格式（實際退款是透過 refund 與 query API 確認），所以目前風險低。 | Sandbox 確認後：`WebhookEvent` 的 ID 加上 `refund:<TradeNo>:<serial>` 命名空間，比對 `RefundRecord` 時另外傳入原始序號；或者當同一交易已有同金額、不同序號的 processed 退款時，改走人工對帳。 |
| R-2 | NIT | `scripts/db-migrate-guard.ts`（`validateMigrateArguments`） | `--name` 的值的 regex 允許開頭是 `-`，所以 `--name --create-only` 會被當成名稱值。這不會改變目標，Prisma 也可能自行報錯。 | 值禁止以 `-` 開頭。 |
| R-3 | NIT | `src/lib/billing.ts:223` | 佣金 ledger 彙總沒有排除早期非 TWD 交易的沖銷（A-3 的殘留）。 | 比照退款，加上 `count` 檢查。 |
| R-4 | NIT | `src/lib/payment-webhook-invariants.ts` | 「無法區分」的退款會以 `order_ambiguous` 回 500，PayUni 會持續重送，事件最後變成 exhausted 才告警，沒有像無序號那樣直接建立人工對帳紀錄。不會入帳，所以安全。 | 可改丟 not-actionable，立即建立人工對帳紀錄並告警。 |

各等級總結：**BLOCKER：無。MAJOR：無。** MINOR：R-1。NIT：R-2、R-3、R-4。

## 驗證紀錄

- 已跑：payment-providers、payment-webhook-errors、billing、billing-cycle、billing-cycle-job、billing-cycle route、product-form、reconciliation、db-migrate-guard、webhooks/payments route、product-actions、checkout route，共 16 個檔案、456 個測試全部通過。
- 已用 `vitest list` 確認三個 gate 的數字：67、88、199。
- `npm run typecheck` 通過；對變更檔案跑 eslint 通過。
- **未跑**：`payment-webhooks.test.ts`、`wp4-buyer-ops.db.test.ts` 等 DB 測試（本機沒有 PostgreSQL）。複審當下 CI `quality` 與 Vercel staging build 都還在 pending；合併前需確認兩者通過。

可合併
