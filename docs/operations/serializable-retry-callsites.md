# Serializable 交易呼叫點清單（F-055）

F-055（B03-22、B04-14）新增共用的 `src/lib/serializable-retry.ts`：`withSerializableRetry(op, { attempts, baseDelayMs, maxDelayMs, retryOn })` 對整段操作重試，`runSerializable(db, op, options)` 包一個 Serializable 互動交易，兩者都用指數退避加 full jitter，預設只重試 P2034。

已套用：

- `src/lib/inventory-reservations.ts`：庫存保留、釋放、過期清理共用的 `runSerializable`，5 次、25–400 ms。
- `src/lib/payment-webhooks.ts`：`processPaymentWebhook` 對 P2034／P2002 重跑整個 webhook 處理，3 次、50–500 ms。
- `src/lib/live-notification-delivery.ts`：`ensureLiveNotificationDelivery` 原本是兩段 Serializable 交易（#520）。B-3 改成一段 READ COMMITTED 交易加列鎖（見〈B-3 修正〉），用同一個 `withSerializableRetry` 對 P2034／40001／40P01（例如與設定寫入者死結）與 P2002 重試 3 次、預設 20–400 ms。

50 併發壓測的跑法與結果見文末〈50 併發壓測〉。

其餘呼叫點這次不改，只列出位置（`TransactionIsolationLevel.Serializable`，不含測試；行號為本次 commit 當下）。日後各自改用共用 helper 時，需確認該路徑可安全重跑（沒有交易外的副作用）。

- `src/app/actions.ts:1752`
- `src/app/actions.ts:1898`
- `src/app/actions.ts:2102`
- `src/app/actions.ts:2321`
- `src/app/actions/affiliate-actions.ts:56`
- `src/app/actions/buyer-support-actions.ts:100`
- `src/app/actions/buyer-support-actions.ts:139`
- `src/app/actions/commerce-order-actions.ts:43`
- `src/app/actions/consultation-actions.ts:530`
- `src/app/actions/course-payout-actions.ts:108`
- `src/app/actions/interaction-actions.ts:219`
- `src/app/actions/interaction-actions.ts:312`
- `src/app/actions/interaction-actions.ts:364`
- `src/app/actions/interaction-actions.ts:862`
- `src/app/actions/interaction-actions.ts:1052`
- `src/app/actions/invoice-actions.ts:184`
- `src/app/actions/platform-referral-payout-actions.ts:77`
- `src/app/actions/platform-referral-payout-actions.ts:119`
- `src/app/actions/support-case-actions.ts:63`
- `src/app/actions/team-membership-actions.ts:40`
- `src/app/actions/vendor-member-actions.ts:98`
- `src/app/actions/vendor-member-actions.ts:221`
- `src/app/actions/webinar-resource-actions.ts:401`
- `src/app/api/checkout/upsell/route.ts:63`
- `src/app/api/live-interactions/route.ts:417`
- `src/app/api/live-interactions/route.ts:476`
- `src/app/api/webhooks/payment-methods/route.ts:340`
- `src/lib/affiliate-payee-profile.ts:35`
- `src/lib/affiliate-payee-profile.ts:56`
- `src/lib/affiliate-portal.ts:37`
- `src/lib/affiliate-remuneration-quotes.ts:59`
- `src/lib/affiliate-remuneration-quotes.ts:81`
- `src/lib/affiliate-remuneration-quotes.ts:110`
- `src/lib/billing-cycle.ts:259`
- `src/lib/buyer-support-access.ts:207`
- `src/lib/commerce-shipping-action.ts:34`
- `src/lib/course-community.ts:28`
- `src/lib/course-curriculum.ts:48`
- `src/lib/email-delivery-operations.ts:334`
- `src/lib/email-delivery.ts:382`
- `src/lib/email-delivery.ts:433`
- `src/lib/email-delivery.ts:578`
- `src/lib/form-submission-verification-domain.ts:240`
- `src/lib/learner-consultation-reminders.ts:58`
- `src/lib/learner-notification-outbox.ts:29`
- `src/lib/learner-notification-preferences.ts:46`
- `src/lib/learner-notification-source-events.ts:84`
- `src/lib/learner-notification-verification.ts:21`
- `src/lib/line-login.ts:232`
- `src/lib/live-chat.ts:573`
- `src/lib/live-notification-delivery.ts:844`（legacy cutover；B-3 時重新標示行號）
- `src/lib/live-private-chat.ts:98`
- `src/lib/live-private-chat.ts:201`
- `src/lib/live-quota-admission.ts:287`
- `src/lib/merchant-affiliate-payout-policy.ts:24`
- `src/lib/merchant-affiliate-policy-service.ts:20`
- `src/lib/payuni-pending-refund-proof.ts:58`
- `src/lib/payuni-pending-refund-proof.ts:76`
- `src/lib/payuni-refund-execution.ts:119`
- `src/lib/payuni-refund-execution.ts:241`
- `src/lib/payuni-refund-hold-release.ts:244`
- `src/lib/payuni-refund-reconciliation.ts:277`
- `src/lib/platform-plan-checkout.ts:462`
- `src/lib/post-purchase-checkout-recovery.ts:140`
- `src/lib/post-purchase-checkout-recovery.ts:182`
- `src/lib/settlement-adjustment.ts:81`
- `src/lib/stream-usage-reconciliation.ts:287`
- `src/lib/stream-usage-reconciliation.ts:356`
- `src/lib/stream-usage.ts:389`
- `src/lib/student-course-learning.ts:115`
- `src/lib/team-funnel-pages.ts:241`
- `src/lib/team-funnel-sharing.ts:193`
- `src/lib/wp4-buyer-callback-retry.ts:82`
- `src/lib/wp4-payuni-sandbox-payment-attempt.ts:73`

