# PayUni 狀態代碼對照：官方文件 vs. 目前程式判斷

- 日期：2026-11-03
- 依據來源：
  - **官方文件**（2026-11-03 讀取）：PAYUNi 開發專區 `https://docs.payuni.com.tw/web/`，頁面 `#/7/34`（整合式支付頁 UNiPaypage UPP，Ver 2.0，〈返回參數〉）、`#/7/164`（交易查詢 Ver 2.0）、`#/7/80`（整合式支付 Notify）、`#/7/75`（訂單失效通知 Notify，Ver 1.0）。
  - **程式**：`src/lib/payment-providers/payuni.ts`（`payUniUppEventType`、`classifyPayUniCallback`、`payUniSignedPaymentRejection`、`payUniQueryRow`、`verifyPayUniSignature`）；`src/app/api/webhooks/payments/route.ts`（`notActionableResponse`）。
  - **既有文件**：`docs/launch/payuni-payment-callback-runbook.md`（§1 判斷規則、§5 待 Sandbox 樣本驗證）；`docs/goal-beta-prep-2026Q4/OWNER-ACTIONS.md` O-2；`GO-NO-GO.md` F-037。
- 狀態：官方代碼表已對照（見 §1）；**Sandbox 去識別化樣本尚未入庫**，所以「實際回呼長什麼樣」仍以官方文件為準，未做實測對照（§5）。
- 2026-11-03 更新（分支 `ai/payuni-tradestatus-semantics`）：依本文件 §3.2 的結論修正程式判斷：UPP 回呼的 `TradeStatus=9` 改為待付款（不改狀態），`4` 與其他格式正確但官方 UPP 表沒有的代碼改走人工對帳（reason `trade_status_unknown`）。§2、§3、§4 已改為修正後的行為；修正前的判斷保留在各列的「修正前」說明。

## 0. 取得官方文件的過程

官方開發專區是以 JavaScript 渲染的單頁應用，文字抓取工具只能拿到外殼。試過的網址與結果：

| 嘗試 | 結果 |
|---|---|
| WebFetch `https://docs.payuni.com.tw/web/#/7/34` | 只回傳標題「PAYUNi API Docs」，沒有內容 |
| WebFetch `https://www.payuni.com.tw/docs/web/#/7/34` | 302 轉到 `https://docs.payuni.com.tw/`（無內容） |
| WebFetch `https://docs.payuni.com.tw/`、`/web/_sidebar.md`、`/web/README.md`、`/web/7/34.md` | 皆只有標題，沒有文件正文 |
| WebFetch `https://github.com/payuni/PHP_SDK`、`…/src`、`raw.githubusercontent.com/payuni/PHP_SDK/main/README.md` 與 `src/PayuniApi.php` | 官方 PHP SDK 只處理 `Status`（`ResultProcess`），**沒有 `TradeStatus`、`PaymentType` 常數**；README 指回上述官方文件頁 |
| WebSearch「PAYUNi UPP 統一金流 API 文件 TradeStatus … PaymentType」 | 只有第三方整理，**沒有官方代碼表**（第三方的「6＝已退款」等不在官方表中，本文件不採用） |
| 以 Claude 內建瀏覽器（會執行 JavaScript）開啟 `https://docs.payuni.com.tw/web/#/7/34`、`#/7/164`、`#/7/80`、`#/7/75` | **成功**，取得正文；以下 §1～§3 的「官方」欄都來自這四頁 |

未能取得：`#/7/153`〈信用卡交易狀態說明〉（頁面只有圖片，文字抓不到）、錯誤代碼頁的完整清單（UPP 的 `Status` 失敗代碼只確認到「失敗請參考錯誤代碼」）。

## 1. 官方代碼表

### 1.1 外層 `Status` 與 EncryptInfo 內 `Status`（UPP 返回參數）

| 值 | 官方說明 |
|---|---|
| `SUCCESS` | 成功 |
| `UNKNOWN` | 等待授權結果逾期。當 60 秒內沒有收到銀行回應會先回 `UNKNOWN`；後續若取得交易結果會 Notify 到 `NotifyURL`，或建議 15 分鐘後發動交易查詢確認 |
| `Unapproved`（外層寫法）／`UNAPPROVED`（EncryptInfo 內寫法） | 訂單待確認，買家會員資格審查中（AFTEE 類） |
| 其他 | 失敗，請參考錯誤代碼（例如查詢 API 的 `QUERY03001` 查無符合訂單資料） |

