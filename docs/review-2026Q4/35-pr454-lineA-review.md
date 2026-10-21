# PR #454 審查：工作線 A 付款與 migration 防呆

- 分支：`codex/beta-l1-lineA-payments`（worktree `CelebrateDeal-wt-lineA`）
- 範圍：`git diff origin/master..HEAD`（已先 `git fetch origin master`），5 個 commit：
  527ddeb2（TWD）、c1f85ed0（未知訂單）、9559ec24（gate 數）、9cc56736（退款事件 ID）、074f5c33（migrate 防呆）
- 背景：`13-payments-finance.md`（B03-05、B03-13）、`14-data-migration.md`（B04-11、B04-13）
- 審查者：reviewer 子代理（Opus），只回報、不改程式

## 結論摘要

TWD 限制、未知訂單封鎖、gate 數與 migrate wrapper 大致正確，沒有 BLOCKER。
有一項 MAJOR：F-067 新的舊式退款通知 eventId 與本地退款紀錄的 `providerEventId` 對不起來。
同一筆部分退款可能被記兩次，部署前後重送也可能重複套用。這是金流冪等性問題，需要修正後再合併。

## Findings

| # | 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|---|
| A-1 | MAJOR | `src/lib/payment-providers/payuni.ts:150`（`legacyNoticeEventId`）、`:583-585`；`src/lib/payuni-refund-execution.ts:148`；`src/app/actions.ts:~2316`；`src/lib/payment-webhook-invariants.ts:75`；`src/lib/payment-webhooks.ts:793-797` | **退款冪等性退步，可能把同一筆退款記兩次。** 本地發起的退款（admin action 與 payuni-refund-execution）把 `RefundRecord.providerEventId` 存成 `CloseNo ?? RefundNo ?? TradeNo`。修改前，沒有 `EventId` 的舊式退款通知，eventId 會落在 `TradeNo`，能被 `duplicateRefund` 認成同一筆。修改後 eventId 變成 `partially_refunded:<TradeNo>:<cents>`，比對不到既有紀錄。情境 (a)：本地部分退款 NT$500 成功，且 PayUni 只回 TradeNo。接著同 TradeNo 的部分退款通知送達，這筆會被當成新退款：再建一筆 `RefundRecord`，`refundedAmountCents` 加倍，佣金、課程分潤與平台推薦的退款沖銷也會做兩次，月結少付商家。全額退款則因剩餘額度為 0 而 fail closed，但會一直 500 並進入重試。情境 (b)，部署邊界：部署前收到、狀態為 failed/retrying 的舊式退款事件，`webhook-retry` 會用舊 ID（`TradeNo`）重放。PayUni 部署後的重送則拿到新 ID。兩者各套用一次，部分退款就會被記兩次。 | 舊式通知（非 UPP）若沒有 provider 退款序號（`EventId`、`CloseNo`、`RefundNo`），不要自動套用退款。改成 `PaymentWebhookNotActionableError` 或人工對帳紀錄，這也與程式內「待 Sandbox 確認」的註解一致。若要保留自動套用，至少要做到兩點：一、優先使用 `CloseNo` 或 `RefundNo`；二、比對既有 `RefundRecord.providerEventId ∈ {CloseNo, RefundNo, TradeNo}` 且金額相同時，視為重複。補一個 DB 測試：本地退款（`providerEventId = TradeNo`）之後收到舊式部分退款通知，不得產生第二筆 `RefundRecord`。部署前也要以唯讀查詢確認沒有 payuni 的 refund 類事件停在 `received`／`retrying`／`failed`。 |
| A-2 | MINOR | `src/lib/payment-providers/payuni.ts:150-162` | **兩筆金額相同、都沒有 EventId 的部分退款仍會合併。** 第二筆通知回 `duplicate: true` 200，退款少記，月結多付商家，佣金也沒有沖回。修改前所有後續通知都會合併，所以這次是縮小問題，不是新增；註解已標示待 Sandbox 確認。 | 與 A-1 一起處理：沒有 provider 退款序號就 fail closed，交人工對帳；不要用金額組合合成身分。 |
| A-3 | MINOR | `src/lib/billing.ts:211`、`:223`、`:241` | **月結的幣別檢查只涵蓋當月發生的交易。** 當月的 `refundRecord` 與佣金 ledger 彙總如果屬於早期的非 TWD 交易，不會被擋下。情境：USD 交易在 7 月付款（7 月月結被擋），8 月退款，8 月的 TWD 月結就會扣掉 USD cents。 | 退款與佣金彙總也加上 `paymentTransaction.currency = 'TWD'` 的條件，或遇到非 TWD 時同樣丟 `UnsupportedCurrencyError`。上線前 runbook 9.1 的唯讀查詢結果為空時，風險很低。 |
| A-4 | MINOR | `docs/production-database-runbook.md:118-124`；`scripts/db-migrate-guard.ts:55-67` | **Production migration 沒有可執行的正規路徑。** runbook 寫明「只在核准的 workflow 內執行」，但 repo 裡沒有 production migrate workflow：`vercel.json` 沒有 buildCommand，`staging-migrate.yml` 只處理 staging。操作者實際上只能在 shell 設定 `GITHUB_ACTIONS=true ALLOW_REMOTE_MIGRATE_DEPLOY=1`，等於教人繞過 guard。guard 本身只防誤用：設兩個環境變數就能通過，不是安全邊界。 | 新增一個受 GitHub Environment 保護、手動觸發的 production migrate workflow；或在 runbook 寫明 owner 授權的明確程序。文件也要註明 guard 只防誤用，不是權限控制。 |
| A-5 | NIT | `scripts/post-purchase-commerce-disposable-qa.mjs:63` | gate 從 177 改成 197，其中 8 個是本 PR 的 F-041 測試（product-actions 7 個、checkout route 1 個），另外 12 個是 master 原本就有、但 gate 沒有同步的案例。換句話說，這個 gate 在 master 上原本就會失敗，而且沒有在 CI 執行。數字本身正確，我實跑 14 個檔案得到 197，等於 189 加 8。 | 在 PR 描述說明 12 個差額來自 master；可考慮把這個 gate 納入 CI，避免再次失去同步。 |
| A-6 | NIT | `src/lib/payment-webhooks.ts:242-247`；`src/lib/payment-webhook-errors.ts:14` | `UnknownCheckoutTransactionError` 的訊息不在 `KNOWN_FAILURES`，會被歸類成 `processing_failed`。未知訂單會回 500，並被 retry job 重試 5 次。 | 把它對應到 `scope_missing` 或新的 `unknown_order` code，並考慮設為不重試。 |
| A-7 | NIT | `src/lib/billing-cycle-job.ts:75-81` | `unsupported_currency` 被算進一般的 `failed`，沒有獨立計數或告警。 | 新增 `unsupportedCurrency` 計數。 |
| A-8 | NIT | `scripts/db-migrate-run.ts:18` | `process.argv.slice(2)` 原樣傳給 Prisma，`--config` 或 `--schema` 可以改變實際目標，繞過已驗證的 URL。 | deploy 模式拒絕額外參數，或只允許白名單內的參數。 |
| A-9 | NIT | `src/components/product-form-client.tsx:258-288`；`src/lib/reconciliation.ts:747-770` | 舊幣別確認勾選框與 hidden `currency=TWD` 沒有元件測試。reconciliation 改成從 metadata 取 referral 後，也沒有單元測試。 | 在 `product-form.test.tsx` 與 `reconciliation.test.ts` 各補一個案例。 |
| A-10 | NIT | `src/lib/payment-webhooks.test.ts`（多處 `createCheckoutTransaction`） | 改寫後先建立 pending 交易，原本「併發建立交易」的競態不再被測到；這條路徑現在只剩 demo 會走，可以接受。commission 冪等、併發、gross/net 與退款沖銷等原有不變式仍有驗證。 | 不需處理；如果要保留 demo 建單競態的覆蓋，可另補一個 demo 專用案例。 |