## 50 併發壓測

F-055 剩下的「50 併發壓測」用 `src/lib/serializable-stress.db.test.ts` 驗證。它只連 Vitest 設定已檢查過的 loopback `celebratedeal_*` 資料庫（`scripts/local-database-safety.ts`），不碰 staging 或 Production。

### 怎麼跑

- 一般 DB 測試（`npm run test:db`、CI 的 `test:coverage` 與 `test:db:concurrency`）每條路徑以 10 個併發呼叫者跑同一個檔案，約 4 秒。
- 50 併發只在手動跑：`npm run test:db:stress`。設定在 `vitest.serializable-stress-db.config.ts`：只跑這個檔案、`SERIALIZABLE_STRESS_CONCURRENCY=50`、Prisma `connection_limit=60`，讓每個呼叫者都有自己的連線，衝突發生在 PostgreSQL 內而不是連線池排隊。
- 要模擬 Production 的小連線池（F-090 建議每個函式實例 3–5）：`SERIALIZABLE_STRESS_CONNECTION_LIMIT=5 npm run test:db:stress`。也可用 `SERIALIZABLE_STRESS_CONCURRENCY` 改併發數（2–200）。
- 每條路徑輸出一行 `[serializable_stress] {...}`：結果分類、每個呼叫者開過的 Serializable 交易數（attempts）、p50／p95 延遲與總耗時。

資料庫可用全新的 disposable 容器，例如：

```bash
docker run -d --name f055-stress-pg -p 127.0.0.1:55471:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=celebratedeal_test postgres:16-alpine -c max_connections=300
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55471/celebratedeal_test?schema=public' DIRECT_URL="$DATABASE_URL"
export JOB_SECRET=ci-job-secret-123456 CSRF_SECRET=ci-csrf-fixture-32-bytes-safe-key   # CI 的合成值
npm run db:migrate:deploy && npm run test:db:stress
```

### 測了哪些路徑、斷言什麼

| 測試 | 呼叫的程式 | 斷言 |
|---|---|---|
| 結帳庫存保留 | `createReservedPaymentTransaction`＋`createCommerceOrderForCheckout`（與 checkout route 相同的同交易建單） | N 件商品、2N 個買家：剛好 N 個成功，其餘是 `InventoryUnavailableError`；庫存 0、不為負；付款、訂單、保留各 N 筆；金額都是商品的伺服器價格 |
| 限量快閃 | 同上＋`consumeFlashSaleQuote`（`stockLimit`） | 剛好 `stockLimit` 個名額被核銷；付款金額都是伺服器的優惠價；其餘是 `FlashSaleUnavailableError` |
| 付款 webhook（route） | `POST /api/webhooks/payments`，同一個 event 由所有呼叫者同時送達 | 只有一個請求處理；其他回 200（已處理）或 503（處理中，provider 會重送），沒有 500；訂單只有一筆 `payment.paid` 事件；庫存不會再扣一次 |
| 付款 webhook（不經 event claim） | `processPaymentWebhook` 直接被同時呼叫 | 仍只有一筆 `payment.paid`；失敗者都是用完 3 次的 P2034，重送後成功 |
| 直播通知：同一個收件人 | `ensureLiveNotificationDelivery`（#520、B-3） | 沒有失敗；只有一筆 EmailDelivery，一個 `queued`、其餘 `duplicate` |
| 直播通知：不同收件人 | 同上，每個呼叫者一位不同的已驗證報名者 | B-3 起：沒有失敗、每個呼叫者只開 1 次交易（不重試）、全部 `queued`、每位收件人剛好一筆 |