另：官方註明 `ReturnURL` 的結果僅作前景顯示，「**交易結果請以 NotifyURL 為主**」。外層 `Status` 與 `MerID`、`Version`、`EncryptInfo`、`HashInfo` 同層，只有 `EncryptInfo` 受 `HashInfo` 保護。

### 1.2 `TradeStatus`

| 代碼 | UPP 返回／Notify（#/7/34） | 交易查詢 Ver 2.0（#/7/164） | 訂單失效通知 Notify Ver 1.0（#/7/75） |
|---|---|---|---|
| 0 | 取號成功 | 取號成功 | — |
| 1 | 已付款 | 已付款 | — |
| 2 | 付款失敗 | 付款失敗 | — |
| 3 | 付款取消 | 付款取消 | — |
| 4 | **不在表中** | 交易逾期 | 固定值，訂單失效（適用 ATM、超商代碼、愛金卡、後支付、街口） |
| 8 | 訂單待確認 | 訂單待確認 | — |
| 9 | **不在表中** | 未付款 | — |

### 1.3 `PaymentType`

| 代碼 | UPP 返回／Notify | 交易查詢 | 備註 |
|---|---|---|---|
| 1 | 信用卡 | 信用卡 | 信用卡區塊另有 `AuthType`：1 一次、2 分期、（3 紅利，僅查詢，2025/09/01 起不支援）、4 Apple Pay、5 Google Pay、6 Samsung Pay、7 銀聯 |
| 2 | ATM 轉帳 | ATM 轉帳 | |
| 3 | 代碼（超商） | 條碼／代碼 | |
| 5 | 貨到付款（超商取貨付款） | 取貨付款 | |
| 6 | 愛金卡（ICash） | 愛金卡（ICash） | |
| 7 | 後支付（Aftee） | 後支付（Aftee） | |
| 8 | **不在表中** | 退貨代收（C2B 退貨便） | |
| 9 | LINE Pay | LINEPay | |
| 10 | 宅配到付 | 宅配到付 | |
| 11 | 街口支付（JKoPay） | 街口支付 | |

### 1.4 其他官方規格（與判斷邏輯相關）

- `Gateway`：UPP 返回固定 `2`。
- UPP 請求：`MerTradeNo` 長度 ≤ 25、格式 `[A-Za-z0-9_-]`、10 分鐘內不可重複；`TradeLExpireSec` 60～600（預設 600）；`NotifyURL` 僅限 80、443 埠；`Credit=1` 只啟用信用卡一次付清；未帶任何指定支付工具則依商店後台預設。
- 回呼 `Version` 固定 `2.0`；訂單失效通知是 `1.0`。
- 查詢 `DataSource`：`A`＝完整資料，`B`＝處理中未完整（建議 10 分鐘後再查）；`TradeFee` 只在 `DataSource=A` 且 `TradeStatus=1` 時才有正確值。
- 信用卡退款查詢 `RefundStatus`：1 申請中、2 成功、3 取消、8 處理中（只提供最後一筆退款紀錄，需用 `RemainAmt` 還原累計）。
- UPP 返回參數表**沒有** `NetAmount`、`GatewayFee`、`VendorId`、`ReferralCode`。

## 2. 目前程式的判斷（`payUniUppEventType`）

簽章先通過（`MerID` 一致、`Version=2.0`、`HashInfo` 常數時間比對、解密後 `MerID` 再比對）才會進入判斷；失敗回 401。

