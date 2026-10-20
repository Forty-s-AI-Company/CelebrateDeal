# PR #448 複審：工作線 A 修正（R448-01～R448-12）

- 範圍：`git diff 82f09e08..HEAD`（`def7befa`、`2a9d64b6`、`7786e6c2`），另快速掃過整體 `78621ca3..HEAD`
- worktree：`CelebrateDeal-wt-lineA`（唯讀）；審查者：reviewer（Opus），2026-10-19
- 對照：`docs/review-2026Q4/31-pr448-lineA-review.md`

## 實際執行的驗證

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 通過 |
| `npx eslint`（本輪變更的 .ts/.tsx/.mjs） | 通過 |
| vitest：`payuni.test.ts`、`payuni-setup.test.ts`、`webhooks/payments/route.test.ts`、`webhook-retry.test.ts`、`payuni-current-source-refund-qa.test.mjs`、`registration-actions.test.ts` | 6 個檔案、282 tests 通過 |
| `wp4-buyer-ops.db.test.ts`、`q1-downstream-readonly.db.test.ts`、`payment-webhooks.test.ts` 等 DB 測試；Playwright | **未執行**（本機沒有 PostgreSQL）。合併前仍需 CI 或 `npm run test:db` 補跑 |

## 原 findings 狀態

| ID | 狀態 | 說明 |
|---|---|---|
| R448-01 | 已解決（但修正帶出新的 RR-01） | 已收款但不自動入帳的回呼會建立 `needs_manual_reconciliation` 事件，保存有界識別碼並發 error 告警，pending 交易會被 hold；Notify 回 200，Return 導向 `review`。vendor 由伺服器紀錄推得（provider＋orderNumber，比對到不只一筆時不歸屬）。記錄失敗時回 500 讓 PayUni 重送。`trade_pending` 只寫 audit 並回 200 |
| R448-02 | 已解決 | `retryWebhookEvent` 遇到舊格式 PayUni paid 事件（eventId 不符合 `^.+:[0-9]{1,2}$`）會改成人工對帳，不會重送；runbook §3 附部署前唯讀查詢。新格式事件（含 `:數字`）照常重送，有測試覆蓋。舊格式的 refund／failed 事件不受影響 |
| R448-03 | 未解決（依計畫延後） | runbook §4 已列為正式收款前必修；封測（Sandbox）下可以接受 |
| R448-04 | 未解決（待 Sandbox） | runbook §5 第 2 點已記錄 |
| R448-05 | 部分 | 外層 Status 缺漏時，現在會進入人工對帳並 hold 交易，不再無聲丟掉，比原本安全；但仍需 Sandbox 確認，見 RR-01 |
| R448-06 | 未解決（owner 待辦） | runbook §5 第 7 點 |
| R448-07 | 未解決（owner 決策） | runbook §4 已標「只修一半」 |
| R448-08 | 已解決 | `optionalCents` 改用 `queryAmountCents` 的完整 token 規則（小數手續費也會被拒，見 RR-06） |
| R448-09 | 已解決 | 驗證碼錯誤時停在 `/mfa/verify?error=`，可以被分類，不會 timeout；所有 runner 都改用同一個等待條件 |
| R448-10 | 已解決 | 勾選文字改成「使用條款」「隱私通知」，e2e 同步 |
| R448-11 | 部分 | 只有人工對帳且比對到交易時，平台方案付款才會導回 `/billing/plans`；`trade_pending` 仍導向 `/checkout/result` |
| R448-12 | 已解決 | DB 測試改成斷言 reason 與識別碼 |

## 新 findings

