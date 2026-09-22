# Funnel 管理

由既有 Funnel 編輯器上方「Funnel 管理」進入七個營運分頁；URL 為 `/landing-pages/{id}/operations`。

- **Automation Rules**：建立、修改與啟停 `form_registered → add_customer_tag` 規則。沿用 AutomationRule、execution idempotency、CSRF、租戶/專案權限與規則 version CAS。只在伺服器確認 Funnel 來源的首次表單提交觸發。
- **A/B Test**：選擇兩個既有步驟、設定總和 100 的整數權重，發布步驟後開始。匿名訪客在同一實驗固定分流。執行後配置鎖定，停止後回 Control；可選 Winner。需改權重時先儲存停止狀態，再建立新實驗。
- **Stats**：伺服器公開頁交付數、匿名訪客、Submission、依序下一步 conversion 與 drop-off。重載頁面會增加交付數；資料不是付款證據。A/B 的 actual step 與 logical step 分別保存，兩組共用後續步驟，實驗組別數據另列。
- **Leads**：Funnel/Step、提交時間、Submission ID、驗證狀態；不顯示姓名、Email、電話與回答內容。
- **Sales**：只使用綁定該 Funnel 的 CommerceOrder 與其 PaymentTransaction projection，排除測試訂單；付款/退款以各自幣別與金額欄位顯示，不合併不同幣別。
- **Deadline Settings**：指定 IANA 時區與包含 offset 的 ISO 截止時間。用 UTC instant 比較，`now >= expiresAt` 即截止。可顯示關閉頁或導向同 Funnel 的已發布非首頁步驟；導向頁可閱讀，但仍禁止提交與結帳。
- **Funnel Settings**：名稱、canonical `/lp/{slug}` 路徑及 currency。自訂外部 hostname 不會因填入 slug 而自動綁定；已發布 slug 必須先取消發布才能更換。currency 不換算商品價格，必須與綁定商品相容。

報表的「儲存設定」保存步驟/天數篩選，不修改來源紀錄。日期最長 90 天；Stats 最多 10,000 筆來源，Leads/Sales 顯示最新 100 筆，超過時明確提示縮小範圍。公開匿名識別依第一方 cookie 保存，清除 cookie 後視為新訪客。

所有營運設定使用 LandingPage 的同一 revision CAS；衝突時保留本地輸入，重新載入後再修改。頁面編輯器也檢查營運引用，不允許刪除仍被實驗、導向或報表使用的步驟。

## Migration 與來源

計畫：`docs/ai-team/funnel-secondary-tabs-plan.md`。
新增 migration：`20260917100000_funnel_runtime_attribution`，只新增 operations、FunnelVisit/FunnelSubmission、scoped automation 欄位與索引/外鍵。舊設定讀預設值；不替舊流量或舊提交補造事件。

公開頁先重新解析已發布 Funnel，再記錄 delivery。首次提交與來源紀錄使用同一 transaction；重複提交不改寫來源。截止限制也套用 Webinar 及播放入口。Sales 的 Funnel reference 來自既有 checkout 伺服器驗證後的付款快照。

本輪僅允許 isolated synthetic PostgreSQL migration 驗證，未授權 production migration/deployment。應先部署 additive schema，再部署程式。回退程式保留新增資料表與欄位，不用 DROP 或刪資料回退。
