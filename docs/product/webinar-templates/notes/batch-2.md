# 批次 2（06～10）：共用元件問題與替代做法

> 範本工作階段不改共用檔案。以下問題請主對話評估是否修在整合分支；每一項都附上批次 2 目前的替代做法，修好後可以把範本改回 spec 原本的寫法。

## A. 會造成 QA 失敗的元件問題

| # | 元件 | 問題 | 影響 | 批次 2 的替代做法 |
|---|---|---|---|---|
| A-1 | C-13 `testimonial_wall`（`layout: "carousel"`） | 輪播圓點按鈕只有 32×44，所有寬度都觸發 L-5（< 44×44） | spec 06、07、09 指定手動輪播 | 改用 `layout: "grid"`（3 欄、平板 2 欄、手機 1 欄），評價數改成 3 則 |
| A-2 | `icon_list`（`layout: "grid"`） | 元件把 `gap` 覆寫成 30px，但 `funnelFluidGridColumns` 用 28px 計算欄寬，3 欄在桌機會掉成 2 欄＋1 個孤兒 | spec 07「你會得到」、09「3 步驟」、10「學習方式」 | `columns_3` 包 3 個內容盒，每個內容盒放 1 項的 `icon_list`（`layout: "list"`）或圖示＋標題＋內文 |
| A-3 | `faq` | 答案文字寫死 `text-slate-600`、外框寫死 `border-slate-200`，放在深色區塊對比只有約 2.6:1；`findFunnelContrastIssues` 也抓不到 | 深色範本（07、08）的 FAQ | 07：FAQ 放進淺色內容盒；08：FAQ 放在淺紫區塊 |
| A-4 | `webinarTemplateKit().form` 的 `title` | 表單標題 headline 沒有繼承表單的 `color`，用頁面標題色，白底表單放在深色頁面時對比 1.04:1 | 07（深色頁＋白色表單卡） | 07 不設表單標題，標題放在左欄 |
| A-5 | C-01 `event_facts` | 欄名 `dt` 是 `0.8125em`，頁面內文 17px 時手機只有 13.8px，觸發 F-3.1（< 14px） | 內文 17px 的範本（07、08、09、10） | 活動資訊列節點設 `fontSize: 18` |

## B. spec 要求但目前做不到的能力

| # | 元件 | 缺少的能力 | 影響的 spec | 批次 2 的替代做法 |
|---|---|---|---|---|
| B-1 | `speaker_profiles`（`grid`） | 手機一律 1 欄，沒有「手機 2 欄」 | 08 講者牆（spec：手機 2 欄） | 手機改成方形照片（`photoShape: "square"`）縮短長度；8 位講者在手機仍是單欄 |
| B-2 | C-12 `session_schedule` | 只有直式清單：沒有桌機 4 張橫排卡＋連接線、沒有「本頁報名」強調；範本不能填日期，所以預覽時 4 列都顯示「時間公布中」 | 10 學習路徑 | 保留 C-12（商家設定每列日期後狀態自動計算）；「本頁報名」寫在第 1 堂說明；另用 4 張描邊卡（`columns_4`）呈現每堂內容，第 1 堂卡片加「本頁報名」標籤 |
| B-3 | 動態欄位 `{{webinar.*}}` | 只在 `text`、`headline`、`bulleted_list`、按鈕文字解析；`announcement_bar.text`、`section_title` 不解析 | 06、08、09 公告條要顯示日期 | 公告條改成「活動名稱＋開播倒數」（`showCountdown`），日期放在活動資訊列與 `text` |
| B-4 | 字型 | `rounded-tc`（圓體）沒有自架字型，只會退回系統字；`display-latin` 的中文會退回 system-ui（不是思源黑體），不適合當標題字 | 10（spec：圓體 800）；07、08、09 的數字字型 | 10 標題改用 `wenkai-tc`（霞鶩文楷，含假名，實測無豆腐字）；其他範本標題維持 `sans-tc` |
| B-5 | `video` | 沒有 src 時公開頁顯示「影片網址不安全或尚未設定」，不能只放 poster | 07 首屏預告影片 | 改用 `video_gallery` 單支影片＋自製 16:9 封面（沒有網址時顯示封面與播放圖示；貼上 YouTube 網址後按下播放才以 nocookie 載入） |
| B-6 | `section` 背景 | 樣式只接受純色，不能用 CSS 漸層 | 08 首屏光暈（spec：純 CSS radial-gradient） | 改用 SVG 背景圖 `08/hero-glow.svg`（3KB，`preserveAspectRatio="xMidYMid slice"`，背景 cover，不會造成水平捲動） |
| B-7 | `webinarTemplateKit().section` | 不能設定平板／手機的 section props 覆寫（例如手機遮罩改成均勻） | 06 首屏插畫遮罩 | 06 在範本內補上 `overrides.tablet/mobile.props`（`withBackdropOverrides`） |
| B-8 | `webinarTemplateKit().columns2` | 兩欄內容盒不能帶樣式或覆寫（例如資訊卡外框、手機置中） | 06、09 | 直接用 `node("…", "columns_2", …, [stack(…, style, options), …])` 組合 |
| B-9 | `nav_bar` | 沒有「只顯示品牌＋按鈕」時的精簡樣式；CTA 按鈕是方角，無法跟頁面的膠囊按鈕一致 | 06 | 維持預設 |
| B-10 | `content_box` | 內容盒不能巢狀（`content_box` 不允許在 `content_box` 之下） | 寫法限制 | 文件化：兩欄的欄內不能再包內容盒；需要卡片時讓欄本身帶樣式 |

## C. 給 IMPLEMENTING.md 的補充

- `borderRadius` 上限 500，膠囊按鈕用 100 即可（寫 999 會讓整份 PageDocument 驗證失敗，錯誤訊息只有「無法建立 PageDocument」，不容易找）。建議 `webinarTemplateIssues` 失敗時附上 zod 的第一個錯誤路徑。
- 同一頁的節點 id 不可重複（例如 section `footer_cta` 與按鈕 `footer_cta` 會衝突），驗證失敗時同樣只看到「無法建立 PageDocument」。
- 用長駐 dev server（`--base-url`）迭代時，改過範本後第一個寬度偶爾會出現 HYDRATION：伺服器端還是舊模組（例如字級 17px 對 18px，或伺服器端還不認得新範本）。重跑或改用不帶 `--base-url` 的全新鏡像就會消失；最後驗收請用全新鏡像。

## D. 範本取捨（不是元件問題，供審查參考）

- 06：spec 的手寫旁註字（`wenkai-tc`）會讓頁面變成 3 個字族（超過 I-2 的 2 個上限），改用手繪路線 SVG 分隔線呈現手作感；首屏手機改成靠左對齊（活動資訊列在手機是靠左的 2×2，置中會對不齊）。
- 07：首屏比例從 5:7 改成 1:1，H1 才能維持 2 行；手機主要 CTA 移到資訊列前面，375×667 首屏看得到。
- 08：首屏的活動資訊列在平板與手機會變成靠左 2×2，改顯示一行置中的時間膠囊（同樣讀漏斗排程）；桌機仍是活動資訊列。
- 09：手機的資訊卡離首屏太遠，首屏另加一顆只在手機顯示的「免費報名體驗課」按鈕（L-7）。單元測試另外檢查範本沒有 `offer_price`、`payment_button` 或商品／結帳欄位。
- 10：spec 的 eyebrow「每週四 20:00」會和漏斗排程衝突，改成「每週一堂」；時間只來自活動資訊列與倒數。