所有失敗都必須是領域錯誤，或是用完該路徑整個重試預算的暫時性衝突（P2034／P2002，以呼叫者自己的交易紀錄確認最後連續失敗次數等於預算）。提早放棄的 P2034、連線池逾時或其他例外都會讓測試失敗。交易紀錄包含所有明確指定隔離等級的互動交易（Serializable，以及 B-3 起直播通知的 READ COMMITTED）。

### 2026-10-30 結果

環境：Windows 主機（8 核心）、Docker PostgreSQL 16.14（loopback、全新資料庫、130 個 migration）、Prisma 6.19.3、Node 22.23。base `001d1b20`。延遲是單一呼叫者從開始到結束的時間，結帳與快閃包含模擬的重新載入。

| 路徑 | 50 併發、連線池 60（三次） | 50 併發、連線池 5 | 10 併發（一般 DB 測試） |
|---|---|---|---|
| 結帳 25 件／50 人 | 25 成功（第一次就成功 1 人，最多重新載入 24 次）、25 售完；attempts 平均 37.5、最多 50；p95 6.6–7.9 s | 25／25；平均 13.7；p95 3.0 s | 5／5；p95 0.5 s |
| 快閃 10 名額／50 人 | 10 成功（第一次就成功 1 人，最多重新載入 9 次）、40 名額已滿；平均 18.8；p95 5.4–6.2 s | 10／40；p95 2.7 s | 2／8；p95 0.5–0.8 s |
| webhook route 同一 event | 1 個處理、49 個 503；共 1 次交易；p95 0.2–0.3 s | 同左 | 1／9 |
| webhook 不經 claim | 3 成功、47 個用完重試；p95 0.9–1.3 s | 25／25 | 5／5 |
| 通知：同一收件人 | 50 成功（1 queued、49 duplicate）；p95 1.2–1.3 s | 同左；p95 0.8 s | 10 成功 |
| 通知：不同收件人 | 3 成功、47 個用完重試；p95 0.8–1.0 s | 24／26 | 3／7 |

沒有超賣、庫存沒有變負、每個付款事件只有一次 paid 轉換，也沒有未被攔下的 P2034（測試全部通過）。以下是壓測找到、這個 PR 沒有修的問題：

