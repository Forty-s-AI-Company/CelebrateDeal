# 現有範本處置建議

> 範圍：`src/lib/funnel-template-gallery.ts` 的 19 個平台範本（#498 合併後的狀態）。
> 結論先講：
> - 只有黑金範本保留原樣。
> - 4 個功能頁（隱私權、條款、Webinar 感謝頁、Webinar 播放頁）**功能上必須保留**，但要改成統一的新設計。
> - 其餘 14 個不再出現在範本庫。程式中仍保留它們的定義，讓舊資料可以正常讀取（見 §2）。

## 1. 逐一處置

| 範本 id | 名稱 | 處置 | 原因 | 時程 |
|---|---|---|---|---|
| `custom-luxury-course` | 高質感課程品牌（黑金） | **保留不動** | 品質基準（#497） | — |
| `webinar-registration` | 講者型活動報名頁 | **退役**：從範本庫隱藏，改由新範本當預設 | 是新建 webinar 漏斗的預設報名頁（`funnel-goal-step-pages.ts` 寫死這個 id、`funnel-flow.ts` 預設步驟也是它）。要先把預設換成新範本才能隱藏 | 批次 1 完成後 |
| `webinar-course-registration` | 課程說明會報名頁 | 退役 | 由 20 個新範本取代 | 批次 1 完成後 |
| `webinar-workshop-registration` | 線上實作工作坊報名頁 | 退役 | 由 03 設計工作坊取代 | 批次 1 完成後 |
| `webinar-strategy-registration` | 服務提案銷講報名頁 | 退役 | 由 02／06 取代 | 批次 1 完成後 |
| `webinar-thank-you` | 報名完成行動清單 | **保留功能，重設計** | Webinar 漏斗的感謝頁步驟需要它（`funnel-flow.ts` 預設步驟；`listFunnelTemplateGallery` 的 `webinar_thank_you_page` 只對應這一個） | 批次 2（需要 C-09 加入行事曆） |
| `webinar-broadcast` | 專注播放會場 | **保留功能，重設計** | Webinar 播放頁步驟需要它（同上，`webinar_broadcast_page`） | 批次 2 |
| `custom-privacy` | 隱私權政策 | **保留功能，重設計** | 商家上線需要的政策頁；`info_page`／`contact_us_page` 步驟可用 | 批次 4 |
| `custom-terms` | 服務條款 | **保留功能，重設計** | 同上 | 批次 4 |
| `custom-brand-info` | 品牌資訊頁 | 退役 | 品牌首頁由黑金範本代表；之後若需要淺色品牌頁，另開需求 | 批次 1 完成後 |
| `audience-volunteer`、`audience-charity-event`、`audience-environment` | 志工、公益、環境名單頁 | **暫時保留，之後退役** | Audience 目標的 `opt_in_page` 目前只有這些範本可選；直接隱藏會讓名單漏斗沒有範本可用。等 §3 的名單頁變體完成後再退役 | 批次 3 完成後 |
| `audience-course-workbook`、`audience-course-consultation`、`audience-course-lesson` | 課程名單頁三款 | 同上 | 同上 | 批次 3 完成後 |
| `sell-product-checkout`、`sell-simple-checkout`、`sell-content-subscription` | 結帳／訂閱 | **不在本次範圍，暫時保留** | 這些是 `order_form`／`sales_page` 步驟的功能範本，牽涉 checkout，屬於高風險領域。結帳頁重設計要另開任務，由 engineer-hard 處理並經 reviewer 審查 | 另案 |

## 2. 退役的作法：隱藏，不刪除

**不要從 `FUNNEL_TEMPLATE_GALLERY` 陣列刪除定義。** 理由：

1. `funnel-goal-step-pages.ts` 建立 webinar 漏斗時，會對每個步驟的 `step.template.templateId` 呼叫 `instantiateFunnelTemplate`。找不到 id 會直接 `throw`。
2. 已存漏斗的 `step.template.templateId` 仍記錄舊 id。營運面板（`funnel-operations-panel.tsx`）會用它顯示「模板：名稱」，找不到時退回「已套用模板」，不會壞，但資訊會變少。
3. 測試固定了既有範本的節點 ID（`funnel-template-gallery.test.ts` 的註解：已存文件與分析會參照節點 ID）。

建議實作（由 engineer 執行，屬一般功能）：

- `FunnelTemplateGalleryItem` 新增選填 `retired?: { since: string; replacedBy?: string }`。
- `listFunnelTemplateGallery()` 與範本庫 UI 過濾掉 `retired` 的範本。`getFunnelTemplateGalleryItem()`／`instantiateFunnelTemplate()` 仍然可以解析，確保舊漏斗與既有測試不受影響。
- 「更換模板」對話框與 `platformTemplateFits`（`landing-page-template-service.ts`）不接受 retired id 作為**新的**套用目標（因為它們用的是 `listFunnelTemplateGallery`，加上過濾後自然生效），並補一個測試。
- 預設值改成新範本：
  - `funnel-goal-step-pages.ts` 的 `"webinar-registration"` 改成新的預設報名頁，建議 **02 SaaS 雙欄**或 **03 標準講座長頁**。理由：02 和 03 在中性主題下最泛用。主題文案要換成中性版本，或在預設時套用「通用講座」文案變體。
  - `funnel-flow.ts` 的三個預設步驟同步更新。