1. 帶有 `EventType` 欄位 → 丟錯（真實 UPP 回呼不會有）→ 400 `invalid_payload`。
2. `TradeStatus` ∈ {0, 8, 9} → **不改任何狀態**（`trade_pending`），audit `payment_webhook_not_actionable`；Notify 回 200、Return 導向 `payment=pending`。不建立 WebhookEvent、不標 failed、不開通、不算佣金、不寄失敗信；之後的 paid Notify（eventId `TradeNo:1`）照常結案。（修正前：9 歸在 failed。）
3. `TradeStatus` ∈ {2, 3} → `failed`，eventId `TradeNo:<狀態>`。（修正前：還包含 4、9。）
4. `TradeStatus` 是 1～2 位數字但不在上述代碼與 1（例如 4、5、6、7、10、99）→ `trade_status_unknown`：不當成功也不當失敗，走與第 6 點相同的人工對帳路徑（`manual:<TradeNo>:<TradeStatus>:<PaymentType>` 事件、保留 pending 交易不被逾期釋放、Sentry error 告警、audit 與有界的已簽章 snapshot，含外層 `Status`）；Notify 與 Return 都會記錄（`TradeStatus` 在已簽章的 EncryptInfo 內），重送收斂到同一筆事件。之後的 paid Notify 仍會入帳並解除保留，但這筆對帳事件只有 `TradeStatus=1` 的對帳事件會被自動結案，所以要由財務人工關閉。格式錯誤（空白、非數字、3 位數以上）仍丟錯 → 400 `invalid_payload`（fail closed）。（修正前：4 為 failed，其他代碼一律 400。）
5. `TradeStatus = 1` 時，依序：EncryptInfo 內 `Status` 必須 `SUCCESS`（否則 `provider_status_not_success`）；`PaymentType` 必須在允許清單 {1}（否則 `payment_type_not_allowed`）；外層 `Status` 必須 `SUCCESS`（否則 `outer_status_mismatch`）；全過才是 `paid`，eventId `TradeNo:1`，且金額 `TradeAmt` 必須存在且大於 0。
6. 上述 5 的三種否決：Notify 一律建立 `needs_manual_reconciliation` 事件、保留庫存、Sentry error 告警；唯一例外是**來源為 Return 且只有外層 `Status` 不符**，不記錄、導向 pending，交給 Notify 決定（RR-01）。
7. 沒有 `TradeStatus` 的簽章結果（`payUniSignedPaymentRejection`）：EncryptInfo 內 `Status` 是 `UNKNOWN` 或 `UNAPPROVED`（不分大小寫）→ `trade_pending`；是舊式文字（paid、success、failed…）→ 走舊通知路徑，**永遠不會變成 paid**；其他 PayUni 錯誤代碼 → `failed`，並保留有界的 `Status`／`Message`／`TradeStatus`／`ResCode` 診斷碼（`Message` 只在符合代碼格式、不含 12～19 位連續數字時保留）。
8. 允許付款的 `PaymentType` 只有 `1`（封測只收信用卡；checkout 送 `Credit: 1`、`TradeLExpireSec: 600`）。

其他路徑：
- **查詢**（`payUniQueryRow`，對帳／補查用）：只接受 `DataSource=A`、`TradeStatus=1`、`PaymentType=1`、有 `TradeNo` 與金額；`TradeStatus=1` 但 `PaymentType≠1` → `manual_reconciliation`；其他一律 `provider_response` 錯誤（不推論為失敗或未付款）。查詢的呼叫端（退款對帳頁、WP4 檢查）都是唯讀，所以查詢回 0、2、3、4、8、9 時訂單維持原狀，與回呼路徑一致：9 的訂單維持待付款，可由後續 Notify 結案（本分支補了 0、3、9 的查詢測試）。退款只認 `RefundStatus=2`（用 `RemainAmt` 還原累計）；1／3／8／未知都不當成退款成功。`QUERY03001` 才代表「查無」。
- **綁卡／setup 路徑**（`payUniSetupProviderResult`）：簽章 `Status=SUCCESS` 且 `TradeStatus` 為 2、3 → declined；8 → pending；0 或其他 SUCCESS 組合 → 無效；非 SUCCESS 的 `Status` 以 `UNKNOWN`／`UNAPPROVED` 判 pending，其餘 declined。
- **Credit API 通知**（live probe）：`Version` 1.2／1.3，另一條路徑。

## 3. 逐項對照

圖例：**一致**＝程式與官方表相符；**不一致**＝官方與程式的假設有落差；**程式沒處理**＝官方有此代碼，程式沒有對應行為；**官方沒列**＝程式有處理但官方表沒有。

### 3.1 外層／內層 `Status`