| ID | 嚴重度 | 檔案:行號 | 情境 | 建議修法 |
|---|---|---|---|---|
| RR-01 | MAJOR | `src/lib/payment-webhook-manual-reconciliation.ts:47`；`src/app/api/webhooks/payments/route.ts:202-205` | 人工對帳事件的 eventId 是 `TradeNo:1`，和真正 paid 事件**完全相同**。只要人工對帳事件先建立，同一筆交易之後的合法 paid 就會被擋住。兩條觸發路徑：(a) Return 先於 Notify 抵達，而且外層 Status 不是 SUCCESS。這個欄位沒有簽章，買家瀏覽器可以竄改；如果 PayUni 的 Return 本來就不帶外層 Status，每一筆付款都會中招。(b) 內層先回 `UNKNOWN`／`TradeStatus=1`，之後才送 `SUCCESS`。後續的合法 paid Notify 會在 `findUnique` 拿到 `needs_manual_reconciliation` 事件，`claimWebhookEvent` 因狀態不是 received／failed 而回 `pending`，路由回 **503**。PayUni 會一直重送，但永遠不會自動入帳：買家已付款，訂單只能卡在人工處理。這不會被誤當成 paid（符合要求），但會反過來吞掉真正的 paid。DB 測試只覆蓋「同一份回呼的 Return／Notify 收斂」，沒有覆蓋「先人工、後合法 paid」。 | 1）人工對帳事件改用獨立 namespace，例如 `manual:${reason}:${TradeNo 或 MerTradeNo}:${TradeStatus}`，不要佔用 `TradeNo:1`。2）來源是 `return` 且只有外層 Status 不符（內層已簽章 SUCCESS）時，視為 `trade_pending`（不記錄、導向 pending），交給 Notify 決定。3）合法 paid 處理完成後，把同一筆交易的人工對帳事件標成已解決，並移除 hold。4）補一個 DB 測試：先送竄改外層 Status 的 Return，再送合法 Notify，結果必須是 paid 一次、Notify 200。 |
| RR-02 | MINOR | `src/app/api/webhooks/payments/route.ts:147-170` | 反方向：Notify 已經把 `TradeNo:1` 處理成 paid 之後，才來一個外層 Status 被竄改或缺漏的 Return。`recordPaymentWebhookManualReconciliation` 會拿到已 processed 的 paid 事件（不建新事件、也不 hold），但路由仍然發 error 級告警、寫 `manualReconciliation:true` 的 audit，並讓付款人看到「需要人工確認」頁。這是誤報，而且顯示給付款人的資訊也不對。 | 既有事件狀態是 `processed` 時，不發告警，並導向 `updated`。這可以和 RR-01 一起修。 |
| RR-03 | MINOR | `docs/launch/payuni-payment-callback-runbook.md` §2 第 3～4 點 | 人工對帳沒有任何結案工具：要移除交易的 hold 標記、把事件結案，只能直接改 DB（正式環境需要 owner 另外授權）。被 hold 的交易會無限期保留庫存。封測可以接受。 | 正式收款前，在財務後台補「結案」action（requireFinanceAdmin、寫 audit、只移除標記並關閉事件，不改金額）。 |
| RR-04 | MINOR | `src/lib/wp4-buyer-callback-retry.ts:90-92`；`src/lib/wp4-buyer-ops.db.test.ts`（fixture eventId 改成新格式） | WP4／Q1 的 Sandbox 歷史 recovery，如果 staging 上的事件是舊格式 paid，會被**單向**改成人工對帳，之後也無法再自動重送。runner 回報的是 `RETRY_FAILED`／`processing_failed`，看不出原因。DB 測試把 fixture 的 eventId 改成新格式才能維持綠燈，所以沒有測試覆蓋「runner 遇到舊格式」這條路徑。只影響 Sandbox，可以接受。 | outcome 為 `needs_manual_reconciliation` 時，回傳獨立的 `failureCode: "MANUAL_RECONCILIATION"`；部署前在 staging 跑 runbook §3 的查詢，列出受影響的 Q1／WP4 事件 ID 並記到 STATE。 |
| RR-05 | NIT | `src/lib/payment-providers/types.ts:221-224` | `boundedIdentifier` 會把 12～19 位連續數字當成卡號丟掉。如果 PayUni 的 TradeNo 是這種長度的純數字，audit 與對帳紀錄都會缺 TradeNo，eventId 也會退回 `MerTradeNo:1`（剛好避開 RR-01 的衝突，但這只是巧合）。 | 用 Sandbox 確認 TradeNo 格式；TradeNo 是 provider 識別碼，可以改成只套用在 Message 類欄位的卡號規則，或改存雜湊。 |
| RR-06 | NIT | `src/lib/payment-providers/payuni.ts:69-75` | 手續費欄位現在只接受整數或 `.0`／`.00`。萬一 PayUni 送出小數手續費，整個 paid 回呼都會被判成 invalid（400）。真實 UPP 應該不會帶這些欄位，所以影響很小。 | 只要 Sandbox 證實 UPP 不帶這些欄位，就維持現狀；否則改成手續費欄位缺漏或格式錯誤時忽略，而不是拒絕整個回呼。 |

各嚴重度數量（只計新 findings）：BLOCKER 0、MAJOR 1、MINOR 3、NIT 2。

## 逐項回答特別確認事項

- **後續 Notify 會不會重複建立或被當成 paid**：同一份不可入帳的回呼重送時，`findUnique` 會拿到既有事件，不會重複建立；`claimWebhookEvent` 與 `retryWebhookEvent` 都不會處理這個狀態，所以不會被當成 paid。但它會擋住同一個 TradeNo 之後的合法 paid（RR-01）。
- **Return 與 Notify 收斂到同一筆**：同一份回呼會收斂，DB 測試有驗證。
- **庫存逾期 job 對被標記的交易真的不釋放**：是。`releaseExpiredInventoryReservations` 遇到 pending 且有 hold 標記的交易會回 `held`；DB 測試在 24 小時後跑 job，確認保留仍是 `reserved`，交易仍是 `pending`。
- **記錄寫入失敗回 500 的副作用**：寫入是冪等的（事件用唯一鍵收斂，hold 用 `updateMany` 限定 pending）。PayUni 重送時只會補齊缺漏的部分，額外副作用只有重複的 Sentry 告警（有 fingerprint 會合併）。Return 路徑回 500 時，付款人會被導向 `pending`。沒有發現金額或狀態上的副作用。
- **R448-02 會不會誤殺新格式事件**：不會。新格式 eventId 一定是 `…:數字`，被 regex 排除，有單元測試覆蓋；舊的 eventId（PayUni TradeNo 或合成 EventId）都不含 `:`。WP4／Q1 遇到舊格式時轉人工的影響，在 Sandbox 可以接受（RR-04）。
- **後台「待人工對帳」是否有 vendor 綁定**：頁面由 `requireFinanceAdmin` 保護，屬於平台層級跨租戶的財務視圖，計數是全域的，這符合設計。事件的 `vendorId` 只從伺服器交易紀錄推得，不採用 payload；比對不到或比對到多筆時為 null；hold 的 `updateMany` 也綁定 `id＋vendorId＋status`。沒有任何商家端頁面讀取 WebhookEvent。

## 結論

R448-01、R448-02 的主要風險已處理，其餘項目都已修正，或已在 runbook 中明確延後。但 R448-01 的修法帶出 RR-01：人工對帳事件和合法 paid 共用 eventId，未簽章的外層 Status（或先 UNKNOWN 後 SUCCESS 的順序）可能讓真正的付款卡在 503，無法自動入帳。修法很小（獨立 namespace，加上 Return 只有外層 Status 不符時不記錄），需要補一個「先人工、後 paid」的 DB 測試；DB 測試與 e2e 也仍待執行。

需修正後再審
