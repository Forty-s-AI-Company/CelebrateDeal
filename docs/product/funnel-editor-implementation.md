# CelebrateDeal Funnel 編輯器實作說明

## 資料與 migration 策略

- `PageDocument.schemaVersion` 目前為 `1`，保存 Section／Row／Column／Element 樹、responsive overrides、Popups、頁面設定，以及可選的 `FunnelFlow v1`。
- 新格式沿用 `LandingPage` 既有 JSON draft 與 immutable published version，不新增資料表，也未執行 Prisma migration。
- 舊 Puck 文件繼續由舊 renderer／editor 讀寫；系統不會自動做可能遺失內容的轉換。需要轉換時只能走既有的明確 adapter，再由使用者確認與儲存。
- 所有讀取先經 schema parser；無法驗證的文件 fail closed，不會嘗試以 HTML 字串復原。
- 儲存沿用 revision compare-and-swap。版本衝突不覆寫伺服器的新版本，前端保留目前內容並顯示錯誤。

## 共用渲染核心

- 編輯器畫布、Preview、公開 `/lp/[slug]` 與 Popup 內容都使用 `FunnelPageDocumentRenderer`。
- 編輯器額外提供選取框、drag/drop 與命令；正式輸出不載入任意 script。
- `Raw HTML`、Tracking、自訂程式碼、reCAPTCHA、正式付款維持 disabled／limited／unverified 狀態。

## 已驗證互動

- 新增、修改、同層排序、跨容器移動、複製、刪除、Undo、Redo。
- Desktop／Mobile 使用同一樹的 base 與 override，沒有保存兩份頁面。
- 九類 Blocks 展開成一般節點，可逐一選取與編輯。
- Popup 可建立、編輯內容、刪除、立即預覽與依延遲顯示；按鈕可觸發指定 Popup。
- 換模板先顯示影響摘要，再以 transaction 替換 root／popups；保留頁面 metadata、設定與 Funnel flow。
- Audience／Sell／Custom 會建立可序列化的預設 steps；Webinar 因實測方案限制而拒絕建立。

## 明確限制

- Payment 元件不會呼叫正式付款，也不會製造付款成功結果。
- Exit intent 尚未完成跨瀏覽器實測，因此不註冊事件 listener。
- A/B test、automation、deadline、stats、leads、sales 目前只保存實測資訊架構與 capability／空狀態，沒有虛構執行引擎。
- Webinar 的預設 steps、模板、排程與 broadcast 行為未取得可驗證實測結果，維持 `unverified`。
- Funnel E2E 需要經確認的 disposable database；不可對來源不明的資料庫執行會建立資料的瀏覽器測試。

## 回滾

回復 Funnel editor 相關 checkpoint commit 即可。因本階段沒有資料庫 migration，舊 Puck 文件與既有公開版本不需要資料回滾。