| 官方 | 程式 | 結論 |
|---|---|---|
| `SUCCESS` | paid 判斷同時要求外層與內層都是 `SUCCESS`；外層不受 `HashInfo` 保護，只能否決、不能促成 paid | **一致**（比官方更保守，且理由正確） |
| `UNKNOWN` | 無 `TradeStatus` 時判 `trade_pending`（不改狀態）；Notify 回 200 | **一致**。官方建議「15 分鐘後發動交易查詢」：程式有查詢函式，但**是否有自動在 15 分鐘後對 UNKNOWN 訂單發動查詢，本次未查證** |
| `Unapproved`／`UNAPPROVED` | 內層以 `toUpperCase()` 比對，判 pending | **一致**；外層（官方寫成 `Unapproved`）只做 `=== "SUCCESS"` 比較，所以大小寫不影響結果。AFTEE 不在封測範圍 |
| 失敗代碼（非 SUCCESS） | 無 `TradeStatus` 時判 `failed` 並保留診斷碼 | **一致** |
| 外層 `Status` 為官方表以外或程式沒對應的值（例如 `Unapproved`、小寫 `success`、錯誤代碼、空字串、缺漏），搭配已簽章的信用卡 paid | `outer_status_mismatch`：Notify 走人工對帳並記 audit；Return 讓位給 Notify | **一致**（本分支補了這些值的測試；外層不受簽章保護，只能否決 paid） |
| `SUCCESS` 搭配非 1 的 `TradeStatus`（例如 2、3） | 依 `TradeStatus` 判 failed；不檢查 `Status` | **一致**（失敗不需要外層佐證） |

### 3.2 `TradeStatus`

| 代碼 | 官方（UPP） | 程式 | 結論 |
|---|---|---|---|
| 0 取號成功 | ATM／超商取號，尚未付款 | pending，不改狀態 | **一致** |
| 1 已付款 | 已付款 | 條件齊全才 `paid`（內層 `Status`、`PaymentType=1`、外層 `Status`、金額） | **一致**（封測限信用卡，非信用卡改走人工對帳） |
| 2 付款失敗 | 付款失敗 | `failed` | **一致**。runbook §5 第 2 點的疑問（失敗後能否用同一 `MerTradeNo` 在 UPP 頁重試成 1）官方文件沒有說明，仍待 Sandbox 驗證；程式的 eventId 帶狀態（`TradeNo:2`、`TradeNo:1`），後到的 paid 不會被去重吞掉 |
| 3 付款取消 | 付款取消 | `failed` | **一致** |
| 8 訂單待確認 | 待確認 | pending，不改狀態 | **一致**。8 之後是否會再送最終 Notify，官方 UPP 頁沒有寫（runbook §5 第 3 點仍待實測） |
| 4 交易逾期 | **UPP 返回表沒有**；出現在查詢表與「訂單失效通知 Notify」（Version 1.0，僅 ATM／超商／愛金卡／後支付／街口） | UPP 回呼收到 4 → `trade_status_unknown`，人工對帳（不標 failed、不入帳）；失效通知因 `Version` 是 1.0，**簽章驗證即失敗（401）**（修正前：UPP 回呼的 4 → `failed`） | **已修正（本分支）**：UPP 表沒有的代碼不再推論為失敗。**日後開 ATM／超商時，Version 1.0 失效通知仍會被拒收**，屬「程式沒處理」，需要另做 |
| 9 未付款 | **UPP 返回表沒有**；只在查詢表（尚未付款） | UPP 回呼收到 9 → `trade_pending`，不改任何狀態；之後的 paid Notify 照常結案（修正前：`failed`） | **已修正（本分支）**：與官方「未付款」語意一致。UPP 回呼是否真的會送 9 仍待 Sandbox 樣本 |
| 5、6、7、10～99 | 官方三份表都沒有 | `trade_status_unknown`，人工對帳（修正前：400 `invalid_payload`） | **已修正（本分支）**：保留已簽章的 snapshot、audit 與告警，不當成功或失敗；格式錯誤（空白、非數字、3 位數以上）仍 400 |

### 3.3 `PaymentType`