1. **結帳：同一商品同時下單，每一輪只有一人成功（體驗問題，非超賣）。** 每次保留庫存都會把 `Product.revision` 加 1，而 checkout 用 admission 當下的 revision 做 CAS（`inventory-reservations.ts` 的 `ProductChangedError`、checkout route 的 `admission.productRevision !== product.revision`）。這是 G7-10／G7-14 刻意的設計，避免舊表單覆寫庫存、避免用過期的價格。代價是：一筆成交會讓其他所有已 admission 的買家拿到 409「Product changed; reload checkout」。50 人搶 25 件時只有 1 人第一次就成功，賣完 25 件要 25 輪，最慘的買家要重新載入 24 次；快閃也一樣。實際上每一輪是一次使用者重新整理加重新 admission，比測試裡模擬的立即重試更慢。建議把「商品內容版本」和「庫存數量」分開：價格與內容變更才推進 checkout 用的 revision，庫存只用 `inventory >= quantity` 條件扣減（商家編輯庫存另用自己的 CAS）。這會動到 checkout、快閃與 post-purchase 的 revision 證據，需要 engineer-hard 實作、reviewer 審查，並由 owner 決定是否在封測前做。
2. **直播通知：不同收件人同時具現化，大多數用完重試。**（已在分支 `ai/live-notification-contention` 修正，合併前仍算未解決；見下方〈B-3 修正〉。） 50 位報名者同時通過驗證時，47 位的 `ensureLiveNotificationDelivery` 在 3 次後仍是 P2034（連線池 5 時 26 位，10 併發時 7 位）。原因是交易內「已寄出檢查」與「舊快照 supersede」兩個查詢沒有能縮小範圍的索引：`idempotencyKey` 的 `startsWith` 在 en_US collation 下用不到唯一索引，`sourceFormSubmissionId` 也沒有索引，所以會掃描整個商家的 EmailDelivery（空表時是 seq scan，鎖整張表；另以 5 萬筆其他商家資料 `ANALYZE` 後改走 `vendorId` 索引，結果仍是 47/50）。每個交易都讀到別人正在新增的列，形成 rw-conflict 環，每一輪只有最先提交的人成功。目前的影響有上限：報名驗證流程會攔下錯誤並回報（`verified_submission_materialize`），提醒在到期時由排程 `processDueLiveNotifications` 補建（取決於排程頻率，見 GO-NO-GO §5 B-1）。把重試改成 8 次、25–800 ms 試跑仍有 12/50 失敗、p95 3.7 s，所以只加重試不是解法。建議改成依收件人縮小讀取範圍（例如 `(vendorId, sourceFormSubmissionId)` 索引並確認查詢計畫，或改由 outbox／排程具現化），需要 migration 與 reviewer。
3. **用完重試時丟出的是原始 Prisma P2034，沒有專屬型別。** 每個 Production 呼叫點都會攔下：checkout 回 502「Unable to start checkout」，webhook route 回 500 並把 event 標成 failed 交給 webhook-retry，通知流程回報後由排程補。50 併發下 checkout 與 webhook route 都沒有發生；如果之後要讓買家看到「請稍後再試」，可以把用完重試的錯誤包成專屬型別並回 503 加 `Retry-After`，但要同步調整 `classifyPaymentWebhookErrorClass` 依 `error.name` 的分類。
4. **webhook 不經 event claim 時大量用完重試，但 Production 不會走到。** route 與 webhook-retry 都先以 `WebhookEvent` 的 CAS 認領，同一個 event 只會有一個處理者；route 測試證明 50 個同時送達只開了 1 次付款交易。其餘 49 個收到 503，要靠 provider 重送。

沒有驗證：staging 與 Production（依規定不跑）、Supabase transaction pooler（pgbouncer）模式、真實 PayUni 重送間隔。

## B-3 修正（2026-10-30，分支 `ai/live-notification-contention`，尚未合併）

### 原因

`ensureLiveNotificationDelivery` 的 Serializable 交易內有兩個讀 EmailDelivery 的查詢（已寄出檢查、舊快照 supersede），兩者都以 `vendorId + sourceLiveId + sourceFormSubmissionId + idempotencyKey LIKE '<rule 前綴>%'` 篩選，用不到能縮小範圍的索引，所以掃描整個商家的寄信紀錄並取得 SIREAD 鎖；其他收件人新增的列正好落在這個範圍，形成 rw-conflict 環，每一輪只有一人提交。

只加索引不夠：PostgreSQL 的 b-tree 謂詞鎖是頁級的，同時報名的收件人（cuid 相鄰）落在同一個索引葉頁，連用確定性 id 查主鍵也會鎖住其他人要插入的頁。只要 Serializable 交易讀了 EmailDelivery，不同收件人就會互相衝突。

### 設計