- `funnel-template-catalog.ts` 的 `FUNNEL_TEMPLATE_CATALOG_TAGS` 保留舊 id 的條目即可（未在 gallery 列表中的 id 會被忽略），新增 20 個新範本的用途與風格標籤。風格對應見各 spec 的 metadata。

## 3. 功能頁的統一新設計

四個功能頁共用一套「功能頁設計語言」，不必配合 20 個範本各自的主題色。商家可以在頁面設定改色，套用後的預設就是這套。

| 設計 token | 值 |
|---|---|
| 背景 | `#f8fafc`（頁面）、`#ffffff`（內容卡） |
| 文字 | 標題 `#0f172a`（對 #ffffff 17.85:1）、內文 `#334155`（10.35:1）、次要 `#475569`（7.58:1） |
| 強調色 | `#1d4ed8`（連結與按鈕底，白字 6.70:1） |
| 字型 | 標題與內文都用 `sans-tc`（Noto Sans TC）；標題 700、內文 400 |
| 版心 | 內容卡 max-width 720px（政策頁）、960px（感謝頁、播放頁） |

### 3.1 Webinar 感謝頁（`webinar-thank-you`，重設計）

區塊順序：

1. 成功狀態 hero：勾選圖示、「報名完成」、活動名稱（C-01 資料來源）。
2. 三步驟 `icon_list`（numbered）：
   1. 收信確認，提醒檢查促銷與垃圾郵件匣。
   2. 加入行事曆（C-09，Google＋.ics）。
   3. 準備問題。
3. 活動資訊列 C-01。
4. 選填：講者短介紹 C-02（featured，小尺寸）。
5. 選填：邀請朋友（複製報名頁網址按鈕）。
6. 頁尾。

節點結構會改變，**要用新 id**（例如 `webinar-thank-you-v2`），舊 id 標記 retired，並把 `funnel-flow.ts` 預設步驟指向新 id。

### 3.2 Webinar 播放頁（`webinar-broadcast`，重設計）

- 播放區由平台既有的 webinar 體驗元件負責（`funnel-webinar-experience.tsx`），範本只負責外圍：
  - 頂部活動標題列
  - 播放區下方的重點摘要（`icon_list`）
  - 講者卡
  - 「直播常見問題」FAQ
- 手機版播放區要全寬，16:9 比例不能變形（`qa-standards.md` L-6）。
- 同樣用新 id（`webinar-broadcast-v2`）。

### 3.3 隱私權政策、服務條款（`custom-privacy`、`custom-terms`，重設計）

- 版型：單欄 720px，左側（桌機）是固定的章節目錄，手機版改成頁首可展開的目錄。章節標題 H2 28px、內文 17px／行高 1.85。
- 「最後更新日期」放在標題下方，由商家填寫，範本只放佔位文字。
- 只調整 props 與樣式時可以沿用舊 id，保留節點結構。若要加章節目錄（新節點），就改用新 id `custom-privacy-v2`／`custom-terms-v2`，舊 id 標記 retired。
- 法務內容維持「可編輯的示意章節」，加一個 `callout`（C-07）提醒「請依實際營運內容與法律意見修改」。

## 4. 名單頁（Audience）後續

- 6 個 audience 範本品質同樣不理想，但退役前必須有替代品。
- 建議在批次 3 完成後，從 01（極簡）、11（痛點問句）、14（對象篩選）各做一個名單頁變體：把活動資訊列、倒數、固定列換成「索取資源」的內容，並登記到 `opt_in_page`。完成後退役 6 個 audience 範本。
- 這是本計畫之外的延伸工作，需要主對話另開任務。

## 5. 執行順序總表

| 時間點 | 動作 | 負責 |
|---|---|---|
| 批次 1 元件 PR | 加 `retired` 欄位、過濾邏輯與測試 | engineer |
| 批次 1 範本合併後 | 登記 01–05；新預設報名頁；退役 `webinar-registration`、3 個舊報名頁、`custom-brand-info` | 主對話統一登記 PR（engineer 實作） |
| 批次 2 | 感謝頁、播放頁 v2；退役舊感謝頁、播放頁；登記 06–10 | engineer |
| 批次 3 | 登記 11–15；（延伸）名單頁變體後退役 6 個 audience 範本 | engineer |
| 批次 4 | 政策頁 v2；登記 16–20 | engineer |
| 另案 | 結帳／訂閱範本重設計 | engineer-hard＋reviewer |
