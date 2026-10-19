# B-03 金流與財務審查（Critical）

審查基線：`review-baseline-2026Q4` = `78621ca3`（origin/master）。審查者：獨立 reviewer（Opus，唯讀）。日期：2026-10-19。本檔由主對話依 reviewer 回報原文存檔。

## 前言

### 方法
- 依序讀取 `docs/review-2026Q4/01-system-map.md`、`docs/domain-workflows.md`（歸因與佣金、租戶與權限）、`.claude/skills/celebratedeal-attribution-commission/SKILL.md`、`docs/launch/payuni-token-contract-20260929.md`。
- 逐行閱讀高風險檔案，從金額來源一路追到最後的 DB 寫入與 provider 呼叫。
- 用不碰資料庫的 Vitest 探針驗證 PayUni 正規化行為（探針放在 session scratchpad，沒有修改 repo）。
- 執行既有單元測試：`payuni.test.ts`、`payuni-setup.test.ts`、`payment-webhook-invariants.test.ts`、`api/webhooks/payments/route.test.ts`、`api/webhooks/payment-methods/route.test.ts`、`payment-method-setup.test.ts`、`payuni-refund-execution.test.ts`、`payuni-refund-reconciliation.test.ts`，8 個檔案、233 項全部通過。
- 沒有呼叫外部服務，沒有讀 `.env*`，沒有寫入 git。

### 覆蓋率
- 全文閱讀：`src/app/api/payments/checkout/route.ts`、`src/lib/inventory-reservations.ts`、`src/lib/payment-webhooks.ts`、`src/lib/payment-providers/payuni.ts`、`src/app/api/webhooks/payments/route.ts`、`src/app/api/webhooks/payment-methods/route.ts`、`src/lib/payment-method-setup.ts`、`src/lib/payuni-refund-execution.ts`、`src/lib/payment-refund-accounting.ts`、`src/lib/payment-webhook-invariants.ts`、`src/lib/post-purchase-credit.ts`、`src/lib/live-flash-sale.ts`、`src/lib/checkout-voucher-claim.ts`、`src/lib/wp4-runtime-boundary.ts`、`src/app/actions.ts`（L120–190、L1483–2472）。
- 部分閱讀：`billing.ts`（calculateSettlement）、`billing-cycle.ts`、`commerce-orders.ts`（付款轉移）、`platform-plan-checkout.ts`、`invoice-actions.ts`、`payuni-refund-reconciliation.ts`、`webhook-retry.ts`、`auth.ts`（財務守門）、`affiliate-remuneration-quotes.ts`、`affiliate-actions.ts`（void）、`live-interaction.ts`（優惠券折扣）、post-purchase 相關 migration、22 條 `/api/admin/ops/payuni/*` 的守門方式。

### 未覆蓋
`checkout-admission.ts`、`commerce-orders.ts` 的建單細節（L200–560）、`merchant-affiliate-policy-service.ts` 與 `affiliate-tier-policy.ts` 的分潤和退款目標演算法、課程 F/G 分潤數學、平台推薦佣金與其出款 action、課程出款 action、電子發票 adapter、PayUni live probe、ecpay-like／demo provider、support 退款移轉、funnel 結帳服務、所有 `*.db.test.ts`（需要 PostgreSQL）。

## Findings