- 具現化改成一段 READ COMMITTED 互動交易。第一個語句以同一個 SQL 鎖住 `Live`、`LiveNotificationRule`、`MessageTemplate`（`FOR SHARE`）與 `FormSubmission`（`FOR NO KEY UPDATE`），每個鎖都綁 `vendorId`，沒有列就回 `not_configured`、不寫入。之後每個語句都看得到鎖之前已提交的資料。
- 不同收件人之間只有可共用的 `FOR SHARE` 鎖，不會互相等待或中止；同一收件人的呼叫者在報名列上排隊，前一個提交後下一個看到既有列，回 `duplicate`（或重新啟用 superseded 的列）。
- 一位收件人一條規則只有一列：確定性 delivery id 是主鍵，加上收件人鎖讓「已寄出檢查 → supersede 其他快照 → 查既有列 → 新增或重新啟用」在同一收件人上不會交錯。沒取這個鎖的寫入者（legacy cutover，仍是 Serializable）撞到 P2002 時，整步重跑並看到既有列。死結（與設定寫入者，40P01）也會重跑；重試仍是 3 次。
- 原本兩段交易（P2002 時第一段的 supersede 被回滾，第二段只接手）合成一段，所以接手既有列時也會 supersede 同一收件人、同一規則的其他舊快照。
- 抑制、黑名單、退訂：交易內照舊查 `EmailSuppression` 與 `Blacklist`，寄送前的快照與抑制檢查不變。這條路徑沒有 opt-out 或靜音時段規則。
- 設定與生命週期寫入者：直播開始／結束、規則編輯（直播更新交易，READ COMMITTED）與範本編輯都先更新 `Live`／`MessageTemplate`，所以會等進行中的具現化提交，之後的 supersede 看得到它的列（`live-notification-delivery.db.test.ts` 以真實交易驗證開播的情況）。原本的 Serializable 對這些 READ COMMITTED 寫入者沒有保護，這部分比原本嚴格。
- 常青啟用（#507／#520）仍是 Serializable，supersede 讀交易開始時的快照，看不到等它期間才提交的具現化列。啟用成功後另跑 `supersedeFixedTimeNotificationsForActiveEvergreen`（READ COMMITTED，`Live` `FOR NO KEY UPDATE` 後確認仍是有效常青才 supersede）。`evergreen-rematerialization.db.test.ts` 重現這個交錯：拿掉這一步時列會留在 `queued`，加上後變成 `superseded`。這一步失敗只回報，寄送前的快照檢查仍會攔下。
- 新索引 `EmailDelivery(vendorId, sourceFormSubmissionId)`（migration `20261031090000_email_delivery_source_submission_index`）讓兩個查詢不再掃整個商家；5 萬筆合成資料下兩者都走這個索引。正確性不依賴索引。

### 前後數字

同一台 Windows 主機、Docker PostgreSQL 16（loopback、全新資料庫、131 個 migration）、Prisma 6.19.3。前＝base `e32549ba`，後＝本分支。latency 是單一呼叫者從開始到結束。

| 情境 | 前：結果 | 前：attempts 平均 | 前：p95 | 後：結果 | 後：attempts | 後：p95 |
|---|---|---|---|---|---|---|
| 不同收件人，50 併發、連線池 60 | 3 成功、47 用完重試 | 2.94 | 1.1 s | 50 成功（三次都是） | 每人 1 | 0.36–0.44 s |
| 不同收件人，50 併發、連線池 5 | 25 成功、25 用完重試 | 2.44 | 1.0 s | 50 成功 | 每人 1 | 0.53 s |
| 不同收件人，10 併發 | 4 成功、6 用完重試（10-30 原紀錄 3／7） | 2.7 | 0.26 s | 10 成功 | 每人 1 | 0.11 s |
| 同一收件人，50 併發、連線池 60 | 50 成功（1 queued、49 duplicate） | 2.94 | 1.6 s | 50 成功（1 queued、49 duplicate） | 每人 1 | 2.3–3.0 s |
| 同一收件人，50 併發、連線池 5 | 同上 | 1.98 | 0.8 s | 同上 | 每人 1 | 1.4 s |
| 同一收件人，10 併發 | 同上 | 1.9 | 0.45 s | 同上 | 每人 1 | 0.47 s |

其他四條路徑（結帳、快閃、兩個 webhook）的結果與上面 10-30 的紀錄相同。

代價：同一收件人的呼叫者改為排隊，50 個同時呼叫時最後一個約 3 s（原本是並行後各自重試）。等待時間算在 Prisma 互動交易預設的 5 s 期限內，依本機每筆約 60 ms 估算，約 80 個同時呼叫同一收件人才會開始逾時（P2028，被呼叫端攔下，由排程補）。正式環境同一收件人的同時呼叫只有驗證流程、排程與常青重建，最多幾個。

測試斷言：不同收件人時沒有失敗、每個呼叫者只開 1 次交易、全部 `queued`、每位收件人剛好一筆；同一收件人時沒有失敗、狀態剛好 `{ queued: 1, duplicate: N-1 }`、只有一筆 EmailDelivery。