| 代碼 | 官方 | 程式 | 結論 |
|---|---|---|---|
| 1 信用卡 | UPP／查詢皆有 | 唯一允許入帳的類型；checkout 只送 `Credit=1` | **一致** |
| 1（Apple Pay／Google Pay／Samsung Pay／銀聯） | 官方信用卡區塊的 `AuthType` 為 4／5／6／7，`PaymentType` 仍屬 1（信用卡）；由官方表推得，非明文保證 | 只看 `PaymentType=1`，不讀 `AuthType`（本分支只在 `payuni.ts` 註解註記此推論，未改程式） | **一致（推論）**。runbook §5 第 4 點「Apple／Google／Samsung Pay 回報什麼 PaymentType」可由官方表初步回答為 1，仍建議 Sandbox 實測（官方測試區 Apple／Google／Samsung Pay 不限卡號皆模擬成功） |
| 2、3、5、6、7、9、10、11 | 官方有 | `TradeStatus=1` 時 → `payment_type_not_allowed` → 人工對帳；其他狀態依 `TradeStatus` | **一致**（刻意不自動處理非信用卡）。程式內註解的代碼表與官方 UPP 表完全相同 |
| 8 退貨代收 | 只在查詢表 | 查詢路徑：`TradeStatus=1` 且 `PaymentType≠1` → `manual_reconciliation`；UPP 回呼 `TradeStatus=1` 且 `PaymentType=8` → `payment_type_not_allowed` 人工對帳 | **一致**（走同一個保守出口）；本分支已把 8 補進程式註解 |
| 官方表以外的代碼（例如 4、12、99）或缺漏 | 官方沒有 | `TradeStatus=1` 時 → `payment_type_not_allowed` 人工對帳；其他狀態依 `TradeStatus` | **一致**（本分支補了 4、8、12、99 的測試） |

### 3.4 其他欄位

| 項目 | 官方 | 程式 | 結論 |
|---|---|---|---|
| `NetAmount`／`GatewayFee` | UPP 返回沒有 | 回呼沒帶時以合約費率計算（F-040，`PAYUNI_CREDIT_FEE_BPS`） | **一致** |
| `TradeFee`（查詢） | `DataSource=A` 且 `TradeStatus=1` 時有正確手續費 | 程式沒讀 | **程式沒處理**：可用查詢結果校正實際手續費，待會計師 D-30 決定費率來源後再評估 |
| `VendorId`／`VendorSlug`／`ReferralCode` | UPP 返回沒有這些欄位 | 程式註解說明租戶與推薦碼不再從回呼讀取，訂單號必須對得上伺服器建立的 checkout 交易（F-048）；但 `payuni-payment-callback-runbook.md` §4 的 R448-03 仍標「正式收款前必修」 | 官方沒有這些欄位，與 R448-03 的方向一致；**R448-03 是否已完成未在本次查證** |
| `ResCode`、`Message` | 信用卡區塊有 `ResCode`、`ResCodeMsg` | 只保留有界診斷碼，不存自由文字 | **一致** |
| `CardInst`／`FirstAmt`／`EachAmt`（分期） | 有 | 程式沒讀；checkout 只啟用一次付清，分期不會出現 | **程式沒處理**（目前不需要） |
| `TradeLExpireSec` | 60～600 | 送 600 | **一致**（≤ 庫存保留 TTL，B03-07 gate 的一部分） |
| `Version` | 回呼 2.0 | 驗簽要求 `2.0` | **一致**；失效通知 1.0 會被拒（見 §3.2 的 4） |
| 回呼來源 | 以 NotifyURL 為主，ReturnURL 為前景 | Return 與 Notify 對同一狀態收斂到同一個 eventId；外層 `Status` 不符時 Return 讓位給 Notify | **一致** |
| 查詢 `RefundStatus` | 1、2、3、8 | 只認 2；其他當作「不能證明已退款」 | **一致**（保守） |

## 4. 目前沒有對應處理的官方代碼彙整

1. **`TradeStatus=4` 的「訂單失效通知 Notify」（Version 1.0）**：簽章驗證要求 `Version=2.0`，會回 401。信用卡封測沒影響；開放 ATM／超商前要處理。（UPP 2.0 回呼帶 4 的情況已由本分支改走人工對帳。）
2. ~~**`TradeStatus=9`（查詢表的「未付款」）**：程式把 UPP 回呼的 9 當 `failed`~~ → 本分支已改為待付款（§3.2）。
3. **查詢路徑對 `TradeStatus` 0、2、3、4、8、9 與 `DataSource=B`**：一律回 `provider_response` 錯誤，不會推論為失敗或逾期；與回呼路徑的新判斷一致（不會把 9 或未知代碼當失敗）。含意：卡片失敗或逾期的訂單，**不能靠查詢自動結案**，只能等回呼。是否需要補強由 owner 與 reviewer 決定。
4. **`UNKNOWN` 後 15 分鐘主動查詢**：官方建議；程式是否已排程，本次未查證。
5. **`TradeFee`、`AuthType`、`CardInst`**：程式不讀（目前不需要）。
6. **未知代碼的人工對帳事件不會被後續 paid 自動結案**：`resolveManualReconciliationForPaidTrade` 只關閉 `manual:<ref>:1:*`，本分支沒有改這個範圍。