各等級總結：**BLOCKER：無。** MAJOR：A-1。MINOR：A-2、A-3、A-4。NIT：A-5 到 A-10。

## 逐項確認（沒有發現問題的部分）

1. **TWD 路徑**
   - 商品 action 和 API：非 TWD 回 `unsupported_currency`，售價必須是整數元。
   - checkout：在保留庫存與呼叫 provider 之前回 422。
   - PayUni：`createCheckoutSession` 與 `refundPayment` 在 provider 層擋 `transaction.currency`，所以 post-purchase upsell（要求與來源交易同幣別）、快閃、優惠券、order bump（要求與主商品同幣別）最後都會經過這道檢查。
   - 平台方案（`platform-plan-checkout.ts`）與發票付款（`invoice-actions.ts`）固定寫 `TWD`。
   - 月結：當月交易遇到非 TWD 會停止（例外見 A-3）。
   - 舊的非 TWD 商品：只有 `mutateProduct` 會寫 `Product.currency`，且必須帶 `confirmTwdCurrency=on`。其他對 product 的寫入只改庫存或課程欄位，沒有任何不經人操作就自動改價的路徑。最後的 `updateMany` 有綁定 `vendorId` 與 `revision`。
2. **未知訂單**
   - `/api/webhooks/payments` 在 `NODE_ENV=production` 時對 demo 回 403；Vercel 的 Preview、staging 與 production 都是 production 模式。
   - retry job 只重放已儲存的事件。
   - PayUni 不再讀 `VendorId`、`VendorSlug`、`ReferralCode`。schema 拿掉 `referralCode` 與 `commissionRateBps` 後，zod 預設會去掉舊的已儲存 payload 中的這兩個欄位，不會讓舊事件失敗。
   - commission 比例只來自 affiliate 紀錄。
   - external-smoke 只在 Sandbox 執行，沒有指定訂單時會 skip。
