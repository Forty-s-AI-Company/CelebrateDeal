# Funnel Sell 商品與安全結帳

## 範圍

CelebrateDeal 的商品、訂單與付款架構是交易依據。systeme.io 文件只提供編輯器的元件與流程參考，不移植參考帳戶配額，也不把未實測的付款行為當成既定規格。

訂單表單步驟可在「頁面設定 → 商品與結帳」選擇目前專案的有效商品、同幣別加購商品、單頁／兩步驟版面及額外條款。儲存草稿不會建立交易；發布後的付款按鈕才會導向安全結帳。編輯器與草稿預覽一律不付款。

## 資料與權限

- `PageDocument.commerce` 是可選、獨立 version 1 的商品參照。既有 v1 文件不需要回填。
- 文件僅保存 `productId`、`orderBumpProductId`、`formMode` 及條款文字，禁止保存可信價格、幣別、收款人、provider 或回跳網址。
- 商品由目前管理者的 vendor/project 與 `SalesProjectProduct` 關聯查詢。保存、發布、公開渲染及結帳都重新驗證歸屬與可用性。
- 商品必須啟用、已確認履約、具有正價格和可售庫存；非實體商品另需有效交付設定。不整合外部 `checkoutUrl` 商品。
- 公開及編輯器投影只含商品 ID、名稱、單價、幣別與履約類型。交付內容、provider 設定與憑證不送進編輯器。
- 商品設定參與結構化 Undo/Redo、序列化及既有 revision CAS 保存。更換視覺模板保留商品設定。

## 結帳

`/lp/{slug}/{stepId}/checkout` 是商品資料的伺服器解析入口；其動態路由資料夾沿用 `[stepPath]`，但結帳子路徑使用穩定 step ID。只接受目前公開且所屬專案公開的 `order_form` 步驟。

結帳頁重用 `CommerceCheckoutForm`、admission、Checkout API 與現有結果頁，不另建可接受任意金額的付款端點。伺服器重新核價、驗證所選加購與 owner，再建立交易。結果仍由既有可信交易／回呼狀態決定；Funnel 感謝頁不代表已付款。

結帳頁提供已讀取的發布版本與商品 revision。新交易送出時若價格、商品或條款版本已變更，要求重新載入，不把舊畫面的同意套用到新條款。相同 pending idempotency key 的回復沿用原始訂單快照，不因本單保留最後一份庫存而誤建新單。

兩步驟的第一步只有聯絡資料的本機 UI 狀態，不取得 admission、不保存 PII 至文件或網址、不保留庫存。第二步才收集必要配送／發票資料、選擇加購與同意條款，最後送出既有安全結帳。

額外條款只約束此 Funnel 來源的結帳，不宣稱覆蓋商品的所有購買入口。其他公開結帳入口不會被記為同意了 Funnel 條款。同 vendor、不同專案的活動報名不會混入此 Funnel 訂單歸因。

## 元件可用條件

| 元件 | 功能與限制 |
|---|---|
| Offer price | 顯示伺服器商品價格，不信任節點文字或 responsive props 的金額 |
| Payment button | 已發布且商品有效時導向此步驟的安全結帳；預覽停用 |
| Payment method | 付款方式由既有伺服器 provider 與金流安全頁提供，不能在畫布覆寫 |
| Physical product | 結帳收集實體商品必要配送資料 |
| Customer type | 沿用既有個人、公司、捐贈發票選項 |
| Agreement | 結帳頁勾選，API 驗證此 Funnel 額外條款；文字以純文字渲染 |
| Order bump | 同專案、同幣別商品；主品與加購品須原子保留庫存。非實體主品不可加購需要配送的實體品 |
| Two-step order form | 依本步驟設定啟用聯絡資料與訂單確認兩步驟 |
| Coupon | 沿用既有已領取優惠券的伺服器折抵；沒有手動輸入優惠碼功能 |
| Shipping fees | 目前沒有獨立運費計價模型，不額外加收運費；介面明示須將配送成本納入售價 |

後兩項是 CelebrateDeal 現有能力的明確限制，不是 systeme.io 方案限制。沒有新增週期訂閱、付款卡號欄位、付費行事曆或假的付款成功流程。

## 庫存與相容性

新增 `InventoryReservation.items` nullable JSON 欄位，保存伺服器解析的主品／加購品與數量快照。維持既有一筆交易一筆 reservation 與狀態機；新單所有品項在同一 Serializable transaction 內保留、失敗釋放、付款提交與過期處理。

歷史 `items = null` 僅依原本主商品處理，不能從舊訂單猜測加購曾被保留並憑空返還庫存。Migration 僅新增欄位，不刪資料；只在新建 disposable 本機資料庫驗證，未套用至正式資料庫。

回滾應先停止新增多品項結帳，讓新 reservation 由相容版本處理完畢。不可把已有多品項 pending reservation 的系統直接退回只認主品的舊程式。nullable 欄位可保留，不需要 destructive down migration。

## 驗證

`scripts/funnel-commerce-disposable-qa.mjs` 使用不含 `.env*` 的 source-only mirror、新建 loopback PostgreSQL 與 synthetic fixtures，執行資料庫整合測試、typecheck、production-mode build 及瀏覽器流程。結果寫入 `docs/ai-team/evidence/funnel-commerce-20260917/`。

瀏覽器付款使用明確標示的 transport mock，不能當成 PayUni／Stripe 真實 sandbox 成功證據。正式服務、正式付款、正式寄信與 Production deployment 均未授權、未執行。真實 sandbox evidence 須由符合 protected branch 與 exact source lineage 的既有 trusted runner 另行產生。
