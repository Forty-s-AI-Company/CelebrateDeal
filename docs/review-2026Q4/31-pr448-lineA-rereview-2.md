# PR #448 第三輪複審（RR-01、RR-02、RR-04）

- 範圍：`git diff 7786e6c2..HEAD`（`889d5610`）
- worktree：`CelebrateDeal-wt-lineA`（唯讀）
- 審查者：reviewer（Opus），2026-10-19
- 對照：`docs/review-2026Q4/31-pr448-lineA-rereview.md`

## 實際執行的驗證

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 通過 |
| `npx eslint`（本輪變更的檔案） | 通過 |
| vitest：`payuni.test.ts`、`webhooks/payments/route.test.ts`、`webhook-retry.test.ts`、`q1-original-callback-retry.test.ts` | 4 個檔案、207 tests 通過 |
| `wp4-buyer-ops.db.test.ts`（兩個新的順序測試）與其他 DB 測試、Playwright | **未執行**（本機沒有 PostgreSQL）。以下結論來自閱讀程式碼，合併前必須由 CI 或 `npm run test:db` 跑綠 |

## 指定確認事項

1. **獨立 namespace 讓後續合法 `TradeNo:1` 能正常入帳：確認。**
   - 人工對帳事件改用 `manual:<TradeNo 或 MerTradeNo>:<TradeStatus>:<PaymentType>`（`payment-webhook-manual-reconciliation.ts`），不再佔用 `TradeNo:1`。合法 paid 的 eventId 永遠不會以 `manual:` 開頭。
   - DB 測試「先竄改 Return → 再 UNKNOWN Notify（建立人工事件）→ 最後合法 Notify」斷言了以下結果：
     - `TradeNo:1` 為 processed／paid。
     - 人工事件變成 `manual_reconciliation_resolved`。
     - hold 已移除。
     - `payment.paid` 只發生一次。

2. **`outer_status_mismatch` 沒有死角：確認。**
   - 判斷順序改成：先看內層 Status，再看 PaymentType，最後才看外層 Status。所以外層不符只會發生在「已簽章且是合法刷卡 paid」的情況。
   - 只有 `source=return` 時不記錄，並導向 `pending`；Notify（或來源不明）時仍會建立人工事件並 hold。
   - 因此不會出現「Return 永遠 pending、Notify 又被忽略」：Notify 帶 SUCCESS 就正常入帳；Notify 也沒有外層 Status 就進人工對帳並 hold，錢不會被丟掉。
   - 剩下的情況是 Notify 完全沒送達。這和既有的 Notify 遺失風險相同，不是本次修改造成的。

3. **paid 入帳時標 resolved 與移除 hold 在同一交易：確認。**
   - `resolveManualReconciliationForPaidTrade(tx, …)` 與 `transactionMetadata` 移除 hold 的寫入，都在 `processPaymentWebhookOnce` 的同一個 `db.$transaction` 內（`payment-webhooks.ts:959` 起），條件都是 `eventType === "paid"`、`nextStatus === "paid"`。
   - 結案只比對同一個 provider、`manual:<ref>:1:` 前綴，ref 來自已簽章的 TradeNo 或 MerTradeNo，不會跨到其他交易。

4. **RR-02 的 `already_processed` 不會繞過金額比對：確認，但有 MINOR 殘餘（RR2-01）。**
   - `alreadyPaid` 分支只回傳 200 並寫 audit，不寫任何付款、訂單、佣金或庫存狀態，所以沒有繞過 `validatePaymentWebhookInvariants` 的途徑。
   - 但它只檢查「這個訂單已經付款」以及 `tradeStatus === "1"`，沒有比對 TradeNo 或 PaymentType，見 RR2-01。

5. **兩個新 DB 測試真的覆蓋先後順序：確認（閱讀層面）。**
   - RR-01 測試依序跑「竄改 Return → UNKNOWN Notify → 合法 Notify」，並在每一步斷言狀態。
   - RR-02 測試依序跑「合法 Notify → 缺外層 Status 的 Notify → UNKNOWN Notify」，斷言回 `already_processed`、沒有任何 `manual:` 事件、交易仍是 paid。
   - 兩者都走真實的 route 與 PostgreSQL，但本輪沒有實際執行。

另外，RR-04 已解決：WP4／Q1 遇到舊格式事件時，回傳獨立的 `failureCode: "MANUAL_RECONCILIATION"`。

## Findings

| ID | 嚴重度 | 檔案:行號 | 情境 | 建議修法 |
|---|---|---|---|---|
| RR2-01 | MINOR | `src/lib/payment-webhook-manual-reconciliation.ts`（`alreadyPaid` 判斷：`transaction && tradeStatus === "1" && PAID_STATUSES.has(transaction.status)`） | 同一個 MerTradeNo 已經用信用卡入帳後，如果又出現**另一個 TradeNo** 的 `TradeStatus=1`、`PaymentType=2`（例如 `Credit=1` 沒有生效、買家先取 ATM 號碼又刷卡，之後又去繳 ATM），會被當成 `already_processed`。結果是不建立人工事件、不告警，只留下一筆 `alreadyPaid:true` 的 audit。這種重複收款，正是人工對帳機制要抓的情況。前提是 Sandbox 待驗的「非卡片付款工具會出現」，所以封測下可以接受。 | `alreadyPaid` 只在以下條件都成立時才算數：reason 是 `outer_status_mismatch` 或 `provider_status_not_success`、`PaymentType=1`，而且 callback 的 TradeNo 等於 `transaction.providerTradeNo`。其他情況（不同 TradeNo 或非卡片付款）照樣建立人工事件並告警。正式收款前修正。 |
| RR2-02 | NIT | `src/lib/payment-webhook-manual-reconciliation.ts`（`alreadyPaid` 檢查與建立事件不在交易內） | 人工記錄和 paid 入帳同時發生時：人工記錄先讀到 pending，接著 paid 提交並完成結案，人工事件才建立。最後會留下一筆仍是 `needs_manual_reconciliation` 的事件。hold 的 `updateMany` 限定 pending，所以不會 hold。只會造成營運噪音，不影響金額。 | 結案工具（RR-03）上線時，一併提供「交易已 paid 時一鍵結案」。 |
| RR2-03 | NIT | `src/lib/payment-webhook-manual-reconciliation.ts`（`startsWith manual:${ref}:1:`） | ref 同時用 TradeNo 和 MerTradeNo。如果某個 MerTradeNo 剛好等於另一筆交易的 TradeNo，理論上會誤結對方的人工事件。實際上兩者格式不同，機率極低。 | 可以在 eventId 加上 ref 類型前綴（`t:`／`o:`）。 |

各嚴重度數量：BLOCKER 0、MAJOR 0、MINOR 1、NIT 2。

本輪沒有發現 BLOCKER 或 MAJOR。

## 結論

RR-01、RR-02、RR-04 都已解決，指定的五項確認都成立。RR2-01 是封測（Sandbox）下可以接受的殘餘，應在正式收款前修正，並記入 runbook §4。合併條件：CI（含 `npm run test:db` 中的 `wp4-buyer-ops.db.test.ts`、`payment-webhooks.test.ts`）與 e2e 全綠；若 DB 測試失敗則需回到本審查。

可合併