## 5. 仍需 Sandbox 實測的項目

官方文件解決了代碼表，但下列行為官方沒寫，仍以 `payuni-payment-callback-runbook.md` §5 為準，且**Sandbox 去識別化樣本尚未入庫**（STATE A3 與 GO-NO-GO F-037 仍標「待 O-2 樣本」）。2026-10-25 的兩筆 Sandbox 付款（O-2）都已付款且佣金正確入帳，間接顯示 paid 路徑（外層與內層 `Status=SUCCESS`、`PaymentType=1`、`TradeStatus=1`）在 Sandbox 成立；但沒有取到失敗卡、取消、逾期、`UNKNOWN` 的樣本。

| runbook §5 項目 | 官方文件能回答嗎 |
|---|---|
| 1. Notify 與 Return 是否都帶外層 `Status` | 官方 Notify 頁寫「返回參數請參考 UPP」，表示結構相同；**仍須實測**（若 Notify 沒帶，所有付款都會進人工對帳） |
| 2. `TradeStatus` 4／9 是否出現在 UPP 回呼 | **官方 UPP 表沒有 4、9**；4 只出現在 Version 1.0 失效通知，9 只在查詢。預期不會出現，需實測確認 |
| 3. 8 之後是否再送最終 Notify | UPP 頁沒寫；`UNKNOWN` 的說明則明文「後續若取得交易結果會 Notify」。需實測 |
| 4. Apple／Google／Samsung Pay 的 `PaymentType` | 可由官方表推得為 1（`AuthType` 4／5／6），需實測 |
| 5. NotifyURL 回非 2xx 時的重送次數與間隔 | 本次讀到的頁面沒有寫；請向 PayUni 客服確認（客服：02-6605-0810、service@payuni.com.tw，取自官方說明頁） |
| 6. 真實回呼有無 `NetAmount`／`GatewayFee`／`VendorId`／`ReferralCode` | 官方 UPP 表沒有 |
| 8. `TradeNo` 格式 | 官方只寫「UNi序號」，未寫格式；需實測 |
| 9. 手續費是否有小數 | 回呼本身無手續費欄位；查詢的 `TradeFee` 格式未寫 |

## 6. 建議的後續工作（皆非本文件範圍，需 owner 與 reviewer 決定）

1. 在 Sandbox 取樣：失敗卡（官方測試區有「模擬 3D 交易 ECI 值不符主動取消授權」的卡號 `4147631000000002`、`3560511000000002`，可產生失敗案例）、取消付款、等待逾時（`UNKNOWN`），把去識別化的欄位名稱與值寫進 `docs/launch/`（不含卡號與簽章 body）。
2. ~~決定 UPP 回呼的 `TradeStatus=9` 要維持 `failed` 還是改 pending~~：分支 `ai/payuni-tradestatus-semantics` 已改為 pending，4 與未知代碼改走人工對帳；合併前需 reviewer 獨立審查。
3. 開放 ATM／超商前，補 Version 1.0 失效通知的處理。
4. 補上對 `UNKNOWN` 訂單的 15 分鐘後查詢（若尚未存在）。
5. ~~把本文件 §1 的官方代碼表同步進 `payuni-payment-callback-runbook.md` §1 與 `payuni.ts` 的註解~~：本分支已同步。

## 7. 需要 owner 補的資料

1. PayUni 對 NotifyURL 的重送政策（次數、間隔、是否依 HTTP 狀態碼）：向 PayUni 客服確認。
2. PayUni 正式商店是否有開通其他支付工具（若有，Production 的 UPP 頁是否真的只顯示信用卡，因為 checkout 只送 `Credit=1`）。
3. 失敗、取消、逾時情境的 Sandbox 付款（配合 O-12 的 10-30 演練或另外安排），以取得樣本。