| ID | 嚴重度 | 檔案:行號 | 問題 | 錢會怎麼錯 | 重現或測試 | 建議修法 | 估工 | 需 owner 決策 | 封測前必修 |
|---|---|---|---|---|---|---|---|---|---|
| B03-01 | BLOCKER | `src/lib/payment-providers/payuni.ts:959-1002`（L962 以 `EventType ?? Status ?? PayStatus` 判斷）；`payuni.ts:876-884`（UPP 沒帶 `Credit=1` 等付款方式限制） | 付款回呼只看 `Status`，完全沒檢查 `TradeStatus`／`PaymentType`。同一份檔案的查詢、探針與綁卡路徑都有檢查（L258-260、L691、L822）。PayUni 的 Notify／Return 通常是 `Status=SUCCESS`，實際結果放在 `TradeStatus`（0 取號、1 已付、2 失敗、3 取消、4 逾期、9 未付）。程式碼自己在 L607-612 也是這樣理解的。 | 刷卡失敗、取消、ATM／超商剛取號，都會被記為 paid：開通課程、寄送、算佣金、計入月結營收，平台就撥了根本沒收到的錢。 | scratchpad 探針：用合成金鑰簽出真實格式的回呼（沒有 EventType，有 TradeStatus）。TradeStatus 1/0/2/3/4/9 的 `eventType` 全部是 `"paid"`。既有 fixture 自帶非 PayUni 欄位（`EventType`、`NetAmount`、`ReferralCode`），所以測不到這個問題。 | 只有 `Status=SUCCESS` 且 `TradeStatus=1` 且 `PaymentType` 在允許清單內，才算 paid；2/3/4/9 算 failed；0/8 不改狀態。checkout 的 UPP 要明確限制只能刷卡。eventId 改用 `TradeNo:TradeStatus`，否則日後同一筆的「取號→付款」會被當成重複事件。補上真實欄位格式的 fixture 與回歸測試。 | 1–1.5 天 | 否（但要請 owner 確認正式商店開了哪些付款方式） | 是 |
| B03-02 | BLOCKER | `src/lib/billing.ts:203-209`、`294`、`309-311`；來源：`src/lib/platform-plan-checkout.ts:412-420`、`src/app/actions/invoice-actions.ts:165-178` | 月結把商家當月所有 paid 交易都算成營收，沒有排除 `metadata.billingPurpose` 為 `platform_subscription_checkout` 或 `invoice_payment` 的交易。這兩類交易的 vendorId 就是付款的商家本人。 | 商家付給平台的方案費或帳單款，在同月月結被算成「商家營收」，經由撥款全額退回商家。 | 程式碼證據：查詢條件只有 vendorId、status、occurredAt。DB 測試裡沒有這個情境（`payment-webhooks.test.ts:1106-1144` 只測一般訂單）。 | 月結只計 `billingPurpose=buyer_order` 或有 `primaryCommerceOrder` 的交易；最好在交易上加明確欄位（例如 `purpose` enum），並補 DB 回歸測試。已鎖定的月份要盤點。 | 0.5–1 天 | 否 | 是（如果封測會做商家撥款） |
| B03-03 | BLOCKER | `src/app/admin/billing/dashboard/page.tsx:173`（monthKey 預設為交易 occurredAt 月）、`src/app/actions.ts:2146`、`src/lib/billing-cycle.ts:116`（已鎖月份拒絕重算）、`src/lib/billing.ts:210-221`、`295`（`Math.max(0, gross - refunds)`） | 退款歸屬的月份由表單決定，預設是原始銷售月。那個月通常已經鎖定，無法重算，而下個月的月結也不會納入這筆退款。另外，退款超過當月營收的部分會被下限 0 吃掉。 | 月結後才發生的退款，平台從自己的 PayUni 帳戶退給買家，商家卻保留了全額撥款。每一筆跨月退款都是平台的淨損失。 | 程式碼路徑：dashboard 預設值 → `RefundRecord.monthKey` = 已鎖月份 → `generateSettlementForVendor` 回 `locked` → 該月營收永遠不扣。 | 退款月份一律用伺服器時間（退款完成當月），不接受表單值；月結允許負的「待扣款結轉」或追加 adjustment，不可截斷為 0；鎖定後的退款寫入下一期的 adjustment ledger。 | 1.5–2 天 | 是（負餘額要結轉，還是向商家請款） | 是（如果封測會做商家撥款） |
| B03-04 | MAJOR | `src/lib/payment-providers/payuni.ts:987-989`（`cents(undefined)` 回 0）；`src/lib/payment-webhooks.ts:991-999`（`payload.netAmountCents ?? …` 對 0 不會 fallback）；`src/lib/billing.ts:296-298`、`310` | 真實 PayUni 回呼沒有 `NetAmount`／`GatewayFee` 欄位，每次 paid 都把 `netAmountCents` 覆寫成 0，金流費永遠是 0。 | 月結不扣 PayUni 手續費，由平台全數吸收；佣金和課程撥款上顯示的 netReference 都是 0，誤導對帳。 | 探針：真實格式回呼的 `netAmountCents=0`、`gatewayFeeCents=0`。 | adapter 對缺漏欄位回 `undefined`；webhook 只在 provider 真的提供時才覆寫；金流費改由合約費率在伺服器端計算，或用 PayUni 對帳單匯入。 | 1 天 | 是（金流費由誰負擔、費率怎麼算） | 是 |
| B03-05 | MAJOR | `src/app/actions/product-actions.ts:153`、`165`（任意 3 碼幣別）、`src/components/product-form-client.tsx:309`（自由輸入）；`src/app/api/payments/checkout/route.ts:897`；`src/lib/payment-providers/payuni.ts:159-168`（不檢查幣別） | 商品可以設成 USD 等幣別，checkout 照樣把 `priceCents/100` 當成台幣送給 PayUni。 | USD 50.00 的商品只收到 NT$50。月結也把不同幣別的分直接加總（`billing.ts:294`）。 | 程式碼路徑可直接證明；不需要 DB。 | 商品幣別限定 TWD（伺服器驗證加 DB CHECK）；checkout 和 `payUniTradeAmount` 遇到非 TWD 一律拒絕；月結依幣別分開計算，或拒絕非 TWD。 | 0.5 天 | 否 | 是 |
| B03-06 | MAJOR | `vercel.json`（沒有 crons）、`vercel.staging.json`（`"crons": []`）、`.github/workflows/*`（沒有 `schedule:`）、`docs/launch/staging-cron-operations.md`；`src/app/api/jobs/webhook-retry/route.ts:38-60`；`src/app/api/webhooks/payments/route.ts:142` | `releaseExpiredInventoryReservations` 與 `processDueWebhookRetries`（含 stale `retrying` lease 回收）只能從 `/api/jobs/webhook-retry` 觸發，但任何環境都沒有排程。 | 放棄結帳時保留的庫存永遠不會釋放（限量商品或快閃名額被吃光）；pending 訂單不會過期；處理失敗的付款 webhook 不會自動重試；卡在 `retrying` 的事件對 PayUni 重送永遠回 503，已付款卻一直顯示未付。 | 程式碼加設定檔：只有兩處呼叫，都在該 route（grep 結果）。 | 正式環境設定排程（Vercel Cron 用 GET＋`CRON_SECRET`，或外部 scheduler），每 1–5 分鐘一次；加上監控告警；文件化 runbook。 | 0.5 天＋owner 選定排程方案 | 是（排程平台與頻率） | 是 |
| B03-07 | MAJOR | `src/lib/inventory-reservations.ts:9`（TTL 30 分）、`445-456`（重取庫存失敗就 throw）；`src/lib/payment-webhooks.ts:1069-1074`（整筆交易 rollback）；`payuni.ts:876-884`（checkout 沒設 `TradeLExpireSec`） | 保留過期後才收到 paid，而商品已售完時，`InventoryUnavailableError` 會讓整個付款交易 rollback，最多重試 5 次後 exhausted。 | 買家已經被扣款，系統卻停在 expired／未付，沒有自動退款或告警，只有一筆 failed WebhookEvent。 | 程式碼路徑。目前因為沒有排程（B03-06）還不易觸發，一旦補上排程就會出現。 | paid 一律先記帳（付款事實不 rollback），庫存不足時把訂單標記為「超賣待處理」並建立退款或人工工單；UPP 設定 `TradeLExpireSec` ≤ 保留 TTL。 | 1–1.5 天 | 是（超賣時自動退款還是人工處理） | 是（和 B03-06 一起修） |
| B03-08 | MAJOR | `src/lib/billing.ts:222-231`、`310`（從商家撥款扣除佣金）；`src/app/actions.ts:1614-1705`（鎖定時建立 AffiliatePayout）、`2058-2060`（註明聯盟款項歸商家自付）、`1739-1870`；全 repo 沒有任何地方設定 `AffiliatePayout.payoutItemId` | 平台月結先從商家撥款中扣除聯盟佣金，但聯盟出款被設計成商家自己付款後回報，平台沒有任何撥給聯盟的路徑。課程 F/G 分潤則沒有被扣（兩者不一致）。 | 商家被扣兩次（平台扣一次、自己付聯盟一次）；或者平台留下這筆錢，沒有出口、也沒有對帳。 | 程式碼證據：grep `payoutItemId` 只有讀取，沒有寫入。 | owner 二選一：(a) 平台代扣代付，就要補聯盟 PayoutItem、扣繳與出款流程；(b) 商家自付，就不該在月結扣除佣金。決定後補 DB 回歸測試。 | 0.5 天（b）／5 天以上（a） | 是 | 是（影響「只累計不出款」） |
| B03-09 | MAJOR | `src/lib/auth.ts:320-336`（`requireFinanceAdmin` 只檢查 platformRole）、`auth.ts:242`（只有已設定 MFA 的帳號才要求驗證）；proxy 和 admin layout 都沒有補強 | 平台管理員沒設定 MFA 也能執行退款（真的呼叫 PayUni）、月結調整與鎖定、建立出款批次、作廢佣金、重送 webhook。這違反 `domain-workflows.md` 中「Platform admin：MFA、audit」的規定。 | 只要平台管理員的密碼外洩，攻擊者就能發起退款、竄改撥款金額。 | 程式碼路徑。與 B-02（auth 軸線）可能重複，請以 B-02 為主。 | `requireFinanceAdmin` 強制要求「已設定並已驗證 MFA」，沒設定就導去設定頁；敏感 mutation 再做一次 step-up 驗證。 | 0.5–1 天 | 否 | 是 |
| B03-10 | MINOR | `src/lib/payuni-refund-execution.ts:138-205` 對照 `src/lib/payment-webhooks.ts:1069-1074`、`1255-1266` | 後台 PayUni 退款路徑不會釋放庫存，也不會排入電子發票作廢／折讓；webhook 退款路徑兩者都會做。 | 全額退款後實體庫存不會回補；發票未折讓（目前正式環境沒有發票 adapter，風險延後出現）。 | 程式碼比對。 | 兩條退款路徑共用同一個 post-refund hook（庫存、發票、post-purchase）。 | 0.5 天 | 否 | 否 |
| B03-11 | MINOR | `src/lib/payuni-refund-reconciliation.ts:160-165`；`payuni-refund-execution.ts:124-135` | 結果不明的退款保留，如果 PayUni 查詢確認「沒有退款」，對帳只會丟 `local_state_ambiguous`，沒有任何路徑把它標成 failed。 | 該交易從此不能再退款（pending 會擋住）；客服只能在系統外退款，ledger 就分歧了。系統會 fail-closed，不會多退。 | 程式碼路徑。 | 在 provider 查詢連續確認「沒有退款」且超過時間窗後，允許有權限的人工釋放保留，並寫入 audit。 | 0.5 天 | 否 | 否 |
| B03-12 | MINOR | `payuni.ts:63-77`；`src/app/api/webhooks/payments/route.ts:208-220` | 外層 Status 不是 SUCCESS 的回呼會被當成 invalid_payload（400），只寫一筆 audit，不會建立 WebhookEvent，也不會把交易標成 failed，更不保留 provider 錯誤碼（綁卡路徑在 #444 已補上這部分）。 | 拒付率無法分析；庫存被保留到過期（再加上 B03-06 就是永久保留）。 | 程式碼路徑。 | 已簽章的非 SUCCESS 回呼視為 failed 事件處理，並保存有界錯誤碼（比照 `payUniSetupProviderResult`）。 | 0.5 天 | 否 | 否 |
| B03-13 | MINOR（需驗證） | `src/lib/payment-webhooks.ts:981-983`、`1044-1060`、`1170`、`304-306` | 未知訂單的 paid 回呼只要帶 vendorId 或 slug，就會建立權威付款，並用 payload 裡的 referralCode／commissionRateBps 產生佣金。PayUni 的 normalize 只讀 `VendorId`／`VendorSlug`／`ReferralCode`，真實 UPP 應該不會回傳這些欄位，但沒有官方證據。 | 違反「未知訂單不可產生權威付款與佣金」的規則；換 provider 或 PayUni 回傳自訂欄位時就可能被利用。 | 程式碼路徑；`payment-webhooks.test.ts:1113-1122` 就是用這條路徑建單。 | 正式 provider 只接受既有 checkout 交易；移除 payload 的 commissionRateBps／referralCode 覆寫；adapter 不再讀 VendorId／ReferralCode。 | 0.5 天 | 否 | 否 |
| B03-14 | MINOR | `src/app/actions.ts:2178-2359` | L2156 的 PayUni 區塊一定會 redirect，所以後面這段舊版 PayUni 退款實作永遠不會執行。它缺少 subscription projection，和現行實作已經分歧。 | 日後若有人調整條件就會被意外啟用，用錯版本的帳務邏輯。 | 閱讀程式碼即可確認。 | 刪除死碼。 | 0.5 小時 | 否 | 否 |
| B03-15 | MINOR | `src/app/actions.ts:144-149`（`parseFloat`）、`1530-1552` | 退款金額與月結 adjustment 的解析很寬鬆（`"1e3"`、`"12abc"` 都會被接受）；adjustment 理由可以不填，正向調整也沒有上限，而且是單人操作。 | 輸入錯誤直接變成撥款金額。 | 程式碼路徑。 | 嚴格的整數元 regex；adjustment 必填理由並設上限，大額調整需要第二人覆核。 | 0.5 天 | 是（覆核門檻） | 否 |
| B03-16 | MINOR | `prisma/schema.prisma` 的 `PaymentTransaction`（只有 `@@index([vendorId, orderNumber])`）；`payment-webhooks.ts:237-251` | PayUni 的 MerTradeNo 在整個平台商店是唯一的，但 DB 沒有 `(providerName, orderNumber)` 唯一鍵；也沒有 `grossAmountCents > 0`、`refundedAmountCents <= grossAmountCents` 等 CHECK；`RefundRecord.providerEventId` 不唯一。 | 一旦撞號，webhook 會丟「訂單識別不唯一」，付款入不了帳；不變式只靠應用層守住。 | schema 與 migration grep。 | 前向 migration：部分唯一索引（provider, orderNumber）加上金額 CHECK；先盤點既有資料。 | 1 天 | 否 | 否 |
| B03-17 | MINOR | `payuni.ts:910-923` | 綁卡時的 NT$1 授權（商店設定為自動請款）不會退回，也不會記成 PaymentTransaction。 | PayUni 對帳單與系統 ledger 不一致；商家被扣 NT$1 卻沒有任何紀錄。 | 程式碼路徑。 | 記帳成 setup 交易並自動退款，或改用 PayUni 的授權取消；在對帳時列為已知項目。 | 0.5–1 天 | 是 | 否 |
| B03-18 | MINOR | `src/lib/affiliate-remuneration-quotes.ts:119`；`src/app/actions.ts:1802` | 商家出款政策停用時（預設值），商家仍可以把聯盟出款標為 paid，不需要扣繳快照（`withholdingTaxCents`、`nhiSupplementaryTaxCents` 等欄位都存在但被略過）。 | 扣繳申報有缺口；也沒有辦法落實「封測不出款」。 | 程式碼路徑。 | 加一個平台層開關（見下節）；政策停用時禁止標記 paid。 | 0.5 天 | 是 | 是（如果要落實「不出款」） |
| B03-19 | MINOR | `src/app/api/webhooks/payments/route.ts:198-205`；`payment-methods/route.ts:230-237` | 付款 webhook 沒有 rate limit；每次簽章失敗都會寫一筆 AuditLog。 | 不需驗證就能放大 DB 寫入，壓垮 audit 表。 | 程式碼路徑。 | 用 IP 加上簽章失敗次數做限流，失敗 audit 合併記錄。 | 0.5 天 | 否 | 否 |
| B03-20 | MINOR | `src/app/actions/affiliate-actions.ts:31-56`；`src/lib/payment-refund-accounting.ts:120-123` | 作廢已鎖定的佣金時，沒有同步重算 pending AffiliatePayout，導致出款卡在 conflict。已標為 paid 的佣金之後若退款，餘額會變成負數，但沒有追回或下期扣抵。 | 聯盟出款卡住，或聯盟被多付。 | 程式碼路徑。 | void 時呼叫 `reconcileAffiliatePendingPayout`；負餘額結轉到下期。 | 0.5 天 | 是（追回政策） | 否 |
| B03-21 | MINOR | `src/lib/wp4-runtime-boundary.ts:20-24`、`44-53`；`src/app/api/admin/ops/payuni/pending-refund-proof/route.ts:15-19` | 22 條 ops 端點在正式環境由 `VERCEL_ENV=preview`、`PAYUNI_ENV=sandbox`、旗標與 staging 身分共同封住，守門正確；有寫入的路徑都經過 `executePayUniRefund`，有 audit。但它們仍在正式 bundle 裡，和 webhook-retry 共用 `JOB_SECRET`，而且先回 401 才判斷環境，會透露端點存在。 | 單一 secret 外洩時影響面較大；也增加維護負擔。 | 程式碼路徑。 | 用建置期旗標把這些端點排除在正式 bundle 外，或至少先判斷環境再驗 secret，並使用獨立 secret。 | 0.5–1 天 | 否 | 否 |
| B03-22 | MINOR（需驗證） | `src/lib/inventory-reservations.ts:159-177` | 結帳用 Serializable 交易，同一個商品列熱點只重試 3 次就回 502。 | 快閃特賣時大量 502，造成營收流失（不會算錯錢）。 | 需要壓力測試。 | 對熱點商品改用 `SELECT … FOR UPDATE`，或加大退避與重試次數，並做壓測。 | 1 天 | 否 | 否 |
| B03-23 | NIT | `src/app/api/payments/checkout/route.ts:860-862` | route 沒有明確檢查 `checkoutAmountCents > 0`，也沒檢查它等於 `postPurchaseQuote.checkoutAmountCents`，而是靠下游的 `commerce-orders.ts:296`、`336` 和 `payuni.ts:159-168` 擋住。 | 目前不會出錯；只是防線太深。 | — | route 內補上斷言。 | 0.5 小時 | 否 | 否 |
| B03-24 | NIT | `docs/launch/payuni-token-contract-20260929.md:20` 對照 `src/lib/payment-method-setup.ts:90-95` | 文件說 disposition 會拒絕 form_post；現行程式已允許核准過的 PayUni UPP form_post，綁卡 adapter 的三個方法也都存在。 | 文件誤導。 | — | 更新文件。 | 0.5 小時 | 否 | 否 |