3. **gate 數**：用 `vitest list` 靜態計數，merchant-affiliate 兩個套件合計 65 個，subscription-recovery 設定的 4 個檔案合計 85 個，都與 gate 一致；新增的測試數分別是 +4（F-048）與 +1（F-067）。
4. **migrate**
   - CI 的 `celebratedeal_ci`、`celebratedeal_wp17_ci`、`celebratedeal_wp18_ci` 都在 loopback 白名單內。
   - `staging-migrate.yml` 仍使用自己的 `scripts/staging-migrate.mjs`，沒有受到影響。
   - `${VAR:?msg}` 是 POSIX 語法，Vercel build shell 可以用；PR 上的 `Vercel – celebrate-deal-staging` check 已通過（我沒有讀 build log）。
   - `prisma.config.ts` 用的 dotenv 不會覆寫已經存在的環境變數，所以 wrapper 固定傳入的 URL 會生效。

## 驗證紀錄

- 已跑：`payuni.test.ts`、`product-actions.test.ts`、checkout `route.test.ts`、`billing.test.ts`、`billing-cycle.test.ts`、`db-migrate-guard.test.ts`，共 283 個通過。
- 已跑：post-purchase 單元切片 14 個檔案，197 個通過。
- 已跑：reconciliation、webhook route、payment-providers 與 webhook-retry 相關測試，共 239 個通過。
- `npm run typecheck` 通過；對變更檔案跑 eslint 通過。
- **未跑**：`payment-webhooks.test.ts`、`wp4-buyer-ops.db.test.ts`、`merchant-affiliate-policy.db.test.ts` 等 DB 測試。本機沒有可用的 Docker 或 PostgreSQL；這些測試由 CI `quality` 執行，審查當下 CI 仍在 pending。

需修正後再審