### 已確認良好（沒有 finding）
- 結帳金額只來自伺服器：商品、加購、快閃價、優惠券、post-purchase credit 全部從 DB 重新解析；`referralCode` 欄位不被信任；優惠券上限為 price−1，TWD 取整到元；快閃價必須 > 0 且 ≤ 原價；post-purchase 不能和加購、funnel、優惠券、快閃疊加（`route.ts:754`、`835`、`849`），且金額 > 0 並符合 PayUni 範圍（`post-purchase-upsell.ts:65-70`）。
- 庫存保留、付款交易、訂單、優惠券核銷都在同一個 Serializable 交易內，商品列依固定順序加鎖；冪等鍵有唯一索引，競態時回傳勝出的那筆。
- 簽章驗證：AES-GCM 加上 `timingSafeEqual`，內外層 MerID 都核對（`payuni.ts:105-109`、`769-799`）；同一事件以 `(provider, eventId)` 唯一並用 claim 機制去重；Return 和 Notify 收斂到同一事件；paid 金額與既存交易比對（`payment-webhook-invariants.ts:61-66`）。
- 退款：PayUni 先建立 pending 保留，只有一個 provider 寫入點，結果不明時保留 pending、不重送；部分或重複退款都有上限檢查；佣金與課程分潤以 append-only 負向 ledger 處理。
- Log 與快照：webhook raw 只保留允許清單欄位，不含卡號；綁卡錯誤碼會過濾 12–19 位數字；退款失敗 log 只記分類。

## 封測時「聯盟只累計不出款」的可行設定

現況：
1. **累計**：paid webhook 在 Serializable 交易內自動產生 AffiliateCommission 與 accrual ledger（`payment-webhooks.ts:1157-1171`）。不需要任何設定就會累計。
2. **平台本身不撥款給聯盟**：AffiliatePayout 不會進平台 PayoutBatch（沒有任何程式寫入 `payoutItemId`），平台的「出款」只對商家。
3. **擋不住的地方**：
   - 平台管理員一鎖定商家月結（`lockSettlementAction`），就會建立 pending 的 AffiliatePayout；商家財務人員可以在 `/affiliates/commissions` 把它標成 paid。
   - `MerchantAffiliatePayoutPolicy.enabled=false`（預設值）時，標記 paid 不需要扣繳快照（B03-18）。
   - 月結仍然會從商家撥款扣除佣金（B03-08）。

只用現有設定的做法（不改程式）：
- 封測期間平台不鎖定、不撥款任何「有聯盟佣金的商家」的月結。這樣不會產生 AffiliatePayout，商家也就無從標記 paid。代價是這些商家的撥款也一併暫停。
- 對外條款寫明：佣金只累計、封測期間不出款。

建議的最小程式變更（約 0.5 天，需 owner 確認）：
- 新增平台層開關（例如環境變數 `AFFILIATE_PAYOUT_OUTCOMES_ENABLED=false`），讓 `recordAffiliatePayoutOutcomeAction` 拒絕 `status=paid`，`lockSettlementAction` 只建立快照而不開放出款。
- 同時決定 B03-08：封測期間月結不要扣佣金（佣金只是累計負債），或者平台代扣並在帳上列為「代收待付」。

## 給 ROADMAP 的三句結論

1. PayUni 付款回呼不檢查 TradeStatus，刷卡失敗也會被當成已付款並開通課程；這和月結把平台方案費、帳單付款算成商家營收、跨月退款永遠扣不到，三件都是開放真實付款前必須先修的錢路缺陷。
2. 金流費與淨額被寫成 0、非 TWD 幣別照台幣面額扣款、沒有任何排程（庫存保留和 webhook 重試永遠不跑）、聯盟佣金被平台扣下卻沒有出款路徑，這些都要 owner 決定費用模型與排程方案後一併處理。
3. 結帳金額來源、冪等、簽章、退款保留與佣金 ledger 的基本設計扎實；修完上述問題，再補上「真實 PayUni 欄位」的 fixture 與 DB 回歸測試後，才能進行 Sandbox 實付驗證。
